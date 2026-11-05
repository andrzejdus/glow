<script lang="ts">
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Slider from './Slider.svelte';
  import { cutOf, firstStop, removal, stopsFor, type StorageReport } from '../lib/cleanup';
  import { tap } from '../lib/connection.svelte';
  import { decimal, size } from '../lib/format';
  import { sessions } from '../lib/sessions.svelte';

  // Settings › App › Session history › Clean up: how much to keep, what that removes, and Remove.
  let { report, onclose }: { report: StorageReport; onclose: (removed: boolean) => void } = $props();

  const now = Date.now();
  const stops = $derived(stopsFor(report, now));
  // Opens on the longest stop that removes something.
  let at = $state(untrack(() => Math.max(0, firstStop(report, stops, now))));
  const stop = $derived(stops[at]);
  const gone = $derived(removal(report, cutOf(stop, now)));
  let busy = $state(false);

  const count = (n: number) => `${decimal(n, 0)} ${n === 1 ? 'session' : 'sessions'}`;

  function pick(i: number) {
    tap();
    at = i;
  }
  function cancel() {
    if (busy) return;
    tap();
    onclose(false);
  }
  async function remove() {
    if (busy || !gone.count) return;
    tap();
    busy = true;
    await sessions.prune(cutOf(stop, now)).catch(() => undefined);
    onclose(true);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel();
  }
</script>

<svelte:window onkeydown={key} />

<div class="backdrop" role="presentation" transition:fade={{ duration: 200 }} onclick={cancel}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cleanupTitle" transition:fly={{ y: 320, duration: 300 }}>
  <span class="grip" aria-hidden="true"></span>
  <h2 id="cleanupTitle">Clean up session history</h2>
  <div class="range-top">
    <label for="keep" class="name">Keep the last</label>
    <span class="value">{stop.label}</span>
  </div>
  <Slider id="keep" min={0} max={stops.length - 1} step={1} value={at} valueText={(i) => `Keep the last ${stops[i].label}`} onchange={pick} />
  <div class="ends" aria-hidden="true"><span>{stops[0].label}</span><span>{stops[stops.length - 1].label}</span></div>
  <div class="effect" class:none={!gone.count} role="status">
    {#if gone.count}
      <span class="label">Removes</span>
      <strong class="num">{count(gone.count)}</strong>
      <span class="num">{size(gone.bytes)}</span>
    {:else}
      <strong>Nothing older to remove</strong>
    {/if}
  </div>
  <p class="note">Stats will average only the sessions left. Hours of operation stay.</p>
  <div class="buttons">
    <button type="button" class="outline press" onclick={cancel} disabled={busy}>Cancel</button>
    <button type="button" class="primary press" onclick={remove} disabled={busy || !gone.count}>{busy ? 'Removing…' : 'Remove'}</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 10, 30, 0.45);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    max-width: 480px;
    margin: 0 auto;
    padding: 10px 20px calc(var(--sab) + 20px);
    border-radius: 28px 28px 0 0;
    background: var(--card);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--navy);
  }
  .grip {
    align-self: center;
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--track);
    margin-bottom: 6px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 800;
  }
  .range-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .name {
    font-size: 15px;
    font-weight: 700;
  }
  .value {
    font-size: 15px;
    font-weight: 800;
    color: var(--orange-ink);
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--muted);
    margin-top: -4px;
  }
  .effect {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 8px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--orange-tint);
    color: var(--orange-ink);
  }
  .effect .label {
    color: var(--orange-ink);
  }
  .effect strong {
    flex-grow: 1;
    font-size: 16px;
    font-weight: 800;
    color: var(--navy);
  }
  .effect span.num {
    font-size: 15px;
    font-weight: 700;
  }
  .effect.none {
    background: var(--bg);
  }
  .effect.none strong {
    font-size: 15px;
    font-weight: 700;
    color: var(--muted-2);
  }
  .note {
    margin: 2px 0 6px;
    font-size: 13px;
    line-height: 1.35;
    color: var(--muted);
  }
  .buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .buttons button {
    height: 52px;
    font-size: 16px;
  }
  .outline {
    border-radius: 999px;
    border: 1.5px solid var(--orange-ink);
    background: transparent;
    color: var(--orange-ink);
    font-weight: 800;
    cursor: pointer;
  }
  .primary {
    box-shadow: none;
  }
  .primary:disabled {
    background: var(--track);
    color: var(--muted);
    cursor: default;
  }
</style>
