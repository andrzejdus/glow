<script lang="ts">
  import { tap } from '../lib/connection.svelte';

  interface Props {
    id: string;
    min: number;
    max: number;
    step: number;
    value: number;
    /** The factory value: drawn as a line on the track, and the thumb is pulled onto it. */
    defaultValue?: number;
    /** Shown but not adjustable, in black and white. */
    disabled?: boolean;
    onchange: (value: number) => void;
  }
  let { id, min, max, step, value, defaultValue, disabled = false, onchange }: Props = $props();

  /** How far either side of the factory value the thumb is pulled onto it, in steps. */
  const PULL = 0.75;
  /** How far a finger goes sideways before the slider takes it (px). */
  const SLOP = 8;
  const THUMB = 26;

  const span = $derived(Math.max(step, max - min));
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / span));
  const hasDefault = $derived(defaultValue !== undefined && defaultValue >= min && defaultValue <= max);

  function set(raw: number) {
    let next = Math.round((raw - min) / step) * step + min;
    if (hasDefault && Math.abs(raw - (defaultValue as number)) <= PULL * step) next = defaultValue as number;
    next = Math.max(min, Math.min(max, next));
    if (next === value) return next;
    if (next === defaultValue) tap();
    onchange(next);
    return next;
  }

  // Keyboard and screen readers still use the range input.
  function input(e: Event & { currentTarget: HTMLInputElement }) {
    // Show the thumb where the value landed, so the pull onto the factory value is visible.
    e.currentTarget.value = String(set(Number(e.currentTarget.value)));
  }

  // Fingers and the mouse: the range input jumps to wherever a touch lands, so a scroll that
  // started on the track changed the setting. The slider moves only once the pointer goes
  // sideways, and by how far it went, never to where it landed.
  let drag = $state<{ id: number; x: number; y: number; from: number; width: number; on: boolean } | null>(null);
  function down(e: PointerEvent & { currentTarget: HTMLElement }) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: value, width: e.currentTarget.clientWidth, on: false };
  }
  function move(e: PointerEvent & { currentTarget: HTMLElement }) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.on) {
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(e.clientY - drag.y)) return;
      drag.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    set(drag.from + (dx / Math.max(1, drag.width - THUMB)) * span);
  }
  function up(e: PointerEvent) {
    if (drag?.id === e.pointerId) drag = null;
  }
</script>

<!-- The pointer handling is for touch and mouse only; the input inside is what assistive tech sees. -->
<div class="slider" role="presentation" class:disabled class:dragging={drag?.on} class:at-default={hasDefault && value === defaultValue}
  style:--p={frac(value)} style:--d={hasDefault ? frac(defaultValue as number) : -1}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  {#if hasDefault}<span class="tick" aria-hidden="true"></span>{/if}
  <input {id} type="range" {min} {max} step={step / 10} {value} {disabled} oninput={input}
    aria-valuetext={hasDefault && value === defaultValue ? `${value}, factory setting` : String(value)} />
</div>

<style>
  .slider {
    position: relative;
    height: 32px;
    margin-top: 2px;
    /* Up and down scroll the page; sideways is the slider's. */
    touch-action: pan-y;
    --thumb: 26px;
    --at: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--p));
    --tick-at: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--d));
  }
  /* The factory mark: a short line across the track, behind the thumb. */
  .tick {
    position: absolute;
    left: var(--tick-at);
    top: 50%;
    width: 2px;
    height: 16px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--navy) 40%, transparent);
    transform: translate(-50%, -50%);
    transition: background 0.2s ease, height 0.2s ease;
  }
  .at-default .tick {
    background: var(--orange-ink);
    height: 20px;
  }
  input {
    position: relative;
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 32px;
    margin: 0;
    background: transparent;
    pointer-events: none;
  }
  input::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--orange) var(--at), var(--track) var(--at));
  }
  /* The track hides the middle of the tick; draw that part on the track itself. */
  .slider:has(.tick) input::-webkit-slider-runnable-track {
    background:
      linear-gradient(to right, transparent calc(var(--tick-at) - 1px), color-mix(in srgb, var(--navy) 40%, transparent) calc(var(--tick-at) - 1px),
        color-mix(in srgb, var(--navy) 40%, transparent) calc(var(--tick-at) + 1px), transparent calc(var(--tick-at) + 1px)),
      linear-gradient(to right, var(--orange) var(--at), var(--track) var(--at));
  }
  .at-default input::-webkit-slider-runnable-track {
    background: linear-gradient(to right, var(--orange) var(--at), var(--track) var(--at));
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: var(--thumb);
    height: var(--thumb);
    margin-top: -10px;
    border-radius: 50%;
    background: var(--knob);
    box-shadow: 0 2px 8px rgba(0, 26, 77, 0.25);
    border: 0;
    transition: transform 0.15s ease;
  }
  .dragging input::-webkit-slider-thumb {
    transform: scale(1.1);
  }
  .slider.disabled {
    filter: grayscale(1);
    opacity: 0.6;
  }
  .slider.disabled input::-webkit-slider-thumb {
    box-shadow: 0 0 0 1.5px var(--faint);
  }
  .slider.disabled input {
    transition: none;
  }
</style>
