<script lang="ts">
  import { mmss, toUnit } from '../lib/format';
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
  function path(get: (i: number) => number | null, step = false) {
    let d = '';
    let prev: { t: number; v: number } | null = null;
    for (let i = 0; i < ts.length; i++) {
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
  // Without a live temperature (VENTY, VEAZY), the target from Ready on: the device is at it.
  const currentPath = $derived(
    summary.live
      ? path((i) => detail!.c[i])
      : summary.readySec === null
        ? ''
        : path((i) => (ts[i] >= summary.readySec! ? detail!.g[i] : null), true),
  );
  const area = $derived.by(() => {
    if (!currentPath || !summary.live) return '';
    const first = ts.findIndex((_, i) => detail!.c[i] !== null);
    let lastI = -1;
    for (let i = ts.length - 1; i >= 0; i--) if (detail!.c[i] !== null) { lastI = i; break; }
    if (first < 0 || lastI < 0 || currentPath.indexOf('M', 1) > 0) return '';
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
  // The start, the end (or now) and how long the cool-down ran.
  const xLabels = $derived.by(() => {
    const stop = endSec ?? last;
    const out = [{ t: 0, text: '0:00', anchor: 'start' }];
    if (x(stop) - x(0) > 40) out.push({ t: stop, text: mmss(stop), anchor: x(t1) - x(stop) > 20 ? 'middle' : 'end' });
    if (endSec !== null && x(t1) - x(endSec) > 50) out.push({ t: t1, text: `+${mmss(t1 - endSec)}`, anchor: 'end' });
    return out;
  });
</script>

<div class="chart" bind:clientWidth={w}>
  {#if ts.length > 1}
    <svg width={w} height={H} viewBox="0 0 {w} {H}" role="img"
      aria-label="Temperature over the session{summary.live ? ', current and target' : ', target'}">
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
      {#if area}<path class="area" d={area} />{/if}
      <path class="goal" d={goalPath} />
      {#if currentPath}<path class="current" d={currentPath} />{/if}
      {#if ready}
        <line class="ready-line" x1={ready.x} x2={ready.x} y1={pad.t} y2={H - pad.b} />
        <circle class="ready-dot" cx={ready.x} cy={ready.y} r="5" />
        <text class="ready-label" x={Math.min(ready.x + 8, w - pad.r - 64)} y={H - pad.b - 8}>Ready {mmss(summary.readySec ?? 0)}</text>
      {/if}
      {#if end}
        {#if running}<circle class="pulse" cx={end.x} cy={end.y} r="5" />{/if}
        <circle class="end" cx={end.x} cy={end.y} r="4.5" />
      {/if}
    </svg>
    <div class="legend">
      {#if summary.live}<span><i class="sw current"></i>Temperature</span>{:else if summary.readySec !== null}<span><i class="sw current"></i>At temperature</span>{/if}
      <span><i class="sw goal"></i>Target</span>
      {#if bands.length}<span><i class="sw band"></i>Boost</span>{/if}
      <span><i class="sw off"></i>Heater off</span>
    </div>
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
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--muted);
  }
</style>
