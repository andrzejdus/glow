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

  const span = $derived(Math.max(step, max - min));
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / span));
  const hasDefault = $derived(defaultValue !== undefined && defaultValue >= min && defaultValue <= max);

  function input(e: Event & { currentTarget: HTMLInputElement }) {
    const raw = Number(e.currentTarget.value);
    let next = Math.round((raw - min) / step) * step + min;
    if (hasDefault && Math.abs(raw - (defaultValue as number)) <= PULL * step) next = defaultValue as number;
    next = Math.max(min, Math.min(max, next));
    // Show the thumb where the value landed, so the pull onto the factory value is visible.
    e.currentTarget.value = String(next);
    if (next === value) return;
    if (next === defaultValue) tap();
    onchange(next);
  }
</script>

<div class="slider" class:disabled class:at-default={hasDefault && value === defaultValue}
  style:--p={frac(value)} style:--d={hasDefault ? frac(defaultValue as number) : -1}>
  {#if hasDefault}<span class="tick" aria-hidden="true"></span>{/if}
  <input {id} type="range" {min} {max} step={step / 10} {value} {disabled} oninput={input}
    aria-valuetext={hasDefault && value === defaultValue ? `${value}, factory setting` : String(value)} />
</div>

<style>
  .slider {
    position: relative;
    height: 32px;
    margin-top: 2px;
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
  input:active::-webkit-slider-thumb {
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
