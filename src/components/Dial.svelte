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
    onstep: (delta: number) => void;
  }
  let { current, target, min, max, heating, ready, unit, offline = false, scale = 1, onstep }: Props = $props();

  const R = 114;
  const C = 2 * Math.PI * R;
  const ARC = C * 0.75;

  const shown = new Tween(0, { duration: 700, easing: cubicOut });
  $effect(() => {
    if (current !== undefined) shown.target = current;
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
  <div class="face"></div>
  <!-- Rings like the Connect screen's, in the LED colour: fast while heating, slow when ready. -->
  <div class="rings {led}" aria-hidden="true">
    <span></span><span></span><span></span>
  </div>
  <svg width="256" height="256" viewBox="0 0 256 256" role="img"
    aria-label="Now {current === undefined ? 'unknown' : toUnit(current, unit)}°{unit}, target {target === undefined ? 'unknown' : toUnit(target, unit)}°{unit}">
    <defs>
      <linearGradient id="heat" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#FFB27A" />
        <stop offset="1" stop-color="#FF6600" />
      </linearGradient>
    </defs>
    <circle cx="128" cy="128" r={R} fill="none" stroke="rgba(0,40,125,.07)" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="{ARC} {C}" transform="rotate(135 128 128)" />
    <circle cx="128" cy="128" r={R} fill="none" stroke="url(#heat)" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="{ARC * frac(shown.current)} {C}" transform="rotate(135 128 128)" />
    <circle class="mark" cx={128 + R * Math.cos(angle)} cy={128 + R * Math.sin(angle)} r="8" fill="#fff" stroke="#00287D"
      stroke-width="2.5" />
  </svg>
  <div class="center">
    <div class="label">Now</div>
    <div class="now num">
      {current === undefined ? '–' : toUnit(shown.current, unit)}<span class="unit">°{unit}</span>
    </div>
    <div class="target num">Target <strong>{target === undefined ? '–' : toUnit(target, unit)}°{unit}</strong></div>
  </div>
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
  .face {
    position: absolute;
    inset: 28px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 4px rgba(0, 26, 77, 0.04), 0 24px 48px rgba(0, 26, 77, 0.1), inset 0 0 0 1px rgba(0, 40, 125, 0.05);
  }
  .rings {
    position: absolute;
    inset: 28px;
    border-radius: 50%;
    overflow: hidden;
    pointer-events: none;
    --led-tint: rgba(224, 48, 30, 0);
    /* --led-tint does not inherit (it is registered to transition), so the rings take it via color. */
    color: var(--led-tint);
    transition: --led-tint 1.2s ease;
  }
  .rings span {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid currentColor;
    opacity: 0;
  }
  .rings.heating {
    --led-tint: #e0301e;
    --ring: 1.6s;
  }
  .rings.ready {
    --led-tint: #1f9d55;
    --ring: 3.6s;
  }
  .rings:not(.off) span {
    animation: ring var(--ring) cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
  }
  .rings:not(.off) span:nth-child(2) {
    animation-delay: calc(var(--ring) / -3);
  }
  .rings:not(.off) span:nth-child(3) {
    animation-delay: calc(var(--ring) / -1.5);
  }
  @keyframes ring {
    0% { transform: scale(0.35); opacity: 0.7; }
    100% { transform: scale(1); opacity: 0; }
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .mark {
    transition: cx 0.45s ease, cy 0.45s ease;
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
