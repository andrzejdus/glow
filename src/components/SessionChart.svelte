<script lang="ts">
  import { tap } from '../lib/connection.svelte';
  import { BATTERY_GAP_SEC, batteryValues, energyOf, niceScale, SERIES, seriesOf, type SeriesKey } from '../lib/battery';
  import { decimal, mmss, toUnit } from '../lib/format';
  import type { SessionDetail, SessionSummary } from '../lib/sessions.svelte';

  interface Props {
    summary: SessionSummary;
    detail: SessionDetail | null;
    unit: 'C' | 'F';
    /** The session is running: the line ends in a pulsing dot. */
    running?: boolean;
  }
  let { summary, detail, unit, running = false }: Props = $props();

  let w = $state(320);
  const H = 180;
  const pad = { l: 34, r: 12, t: 26, b: 22 };

  const ts = $derived(detail?.ts ?? []);
  const last = $derived(ts[ts.length - 1] ?? 0);
  const endSec = $derived(summary.end === null ? null : (summary.end - summary.id) / 1000);
  // From 10 s before the heater came on to the end of the cool-down (10 s past the end without
  // a live temperature), or to now while it runs.
  const t0 = $derived(Math.min(ts[0] ?? 0, -10));
  const t1 = $derived(Math.max(t0 + 60, last, endSec === null ? 0 : endSec + 10));
  const values = $derived([...(detail?.g ?? []), ...(detail?.c ?? [])].filter((v): v is number => v !== null));
  // The scale in steps of 20, a little room above the highest value.
  const lo = $derived(values.length ? Math.max(0, Math.floor((Math.min(...values) - 5) / 20) * 20) : 0);
  const hi = $derived(values.length ? Math.ceil((Math.max(...values) + 5) / 20) * 20 : 220);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const y = (c: number) => pad.t + (1 - (c - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const ticks = $derived.by(() => {
    const step = hi - lo > 120 ? 40 : 20;
    const out: number[] = [];
    for (let v = lo; v <= hi; v += step) out.push(v);
    return out;
  });

  // A gap in the samples (Glow was away) breaks the line rather than drawing across it.
  const GAP = 20;
  function path(get: (i: number) => number | null, step = false, from = 0, to = ts.length - 1) {
    let d = '';
    let prev: { t: number; v: number } | null = null;
    for (let i = from; i <= to; i++) {
      const v = get(i);
      if (v === null) {
        prev = null;
        continue;
      }
      const t = ts[i];
      if (!prev || t - prev.t > GAP) d += `M${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      else if (step) d += `H${x(t).toFixed(1)}V${y(v).toFixed(1)}`;
      else d += `L${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      prev = { t, v };
    }
    return d;
  }
  const goalPath = $derived(path((i) => detail!.g[i], true));
  // The heater-on stretch as sample indexes; the parts before and after share its end points,
  // so the line runs on unbroken from grey to orange and back.
  const onFrom = $derived(Math.max(0, ts.findIndex((t) => t >= 0)));
  const onTo = $derived.by(() => {
    let i = ts.length - 1;
    while (endSec !== null && i > onFrom && ts[i] > endSec) i--;
    return i;
  });
  // Without a live temperature (VENTY, VEAZY), the target from Ready on: the device is at it.
  const temp = (i: number) =>
    summary.live ? detail!.c[i] : summary.readySec !== null && ts[i] >= summary.readySec ? detail!.g[i] : null;
  const beforePath = $derived(summary.live && onFrom > 0 ? path(temp, false, 0, onFrom) : '');
  const currentPath = $derived(path(temp, !summary.live, onFrom, onTo));
  const afterPath = $derived(summary.live && onTo < ts.length - 1 ? path(temp, false, onTo, ts.length - 1) : '');
  // The glow under the line, only while the heater is on.
  const area = $derived.by(() => {
    if (!currentPath || !summary.live || currentPath.indexOf('M', 1) > 0) return '';
    let first = onFrom;
    while (first < onTo && detail!.c[first] === null) first++;
    let lastI = onTo;
    while (lastI > first && detail!.c[lastI] === null) lastI--;
    return `${currentPath}L${x(ts[lastI]).toFixed(1)},${H - pad.b}L${x(ts[first]).toFixed(1)},${H - pad.b}Z`;
  });

  // Boost periods as bands, from the level changes.
  const bands = $derived.by(() => {
    const out: { from: number; to: number; mode: string }[] = [];
    let open: { from: number; mode: string } | null = null;
    for (const e of detail?.events ?? []) {
      if (e.k !== 'mode') continue;
      if (open) out.push({ ...open, to: e.t });
      open = e.v === 'normal' ? null : { from: e.t, mode: e.v };
    }
    if (open) out.push({ ...open, to: endSec ?? last });
    return out;
  });
  // A vertical mark for each thing that happened; Ready has its own.
  const marks = $derived.by(() => {
    const out: { t: number; kind: string; label?: string }[] = [{ t: 0, kind: 'on', label: summary.joined ? 'Seen' : 'On' }];
    for (const e of detail?.events ?? []) {
      if (e.k !== 'ready') out.push({ t: e.t, kind: e.k === 'lost' || e.k === 'back' ? 'gap' : e.k });
    }
    if (endSec !== null) out.push({ t: endSec, kind: 'off', label: 'Off' });
    return out;
  });
  /** A mark's label beside its line, on the side with room for it. */
  const labelAt = (m: { t: number; kind: string }) => {
    const left = m.kind === 'on' ? x(m.t) - pad.l > 24 : w - pad.r - x(m.t) < 26;
    return { x: x(m.t) + (left ? -4 : 4), anchor: left ? 'end' : 'start' };
  };
  const lastI = $derived(ts.length - 1);
  const end = $derived.by(() => {
    if (lastI < 0) return null;
    const v = summary.live ? detail!.c[lastI] : detail!.g[lastI];
    return v === null ? null : { x: x(ts[lastI]), y: y(v) };
  });
  const ready = $derived(summary.readySec === null || !detail ? null : {
    x: x(summary.readySec),
    y: y(detail.g[ts.findIndex((t) => t >= summary.readySec!)] ?? lo),
  });
  // One battery value over the temperature, faded behind it, on a scale of its own on the right
  // whose steps sit on the temperature's grid lines. Only what the session has readings of.
  const available = $derived(seriesOf(detail));
  let pick = $state<SeriesKey>('temp');
  const sel = $derived(available.includes(pick) ? pick : 'temp');
  const energy = $derived(energyOf(detail?.battery));
  const units: Record<Exclude<SeriesKey, 'temp'>, string> = { battery: '%', voltage: 'V', current: 'A', power: 'W', batteryTemp: '°' };
  const overlay = $derived.by(() => {
    if (sel === 'temp' || !detail?.battery || ticks.length < 2) return null;
    const key = sel;
    const b = detail.battery;
    const conv = (v: number) => (key === 'batteryTemp' && unit === 'F' ? (v * 9) / 5 + 32 : v);
    const pts = batteryValues(b, key)
      .map((v, i) => ({ t: b.ts[i], v: v === null ? null : conv(v) }))
      .filter((p): p is { t: number; v: number } => p.v !== null);
    if (pts.length < 2) return null;
    const vs = pts.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const n = ticks.length - 1;
    const { from, step } = niceScale(key === 'current' || key === 'power' ? Math.min(0, min) : min, max, n);
    const tStep = ticks[1] - ticks[0];
    const oy = (v: number) => y(ticks[0] + ((v - from) / step) * tStep);
    let d = '';
    let gaps = false;
    pts.forEach((p, k) => {
      const X = x(p.t).toFixed(1);
      const Y = oy(p.v).toFixed(1);
      const broken = k > 0 && p.t - pts[k - 1].t > BATTERY_GAP_SEC;
      gaps ||= broken;
      // The percentage moves in whole steps.
      d += k === 0 || broken ? `M${X},${Y}` : key === 'battery' ? `H${X}V${Y}` : `L${X},${Y}`;
    });
    const base = y(ticks[0]).toFixed(1);
    const area = gaps ? '' : `${d}L${x(pts[pts.length - 1].t).toFixed(1)},${base}L${x(pts[0].t).toFixed(1)},${base}Z`;
    const dec = Number.isInteger(step) ? 0 : Math.abs(Math.round(step * 10) - step * 10) < 1e-9 ? 1 : 2;
    const u = key === 'batteryTemp' ? `°${unit}` : units[key];
    const labels = ticks.map((t, k) => {
      const v = from + k * step;
      const text = decimal(Math.abs(v) < 1e-9 ? 0 : v, dec);
      return { y: y(t), text: k === n ? `${text} ${u}` : text };
    });
    const first = pts[0].v;
    const last = pts[pts.length - 1].v;
    const top = pts.reduce((a, p) => (p.v > a.v ? p : a));
    const wh = energy ? ` · ${decimal(energy.wh, 2)} Wh` : '';
    let summary = '';
    if (key === 'battery') summary = `${first} → ${last} %${first > last ? ` · −${first - last} %` : ''}`;
    else if (key === 'voltage') summary = `${decimal(first, 2)} → ${decimal(last, 2)} V · low ${decimal(min, 2)} V`;
    else if (key === 'current') summary = `peak ${decimal(max, 1)} A${wh}`;
    else if (key === 'power') summary = `peak ${decimal(max, 1)} W${wh}`;
    else {
      const at = endSec !== null && top.t > endSec ? `+${mmss(top.t - endSec)}` : mmss(top.t);
      summary = `${Math.round(first)} → ${Math.round(max)} ${u} · max at ${at}`;
    }
    return { d, area, labels, summary, name: SERIES[key].name };
  });

  // The start, the end (or now) and how long the cool-down ran.
  const xLabels = $derived.by(() => {
    const stop = endSec ?? last;
    const out = [{ t: 0, text: '0:00', anchor: 'start' }];
    if (x(stop) - x(0) > 40) out.push({ t: stop, text: mmss(stop), anchor: x(t1) - x(stop) > 20 ? 'middle' : 'end' });
    if (endSec !== null && x(t1) - x(endSec) > 50) out.push({ t: t1, text: `+${mmss(Math.round(t1 - endSec))}`, anchor: 'end' }); // readings are whole seconds, the end is not
    return out;
  });
</script>

<div class="chart" bind:clientWidth={w}>
  {#if ts.length > 1 && available.length > 1}
    <div class="chips" role="group" aria-label="Value on the chart">
      {#each available as k (k)}
        <button type="button" class="press" aria-pressed={sel === k} onclick={() => { tap(); pick = k; }}>{SERIES[k].chip}</button>
      {/each}
    </div>
  {/if}
  {#if ts.length > 1}
    <svg width={w} height={H} viewBox="0 0 {w} {H}" role="img" class:overlaid={!!overlay}
      aria-label={overlay ? `${overlay.name} over the session, with the temperature faded behind it`
        : `Temperature over the session${summary.live ? ', current and target' : ', target'}`}>
      <defs>
        <linearGradient id="heat-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--orange)" stop-opacity="0.32" />
          <stop offset="1" stop-color="var(--orange)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <!-- Heater off: before the start and during the cool-down. -->
      <rect class="off-zone" x={x(t0)} y={pad.t - 14} width={Math.max(0, x(0) - x(t0))} height={H - pad.b - pad.t + 14} />
      {#if endSec !== null}
        <rect class="off-zone" x={x(endSec)} y={pad.t - 14} width={Math.max(0, x(t1) - x(endSec))} height={H - pad.b - pad.t + 14} />
      {/if}
      {#each bands as b (b.from)}
        <rect class="band" x={x(b.from)} y={pad.t - 10} width={Math.max(2, x(b.to) - x(b.from))} height={H - pad.b - pad.t + 10} rx="6" />
        <text class="band-label" x={x(b.from) + 6} y={pad.t}>{b.mode === 'superboost' ? 'SUPER' : 'BOOST'}</text>
      {/each}
      {#each ticks as v (v)}
        <line class="grid" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
        <text class="axis" x={pad.l - 6} y={y(v) + 3.5} text-anchor="end">{toUnit(v, unit)}°</text>
      {/each}
      {#each xLabels as l (l.t)}
        <text class="axis" x={x(l.t)} y={H - 6} text-anchor={l.anchor}>{l.text}</text>
      {/each}
      {#each marks as m, i (i)}
        <line class="mark {m.kind}" x1={x(m.t)} x2={x(m.t)} y1={pad.t - 14} y2={H - pad.b} />
        {#if m.label}
          {@const at = labelAt(m)}
          <text class="mark-label {m.kind}" x={at.x} y={pad.t - 16} text-anchor={at.anchor}>{m.label}</text>
        {/if}
      {/each}
      {#if area && !overlay}<path class="area" d={area} />{/if}
      <g class="temps">
        <path class="goal" d={goalPath} />
        {#if beforePath}<path class="current off" d={beforePath} />{/if}
        {#if afterPath}<path class="current off" d={afterPath} />{/if}
        {#if currentPath}<path class="current" d={currentPath} />{/if}
      </g>
      {#if overlay}
        {#if overlay.area}<path class="ov-area" d={overlay.area} />{/if}
        <path class="ov" d={overlay.d} />
        {#each overlay.labels as l (l.y)}
          <text class="ov-axis" x={w - pad.r - 2} y={l.y - 3} text-anchor="end">{l.text}</text>
        {/each}
      {:else if ready}
        <line class="ready-line" x1={ready.x} x2={ready.x} y1={pad.t} y2={H - pad.b} />
        <circle class="ready-dot" cx={ready.x} cy={ready.y} r="5" />
        <text class="ready-label" x={Math.min(ready.x + 8, w - pad.r - 64)} y={H - pad.b - 8}>Ready {mmss(summary.readySec ?? 0)}</text>
      {/if}
      {#if end && !overlay}
        {#if running}<circle class="pulse" cx={end.x} cy={end.y} r="5" />{/if}
        <circle class="end" class:off={!!afterPath} cx={end.x} cy={end.y} r="4.5" />
      {/if}
    </svg>
    <div class="legend">
      {#if overlay}
        <span><i class="sw ov"></i>{overlay.name}</span>
        <span><i class="sw current faded"></i>{summary.live ? 'Temperature' : 'At temperature'}</span>
      {:else}
        {#if summary.live}<span><i class="sw current"></i>Temperature</span>{:else if summary.readySec !== null}<span><i class="sw current"></i>At temperature</span>{/if}
        <span><i class="sw goal"></i>Target</span>
      {/if}
      {#if bands.length}<span><i class="sw band"></i>Boost</span>{/if}
      <span><i class="sw off"></i>Heater off</span>
    </div>
    {#if overlay}
      <div class="ov-sum num"><span>{overlay.name}</span><strong>{overlay.summary}</strong></div>
    {/if}
  {:else}
    <div class="empty" style:height="{H}px">{running ? 'Collecting the first readings…' : 'No readings for this session.'}</div>
  {/if}
</div>

<style>
  .chart {
    width: 100%;
    min-width: 0;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .axis {
    font-size: 10px;
    font-weight: 600;
    fill: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .band {
    fill: var(--orange-tint);
  }
  .off-zone {
    fill: var(--card-2);
  }
  .mark {
    stroke-width: 1.2;
    stroke-dasharray: 3 3;
  }
  .mark.on {
    stroke: var(--led-heat);
    stroke-dasharray: none;
  }
  .mark.off {
    stroke: var(--muted);
    stroke-dasharray: none;
  }
  .mark.mode {
    stroke: var(--orange);
  }
  .mark.target {
    stroke: var(--navy);
    opacity: 0.45;
  }
  .mark.air {
    stroke: var(--navy-fill);
  }
  .mark.gap {
    stroke: var(--faint);
    stroke-dasharray: 1 3;
  }
  .mark-label {
    font-size: 10px;
    font-weight: 800;
  }
  .mark-label.on {
    fill: var(--led-heat);
  }
  .mark-label.off {
    fill: var(--muted);
  }
  .band-label {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    fill: var(--orange-ink);
  }
  .area {
    fill: url(#heat-fill);
  }
  .goal {
    fill: none;
    stroke: var(--navy);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
    opacity: 0.55;
  }
  .current {
    fill: none;
    stroke: var(--orange);
    stroke-width: 2.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ready-line {
    stroke: var(--led-ready);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .ready-dot {
    fill: var(--led-ready);
    stroke: var(--card);
    stroke-width: 2;
  }
  .ready-label {
    font-size: 10px;
    font-weight: 800;
    fill: var(--led-ready);
  }
  .end {
    fill: var(--orange);
    stroke: var(--card);
    stroke-width: 2;
  }
  /* Heater off, as in the timeline's small lines. */
  .current.off {
    stroke: var(--faint);
    stroke-width: 2;
  }
  .end.off {
    fill: var(--faint);
  }
  .pulse {
    fill: var(--orange);
    transform-box: fill-box;
    transform-origin: center;
    animation: pulse 1.6s ease-out infinite;
  }
  @keyframes pulse {
    from { transform: scale(1); opacity: 0.6; }
    to { transform: scale(3.2); opacity: 0; }
  }
  .legend {
    display: flex;
    gap: 14px;
    margin-top: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    display: inline-block;
    width: 14px;
    height: 3px;
    border-radius: 2px;
  }
  .sw.current {
    background: var(--orange);
  }
  .sw.goal {
    background: repeating-linear-gradient(90deg, var(--navy) 0 4px, transparent 4px 7px);
    opacity: 0.6;
  }
  .sw.band {
    height: 10px;
    background: var(--orange-tint);
  }
  .sw.off {
    height: 10px;
    background: var(--card-2);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .chips {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    margin: 0 -16px 10px;
    padding: 2px 16px 4px;
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chips button {
    flex-shrink: 0;
    height: 40px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--navy) 16%, transparent);
    background: var(--card);
    color: var(--navy);
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
  }
  .chips button[aria-pressed='true'] {
    border-color: var(--navy-fill);
    background: var(--navy-fill);
    color: #ffffff;
  }
  /* A battery value on top: the temperature and its marks step back. */
  .overlaid .temps {
    opacity: 0.35;
  }
  .overlaid .band {
    opacity: 0.6;
  }
  .overlaid .mark {
    opacity: 0.6;
  }
  .overlaid .temps .goal {
    opacity: 1;
  }
  .ov {
    fill: none;
    stroke: var(--navy);
    stroke-width: 2.2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ov-area {
    fill: color-mix(in srgb, var(--navy) 7%, transparent);
  }
  .ov-axis {
    font-size: 10px;
    font-weight: 800;
    fill: var(--navy);
    font-variant-numeric: tabular-nums;
    paint-order: stroke;
    stroke: var(--card);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
  .sw.ov {
    background: var(--navy);
  }
  .sw.faded {
    opacity: 0.35;
  }
  .ov-sum {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--card-2);
  }
  .ov-sum span {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .ov-sum strong {
    font-size: 15px;
    font-weight: 800;
    color: var(--navy);
    text-align: right;
  }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--muted);
  }
</style>
