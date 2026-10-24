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
  const pad = { l: 34, r: 12, t: 18, b: 22 };

  const ts = $derived(detail?.ts ?? []);
  const span = $derived(Math.max(60, ts[ts.length - 1] ?? 0));
  const values = $derived([...(detail?.g ?? []), ...((detail?.c ?? []).filter((c) => c !== null) as number[])]);
  // The scale in steps of 20, a little room above the highest value.
  const lo = $derived(values.length ? Math.max(0, Math.floor((Math.min(...values) - 5) / 20) * 20) : 0);
  const hi = $derived(values.length ? Math.ceil((Math.max(...values) + 5) / 20) * 20 : 220);
  const x = (t: number) => pad.l + (t / span) * (w - pad.l - pad.r);
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
    if (open) out.push({ ...open, to: span });
    return out;
  });
  const lastI = $derived(ts.length - 1);
  const end = $derived.by(() => {
    if (lastI < 0) return null;
    const v = summary.live ? detail!.c[lastI] : detail!.g[lastI];
    return v === null ? null : { x: x(ts[lastI]), y: y(v) };
  });
  const ready = $derived(summary.readySec === null || !detail ? null : {
    x: x(summary.readySec),
    y: y(detail.g[ts.findIndex((t) => t >= summary.readySec!)] ?? detail.g[lastI]),
  });
  const xLabels = $derived(span >= 120 ? [0, span / 2, span] : [0, span]);
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
      {#each bands as b (b.from)}
        <rect class="band" x={x(b.from)} y={pad.t - 12} width={Math.max(2, x(b.to) - x(b.from))} height={H - pad.b - pad.t + 12} rx="6" />
        <text class="band-label" x={x(b.from) + 6} y={pad.t - 2}>{b.mode === 'superboost' ? 'SUPER' : 'BOOST'}</text>
      {/each}
      {#each ticks as v (v)}
        <line class="grid" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
        <text class="axis" x={pad.l - 6} y={y(v) + 3.5} text-anchor="end">{toUnit(v, unit)}°</text>
      {/each}
      {#each xLabels as t, i (i)}
        <text class="axis" x={x(t)} y={H - 6} text-anchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}>{mmss(t)}</text>
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
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--muted);
  }
</style>
