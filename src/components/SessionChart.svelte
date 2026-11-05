<script lang="ts">
  import { tap } from '../lib/connection.svelte';
  import Icon from './Icon.svelte';
  import Toggle from './Toggle.svelte';
  import { BATTERY_GAP_SEC, batteryValues, niceScale, SERIES, seriesOf, type SeriesKey } from '../lib/battery';
  import { decimal, mmss, toUnit } from '../lib/format';
  import {
    latest, formatValue, legendName, nearestIndex, neighbours, readoutLine, stepFrom, swipeIntent, swipeStep, timeLabel, valueAt, valuesAt, type ReadoutSession,
  } from '../lib/readout';
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
  // With battery readings, room on the right for the scale of the value drawn over the temperature,
  // kept when it shows the temperature too, so switching does not squeeze the lines sideways.
  const pad = $derived({ l: 34, r: seriesOf(detail).length > 1 ? 36 : 12, t: 26, b: 22 });

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
  // One value at a time over the temperature, faded behind it, on a scale of its own on the right
  // whose steps sit on the temperature's grid lines. Only what the session has readings of; the
  // arrows beside the readout under it, or a sideways swipe on the chart, move from one to the next.
  const available = $derived(seriesOf(detail));
  let pick = $state<SeriesKey>('temp');
  const sel = $derived(available.includes(pick) ? pick : 'temp');
  /** Which way the last switch went, so the new line comes in from that side. */
  let dir = $state(1);
  function step(d: -1 | 1) {
    const k = stepFrom(available, sel, d);
    if (k === sel) return;
    tap();
    dir = d;
    pick = k;
  }
  const around = $derived(neighbours(available, sel));
  /** Temperature and battery only (VENTY, VEAZY): a switch for the battery instead of arrows. */
  const pair = $derived(available.length === 2 && available[1] === 'battery');
  function showBattery(on: boolean) {
    if (on !== (sel === 'battery')) step(on ? 1 : -1);
  }
  const session = $derived<ReadoutSession>({
    detail, unit, live: summary.live, readySec: summary.readySec, endSec, peak: summary.peak, target: summary.target,
  });
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
    const oy = (v: number) => y(ticks[0] + ((conv(v) - from) / step) * tStep);
    let d = '';
    let gaps = false;
    pts.forEach((p, k) => {
      const X = x(p.t).toFixed(1);
      const Y = y(ticks[0] + ((p.v - from) / step) * tStep).toFixed(1);
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
    const end = pts[pts.length - 1];
    return { d, area, labels, oy, name: SERIES[key].name, end: { x: x(end.t), y: y(ticks[0] + ((end.v - from) / step) * tStep) } };
  });

  // Press and hold, then drag: a cursor on the nearest sample, every value at that moment in a
  // bubble and the shown one in the readout. It stays 2 s after the finger lifts. A plain drag
  // sideways switches the value instead, and anything more up than across scrolls the page.
  let svgEl: SVGSVGElement | undefined = $state();
  let scrubT = $state<number | null>(null);
  let drag = $state(0);
  const HOLD_MS = 350;
  let gesture: { id: number; x0: number; y0: number; at: number; mode: 'wait' | 'swipe' | 'scrub'; timer: ReturnType<typeof setTimeout> } | null = null;
  let fade: ReturnType<typeof setTimeout> | undefined;
  const switchable = $derived(ts.length > 1 && available.length > 1);
  // Press and hold reads any chart, the temperature alone (VOLCANO) too.
  const touchable = $derived(ts.length > 1);

  function scrubAt(clientX: number) {
    if (!svgEl) return;
    const px = clientX - svgEl.getBoundingClientRect().left;
    const t = t0 + ((px - pad.l) / Math.max(1, w - pad.l - pad.r)) * (t1 - t0);
    const i = nearestIndex(ts, t);
    if (i >= 0) scrubT = ts[i];
  }
  function down(e: PointerEvent) {
    if (!touchable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (gesture) clearTimeout(gesture.timer);
    const el = e.currentTarget as Element;
    const id = e.pointerId;
    gesture = {
      id, x0: e.clientX, y0: e.clientY, at: e.timeStamp, mode: 'wait',
      timer: setTimeout(() => {
        if (!gesture || gesture.id !== id || gesture.mode !== 'wait') return;
        gesture.mode = 'scrub';
        clearTimeout(fade);
        try { el.setPointerCapture(id); } catch { /* the finger is already gone */ }
        scrubAt(gesture.x0);
      }, HOLD_MS),
    };
  }
  function move(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x0;
    if (gesture.mode === 'wait') {
      const intent = swipeIntent(dx, e.clientY - gesture.y0);
      if (intent === 'wait') return;
      clearTimeout(gesture.timer);
      // With one value there is nothing to swipe to: a sideways move is left alone, as a scroll is.
      if (intent === 'scroll' || !switchable) {
        gesture = null;
        return;
      }
      gesture.mode = 'swipe';
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    if (gesture.mode === 'swipe') drag = dx;
    else scrubAt(e.clientX);
  }
  function up(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.id) return;
    clearTimeout(gesture.timer);
    if (gesture.mode === 'swipe' && e.type === 'pointerup') {
      const d = swipeStep(e.clientX - gesture.x0, e.timeStamp - gesture.at, w);
      if (d) step(d);
    }
    if (gesture.mode === 'scrub') fade = setTimeout(() => (scrubT = null), 2000);
    gesture = null;
    drag = 0;
  }
  // Holding still and then moving up or down would scroll the page from under the cursor. Touch
  // listeners Svelte adds are passive, so this one is added by hand to be allowed to stop that.
  $effect(() => {
    const el = svgEl;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (gesture && gesture.mode !== 'wait' && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  });
  $effect(() => () => clearTimeout(fade));
  // A different session or value drops the cursor.
  $effect(() => {
    void summary.id;
    void sel;
    scrubT = null;
  });

  const cursor = $derived.by(() => {
    if (scrubT === null) return null;
    const t = scrubT;
    const v = valueAt(session, sel, t);
    const cy = v === null ? null : sel === 'temp' ? y(v) : overlay ? overlay.oy(v) : null;
    const vals = valuesAt(session, available, t);
    const main = vals.find((r) => r.key === sel)!;
    return { x: x(t), y: cy, time: timeLabel(t, endSec), main: main.text, rest: vals.filter((r) => r.key !== sel), right: x(t) < w / 2 };
  });
  const readout = $derived(
    readoutLine(session, sel, scrubT !== null ? { kind: 'at', t: scrubT } : running ? { kind: 'now' } : { kind: 'summary' }),
  );

  // While the session runs, every value it has right now, the one on the chart picked out. Without a
  // live temperature (VENTY, VEAZY) the temperature is what the device is set to.
  const nowRow = $derived.by(() => {
    if (!running || !detail || !ts.length) return [];
    return available.map((key) => {
      const v = key === 'temp' && !summary.live ? detail.g[ts.length - 1] : latest(session, key);
      const tag = key === 'batteryTemp' ? 'batt' : key === 'temp' && !summary.live ? 'set' : '';
      return { key, text: formatValue(key, v, unit), tag };
    });
  });

  // The start, the end (or now) and how long the cool-down ran.
  const xLabels = $derived.by(() => {
    const stop = endSec ?? last;
    const out = [{ t: 0, text: '0:00', anchor: 'start' }];
    if (x(stop) - x(0) > 40) {
      out.push({ t: stop, text: endSec === null ? `Now ${mmss(stop)}` : mmss(stop), anchor: x(t1) - x(stop) > 20 ? 'middle' : 'end' });
    }
    if (endSec !== null && x(t1) - x(endSec) > 50) out.push({ t: t1, text: `+${mmss(Math.round(t1 - endSec))}`, anchor: 'end' }); // readings are whole seconds, the end is not
    return out;
  });
</script>

<div class="chart" bind:clientWidth={w}>
  {#if nowRow.length}
    <div class="now num">
      <span class="now-label">Now</span>
      {#each nowRow as r (r.key)}
        <span class:on={r.key === sel && switchable}>{r.text}{#if r.tag}<em>&nbsp;{r.tag}</em>{/if}</span>
      {/each}
    </div>
  {/if}
  {#if ts.length > 1}
    <div class="plot">
    <!-- Pointer handling is for touch and the mouse; the arrows below are what keyboards and assistive tech use. -->
    <svg width={w} height={H} viewBox="0 0 {w} {H}" role="img" class:overlaid={!!overlay} class:touchable bind:this={svgEl}
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} oncontextmenu={(e) => touchable && e.preventDefault()}
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
      <!-- The lines follow a sideways swipe a little, so the chart shows it is listening. -->
      <g class="data" class:dragging={drag !== 0} style:transform="translateX({Math.max(-24, Math.min(24, drag * 0.3))}px)">
        {#if area && !overlay}<path class="area" d={area} />{/if}
        <g class="temps">
          <path class="goal" d={goalPath} />
          {#if beforePath}<path class="current off" d={beforePath} />{/if}
          {#if afterPath}<path class="current off" d={afterPath} />{/if}
          {#if currentPath}<path class="current" d={currentPath} />{/if}
        </g>
        {#key sel}
          <g class="switched" style:--dir={dir}>
            {#if overlay}
              {#if overlay.area}<path class="ov-area" d={overlay.area} />{/if}
              <path class="ov" d={overlay.d} />
              {#each overlay.labels as l (l.y)}
                <text class="ov-axis" x={w - pad.r + 4} y={l.y + 3.5}>{l.text}</text>
              {/each}
            {:else if ready}
              <line class="ready-line" x1={ready.x} x2={ready.x} y1={pad.t} y2={H - pad.b} />
              <circle class="ready-dot" cx={ready.x} cy={ready.y} r="5" />
              <text class="ready-label" x={Math.min(ready.x + 8, w - pad.r - 64)} y={H - pad.b - 8}>Ready {mmss(summary.readySec ?? 0)}</text>
            {/if}
          </g>
        {/key}
        {#if end && !overlay}
          {#if running}<circle class="pulse" cx={end.x} cy={end.y} r="5" />{/if}
          <circle class="end" class:off={!!afterPath} cx={end.x} cy={end.y} r="4.5" />
        {:else if overlay && running}
          <circle class="ov-end" cx={overlay.end.x} cy={overlay.end.y} r="5" />
        {/if}
      </g>
      {#if cursor}
        <line class="cursor" x1={cursor.x} x2={cursor.x} y1={pad.t - 12} y2={H - pad.b} />
        {#if cursor.y !== null}<circle class="cursor-dot" cx={cursor.x} cy={cursor.y} r="5.5" />{/if}
      {/if}
    </svg>
    {#if cursor}
      <span class="pill-time num" style:left="{cursor.x}px" aria-hidden="true">{cursor.time}</span>
      <div class="bubble num" class:right={cursor.right} aria-hidden="true">
        <span class="b-time">At {cursor.time}</span>
        <span class="b-main">{cursor.main}</span>
        {#if cursor.rest.length}
          <span class="b-rest">
            {#each cursor.rest as r (r.key)}<span>{r.text}{#if r.tag}<em>&nbsp;{r.tag}</em>{/if}</span>{/each}
          </span>
        {/if}
      </div>
    {/if}
    </div>
    <div class="legend">
      {#if overlay}
        <span><i class="sw ov"></i>{legendName(sel, unit)}</span>
        <span><i class="sw current faded"></i>{summary.live ? 'Temperature' : 'At temperature'}</span>
      {:else}
        {#if summary.live}<span><i class="sw current"></i>Temperature</span>{:else if summary.readySec !== null}<span><i class="sw current"></i>At temperature</span>{/if}
        <span><i class="sw goal"></i>Target</span>
      {/if}
      <!-- With the switcher the chart's own labels (BOOST, Off) say these, and the legend stays one line. -->
      {#if !switchable}
        {#if bands.length}<span><i class="sw band"></i>Boost</span>{/if}
        <span><i class="sw off"></i>Heater off</span>
      {/if}
    </div>
    {#if switchable && pair}
      <div class="switch-row">
        <span>Battery on the chart</span>
        <Toggle label="Battery on the chart" on={sel === 'battery'} onchange={showBattery} />
      </div>
    {:else if switchable && around}
      <!-- The value on the chart and its number, between arrows to the ones on either side. -->
      <div class="stepper">
        <button type="button" class="arrow press" aria-label="Previous value: {SERIES[around.prev].name}" onclick={() => step(-1)}>
          <Icon name="back" size={20} stroke={2.6} />
        </button>
        <button type="button" class="readout num press" aria-label="{[SERIES[sel].name, readout].filter(Boolean).join(', ')}. Tap for the next value" onclick={() => step(1)}>
          <strong>{SERIES[sel].name}</strong>
          <!-- It wraps between its parts only, never between a number and its unit. -->
          <span>{#each readout.split(' · ') as part, i (i)}{#if i}{' · '}{/if}<span class="part">{part}</span>{/each}</span>
        </button>
        <button type="button" class="arrow press" aria-label="Next value: {SERIES[around.next].name}" onclick={() => step(1)}>
          <Icon name="chevron" size={20} stroke={2.6} />
        </button>
      </div>
      <!-- Where the shown value sits among the others; the arrows are what to touch. -->
      <div class="dots" aria-hidden="true">
        {#each available as k (k)}<i class:on={k === sel}></i>{/each}
      </div>
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
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
  .legend span {
    display: flex;
    white-space: nowrap;
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
  }
  .ov-end {
    fill: var(--navy-fill);
    stroke: var(--card);
    stroke-width: 2;
  }
  .sw.ov {
    background: var(--navy);
  }
  .sw.faded {
    opacity: 0.35;
  }
  .plot {
    position: relative;
  }
  /* Sideways moves are the chart's own (swipe, scrub); up and down still scroll the page. */
  svg.touchable {
    touch-action: pan-y;
    -webkit-touch-callout: none;
  }
  .data {
    transition: transform 0.2s ease-out;
  }
  .data.dragging {
    transition: none;
  }
  .temps,
  .band,
  .mark {
    transition: opacity 0.2s;
  }
  .switched {
    animation: switch-in 0.22s ease-out;
  }
  @keyframes switch-in {
    from {
      opacity: 0;
      transform: translateX(calc(var(--dir) * 14px));
    }
  }
  .cursor {
    stroke: var(--navy);
    stroke-width: 1.5;
  }
  .cursor-dot {
    fill: var(--navy-fill);
    stroke: var(--card);
    stroke-width: 2;
  }
  /* Every value at the held moment, on the side away from the finger's line. */
  .bubble {
    position: absolute;
    top: 14px;
    left: 38px;
    width: 140px;
    padding: 8px 10px;
    border-radius: 14px;
    background: var(--card);
    box-shadow: 0 6px 22px rgba(0, 26, 77, 0.18), 0 0 0 1px var(--line);
    display: flex;
    flex-direction: column;
    gap: 3px;
    pointer-events: none;
  }
  .bubble.right {
    left: auto;
    right: 14px;
  }
  .b-time {
    font-size: 11px;
    font-weight: 800;
    color: var(--muted-2);
  }
  .b-main {
    font-size: 22px;
    line-height: 24px;
    font-weight: 800;
    color: var(--navy);
  }
  .b-rest {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
  }
  .b-rest em {
    font-style: normal;
    font-weight: 600;
    color: var(--muted);
  }
  /* Every value now, while the session runs. */
  .now {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 9px;
    padding: 8px 10px;
    margin-bottom: 12px;
    border-radius: 14px;
    background: var(--card-2);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ink);
  }
  .now span {
    white-space: nowrap;
  }
  .now .on {
    color: var(--navy);
  }
  .now em {
    font-style: normal;
    font-weight: 600;
    color: var(--muted);
  }
  .now .now-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    /* Ready's green, deep enough to read on the grey in either theme. */
    color: color-mix(in srgb, var(--led-ready) 60%, var(--ink));
  }
  /* The held moment, over the cursor's line. */
  .pill-time {
    position: absolute;
    top: -3px;
    width: 40px;
    height: 17px;
    margin-left: -20px;
    border-radius: 9px;
    background: var(--navy-fill);
    color: #fff;
    font-size: 10px;
    line-height: 17px;
    font-weight: 800;
    text-align: center;
    pointer-events: none;
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin: 8px 0 4px;
  }
  .dots i {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--navy) 28%, transparent);
    transition: width 0.2s, background-color 0.2s;
  }
  .dots i.on {
    width: 20px;
    background: var(--navy);
  }
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    padding: 4px 9px 4px 14px;
    margin: 12px 0 4px;
    border-radius: 14px;
    background: var(--card-2);
    font-size: 15px;
    font-weight: 800;
    color: var(--navy);
  }
  /* The readout between its arrows; every part a 44 px target or more. */
  .stepper {
    display: flex;
    align-items: stretch;
    gap: 6px;
    margin-top: 12px;
  }
  .stepper button {
    min-height: 52px;
    border: 0;
    border-radius: 14px;
    background: var(--card-2);
    font-family: inherit;
    cursor: pointer;
  }
  .arrow {
    width: 44px;
    flex-shrink: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--navy);
  }
  .readout {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 14px;
  }
  .readout strong {
    font-size: 15px;
    font-weight: 800;
    color: var(--navy);
    white-space: nowrap;
  }
  .readout .part {
    white-space: nowrap;
  }
  .readout > span {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted-2);
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
