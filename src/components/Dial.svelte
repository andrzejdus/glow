<script lang="ts">
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import { toUnit } from '../lib/format';

  interface Props {
    current: number | undefined;
    target: number | undefined;
    min: number;
    max: number;
    heating: boolean;
    ready: boolean;
    unit: 'C' | 'F';
    offline?: boolean;
    /** Shrinks the whole dial on short screens. */
    scale?: number;
    /** Heat levels shown as lamps on the dial, like warning lights on a car dashboard. */
    /** `fire`: the lit lamp burns (Superboost, or the target at the device's maximum). */
    lamps?: { id: string; label: string; on: boolean; fire?: boolean }[];
    onstep: (delta: number) => void;
  }
  let { current, target, min, max, heating, ready, unit, offline = false, scale = 1, lamps = [], onstep }: Props = $props();

  const R = 114;
  const C = 2 * Math.PI * R;
  const ARC = C * 0.75;

  // VENTY/VEAZY report no live temperature: the dial then shows the target, and the arc fills
  // up to it once the device says it is ready.
  const live = $derived(current !== undefined);
  const shown = new Tween(0, { duration: 700, easing: cubicOut });
  $effect(() => {
    if (current !== undefined) shown.target = current;
    else shown.target = heating && ready && target !== undefined ? target : min;
  });

  const frac = (c: number) => Math.max(0, Math.min(1, (c - min) / (max - min)));
  const warmth = $derived(heating ? frac(shown.current) : 0);
  // The LED inside the dial: red while heating, green when ready, nothing while off or offline.
  const led = $derived(offline || !heating ? 'off' : ready ? 'ready' : 'heating');
  const angle = $derived(((135 + 270 * frac(target ?? min)) * Math.PI) / 180);

  // Press and hold repeats the step.
  let repeat: ReturnType<typeof setTimeout> | undefined;
  function hold(delta: number) {
    onstep(delta);
    const again = (ms: number) => {
      repeat = setTimeout(() => {
        onstep(delta);
        again(70);
      }, ms);
    };
    again(420);
  }
  function release() {
    clearTimeout(repeat);
  }
</script>

<div class="dial" class:offline style:transform="scale({scale})">
  <div class="glow" class:pulse={heating} style:opacity={heating ? 0.35 + 0.65 * warmth : 0}></div>
  {#if ready}<div class="ready-ring"></div>{/if}
  <div class="face"></div>
  <div class="tint {led}" aria-hidden="true"></div>
  <svg width="256" height="256" viewBox="0 0 256 256" role="img"
    aria-label="Now {current === undefined ? 'unknown' : toUnit(current, unit)}°{unit}, target {target === undefined ? 'unknown' : toUnit(target, unit)}°{unit}">
    <defs>
      <linearGradient id="heat" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#FFB27A" />
        <stop offset="1" stop-color="#FF6600" />
      </linearGradient>
    </defs>
    <circle cx="128" cy="128" r={R} fill="none" style="stroke: var(--line)" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="{ARC} {C}" transform="rotate(135 128 128)" />
    <circle cx="128" cy="128" r={R} fill="none" stroke="url(#heat)" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="{ARC * frac(shown.current)} {C}" transform="rotate(135 128 128)" />
    <circle class="mark" cx={128 + R * Math.cos(angle)} cy={128 + R * Math.sin(angle)} r="8" style="fill: var(--card); stroke: var(--navy)"
      stroke-width="2.5" />
  </svg>
  <div class="center" class:with-lamps={lamps.length > 0}>
    {#if live}
      <div class="label">Now</div>
      <div class="now num">
        {toUnit(shown.current, unit)}<span class="unit">°{unit}</span>
      </div>
      <div class="target num">Target <strong>{target === undefined ? '–' : toUnit(target, unit)}°{unit}</strong></div>
    {:else}
      <div class="label">Target</div>
      <div class="now num">
        {target === undefined ? '–' : toUnit(target, unit)}<span class="unit">°{unit}</span>
      </div>
      <div class="target">No live reading on this device</div>
    {/if}
  </div>
  {#if lamps.length}
    <div class="lamps" role="group" aria-label="Heat level">
      {#each lamps as l (l.id)}
        <span class="lamp" class:on={l.on && !offline} class:fire={l.on && l.fire && !offline} aria-current={l.on ? 'true' : undefined}>
          {#if l.on && l.fire && !offline}<span class="flames" aria-hidden="true"><i></i><i></i><i></i></span>{/if}
          <span class="lamp-text">{l.label}</span>
        </span>
      {/each}
    </div>
  {/if}
  <button type="button" class="round step left press" aria-label="Lower target" disabled={offline}
    onpointerdown={() => hold(-1)} onpointerup={release} onpointerleave={release} onpointercancel={release}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onstep(-1)}>
    <Icon name="minus" size={20} color="var(--navy)" stroke={2.4} />
  </button>
  <button type="button" class="round step right press" aria-label="Raise target" disabled={offline}
    onpointerdown={() => hold(1)} onpointerup={release} onpointerleave={release} onpointercancel={release}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onstep(1)}>
    <Icon name="plus" size={20} color="var(--navy)" stroke={2.4} />
  </button>
</div>

<style>
  .dial {
    position: relative;
    width: 256px;
    height: 256px;
    flex-shrink: 0;
    transition: opacity 0.4s;
  }
  .dial.offline {
    opacity: 0.55;
  }
  .glow {
    position: absolute;
    inset: -14px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 102, 0, 0.5) 0%, rgba(255, 138, 61, 0.18) 40%, rgba(255, 102, 0, 0) 68%);
    transition: opacity 1s ease;
  }
  .glow.pulse {
    animation: glow 2.8s ease-in-out infinite;
  }
  @keyframes glow {
    0%, 100% { transform: scale(0.94); }
    50% { transform: scale(1.06); }
  }
  .ready-ring {
    position: absolute;
    inset: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--led-ready);
    animation: ready 1.9s ease-out infinite;
  }
  @keyframes ready {
    0% { transform: scale(0.85); opacity: 0.6; }
    100% { transform: scale(1.3); opacity: 0; }
  }
  .face {
    position: absolute;
    inset: 28px;
    border-radius: 50%;
    background: var(--card);
    box-shadow: 0 2px 4px rgba(0, 26, 77, 0.04), 0 24px 48px rgba(0, 26, 77, 0.1), inset 0 0 0 1px rgba(0, 40, 125, 0.05);
  }
  .tint {
    position: absolute;
    inset: 28px;
    border-radius: 50%;
    pointer-events: none;
    --led-tint: transparent;
    /* Glows out from the middle of the face and fades toward its rim. */
    background: radial-gradient(circle, var(--led-tint) 0%, rgba(255, 255, 255, 0) 54%);
    transition: --led-tint 1.2s ease;
  }
  .tint.heating {
    /* The same orange as the heat glow around the dial. */
    --led-tint: color-mix(in srgb, var(--orange) 50%, transparent);
    animation: breathe 1.4s ease-in-out infinite;
  }
  .tint.ready {
    --led-tint: color-mix(in srgb, var(--led-ready) 45%, transparent);
    animation: breathe 3.4s ease-in-out infinite;
  }
  /* On the dark face the palette green mixes into teal; a brighter, yellower green stays green. */
  @media (prefers-color-scheme: dark) {
    .tint.ready {
      --led-tint: color-mix(in srgb, #5fd35f 42%, transparent);
    }
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .mark {
    transition: cx 0.45s ease, cy 0.45s ease;
  }
  /* Below the numbers, between the - and + buttons. */
  .lamps {
    position: absolute;
    top: 172px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    pointer-events: none;
  }
  .lamp {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 3px 5px 2px;
    border-radius: 6px;
    border: 1px solid var(--line);
    color: var(--faint);
    opacity: 0.6;
    transition: color 0.35s ease, background 0.35s ease, border-color 0.35s ease, opacity 0.35s ease, text-shadow 0.35s ease;
  }
  .lamp.on {
    opacity: 1;
    color: var(--orange);
    border-color: color-mix(in srgb, var(--orange) 45%, transparent);
    background: color-mix(in srgb, var(--orange) 14%, transparent);
    text-shadow: 0 0 6px color-mix(in srgb, var(--orange) 70%, transparent);
    box-shadow: 0 0 10px color-mix(in srgb, var(--orange) 30%, transparent);
  }
  /* On fire: a rising fire gradient, a flickering glow and small flames licking up off the top. */
  .lamp {
    position: relative;
  }
  .lamp.fire {
    color: #fff;
    border-color: #ff8a00;
    background: linear-gradient(0deg, #d62800 0%, #ff5a00 35%, #ff9d00 70%, #ffd23f 100%);
    background-size: 100% 220%;
    text-shadow: 0 0 4px rgba(120, 20, 0, 0.8);
    animation: burn 0.9s ease-in-out infinite alternate, flicker 0.23s steps(2, end) infinite;
  }
  .lamp-text {
    position: relative;
  }
  .flames {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 10px;
    display: flex;
    justify-content: space-around;
    pointer-events: none;
  }
  .flames i {
    width: 6px;
    height: 9px;
    border-radius: 50% 50% 50% 50% / 70% 70% 30% 30%;
    background: radial-gradient(circle at 50% 80%, #ffe08a 0%, #ff8a00 45%, rgba(255, 60, 0, 0) 75%);
    transform-origin: 50% 100%;
    animation: lick 0.7s ease-in-out infinite;
  }
  .flames i:nth-child(2) {
    height: 11px;
    animation-delay: -0.25s;
    animation-duration: 0.6s;
  }
  .flames i:nth-child(3) {
    animation-delay: -0.45s;
  }
  @keyframes burn {
    from { background-position: 0 100%; box-shadow: 0 0 8px rgba(255, 90, 0, 0.55), 0 -2px 12px rgba(255, 160, 0, 0.35); }
    to { background-position: 0 0; box-shadow: 0 0 14px rgba(255, 90, 0, 0.8), 0 -4px 18px rgba(255, 180, 0, 0.5); }
  }
  @keyframes flicker {
    50% { filter: brightness(1.12); }
  }
  @keyframes lick {
    0%, 100% { transform: scaleY(0.7) translateY(2px); opacity: 0.75; }
    50% { transform: scaleY(1.15) translateY(-1px); opacity: 1; }
  }
  /* Room for the lamps under the numbers, where the face is still wide enough. */
  .center.with-lamps {
    padding-bottom: 34px;
  }
  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .now {
    font-size: 76px;
    line-height: 1;
    font-weight: 200;
    color: var(--navy);
    letter-spacing: -0.04em;
    margin-top: 2px;
  }
  .unit {
    font-size: 24px;
    font-weight: 500;
    vertical-align: top;
    color: var(--orange-ink);
    margin-left: 2px;
    letter-spacing: 0;
  }
  .target {
    font-size: 13px;
    color: var(--muted);
    margin-top: 6px;
  }
  .target strong {
    color: var(--navy);
  }
  .step {
    position: absolute;
    bottom: 2px;
    width: 52px;
    height: 52px;
    box-shadow: 0 4px 14px rgba(0, 26, 77, 0.1);
    touch-action: manipulation;
  }
  .step:disabled {
    cursor: default;
  }
  .left {
    left: 16px;
  }
  .right {
    right: 16px;
  }
</style>
