<script lang="ts">
  import type { DeviceKind } from '../lib/devices/types';
  // `kind: null` (no device known yet) cycles through every supported model.
  let { kind, scale = 1 }: { kind: DeviceKind | null; scale?: number } = $props();
  const uid = $props.id();
  const all: DeviceKind[] = ['venty', 'veazy', 'crafty', 'volcano'];
  const ribs = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i * 3.2);
</script>

<!-- Plain drawings of each device's shape in the app's colours, never product photos or logos. -->
{#snippet drawing(k: DeviceKind)}
  <svg viewBox="0 0 64 104" width="64" height="104" data-kind={k}>
    {#if k === 'venty' || k === 'veazy'}
      <!-- VENTY, and VEAZY: shorter, with LEDs instead of a display -->
      {@const top = k === 'veazy' ? 20 : 0}
      <defs>
        <clipPath id="{k}-{uid}">
          <path d="M15 {top + 10} Q15 {top + 7} 18 {top + 7} H46 Q49 {top + 7} 49 {top + 10} V96 Q49 103 42 103 H22 Q15 103 15 96 Z" />
        </clipPath>
      </defs>
      <path d="M17 {top + 9} V{top + 4} Q17 {top + 1.5} 20 {top + 1.5} H44 Q47 {top + 1.5} 47 {top + 4} V{top + 9} Z" fill="#001A4D" />
      <rect x="22" y={top + 2.6} width="13" height="3" rx="1.5" fill="#00287D" />
      <rect x="47" y={top + 9.5} width="3" height="6" rx="1.2" fill="#FF6600" />
      <g clip-path="url(#{k}-{uid})">
        <rect x="15" y={top + 7} width="34" height="96" fill="#00287D" />
        {#each ribs(top + 13, k === 'veazy' ? 8 : 10) as y (y)}
          <rect x="15" {y} width="34" height="1.1" fill="#001A4D" opacity="0.55" />
        {/each}
        <rect x="26" y={top + (k === 'veazy' ? 22 : 26)} width="12" height="2.4" rx="1.2" fill="#001A4D" />
        <rect x="15" y={top + (k === 'veazy' ? 39 : 45)} width="34" height="1.6" fill="#001A4D" />
        <rect x="15" y={top + 7} width="4" height="96" fill="#FFFFFF" opacity="0.08" />
      </g>
      {#if k === 'venty'}
        <rect x="22" y="57" width="20" height="13" rx="2.2" fill="#001A4D" />
        <rect x="24.5" y="59.5" width="11" height="4.5" rx="1" fill="#FF8A3D" />
        <rect x="24.5" y="66" width="9" height="1.6" rx="0.8" fill="#FF8A3D" opacity="0.8" />
        <circle cx="38.5" cy="66.8" r="0.9" fill="#FF8A3D" opacity="0.8" />
      {:else}
        {#each [26, 32, 38] as x (x)}<circle cx={x} cy="70" r="1.8" fill="#FF8A3D" />{/each}
      {/if}
      <path d="M32 76.5 L37.5 85 H26.5 Z" fill="#FF6600" stroke="#FF6600" stroke-width="2" stroke-linejoin="round" />
      <path d="M32 97.5 L37.5 89 H26.5 Z" fill="#FF6600" stroke="#FF6600" stroke-width="2" stroke-linejoin="round" />
      <path d="M32 80.2 V83.6 M30.3 81.9 H33.7 M30.3 92 H33.7" stroke="#001A4D" stroke-width="1" stroke-linecap="round" />
    {:else if k === 'crafty'}
      <!-- CRAFTY: a rounded block, the cooling unit on top with the mouthpiece, one button with an LED ring -->
      <rect x="21" y="6" width="9" height="16" rx="3.5" fill="#001A4D" />
      <rect x="23.5" y="7.5" width="4" height="3" rx="1.5" fill="#00287D" />
      <path d="M13 32 Q13 20 25 20 H39 Q51 20 51 32 V40 H13 Z" fill="#00287D" />
      {#each ribs(25, 4) as y (y)}<rect x="14" {y} width="36" height="1.1" fill="#001A4D" opacity="0.55" />{/each}
      <path d="M12 40 H52 V92 Q52 103 41 103 H23 Q12 103 12 92 Z" fill="#00287D" />
      <rect x="12" y="39.5" width="40" height="1.8" fill="#001A4D" />
      <rect x="12" y="41" width="4" height="56" fill="#FFFFFF" opacity="0.08" />
      <circle cx="32" cy="84" r="7.5" fill="#001A4D" />
      <circle cx="32" cy="84" r="7.5" fill="none" stroke="#FF6600" stroke-width="2" />
      <path d="M32 80 V84 M29 81.5 A4 4 0 1 0 35 81.5" fill="none" stroke="#FF8A3D" stroke-width="1.4" stroke-linecap="round" />
    {:else}
      <!-- VOLCANO: a cone-shaped base with display and buttons, the filling chamber on top -->
      <rect x="23" y="20" width="18" height="6" rx="2" fill="#001A4D" />
      <rect x="21" y="25" width="22" height="22" rx="3" fill="#00287D" />
      {#each ribs(29, 5) as y (y)}<rect x="21" {y} width="22" height="1.1" fill="#001A4D" opacity="0.55" />{/each}
      <path d="M17 47 H47 Q50 47 51 50 L59 97 Q60 103 54 103 H10 Q4 103 5 97 L13 50 Q14 47 17 47 Z" fill="#00287D" />
      <path d="M13 50 Q14 47 17 47 H20 L13 103 H10 Q4 103 5 97 Z" fill="#FFFFFF" opacity="0.08" />
      <rect x="22" y="62" width="20" height="11" rx="2" fill="#001A4D" />
      <rect x="24.5" y="64.5" width="11" height="4" rx="1" fill="#FF8A3D" />
      <circle cx="38.5" cy="66.5" r="0.9" fill="#FF8A3D" />
      <circle cx="25" cy="84" r="3.2" fill="#FF6600" />
      <circle cx="32" cy="84" r="3.2" fill="#FF6600" />
      <circle cx="39" cy="84" r="3.2" fill="#FF6600" />
      <rect x="5" y="100" width="54" height="3" rx="1.5" fill="#001A4D" opacity="0.6" />
    {/if}
  </svg>
{/snippet}

<div class="glyph" class:cycle={kind === null} style:transform="scale({scale})" aria-hidden="true">
  {#if kind === null}
    {#each all as k, i (k)}
      <div class="slot" style:animation-delay="{i * 2.5}s">{@render drawing(k)}</div>
    {/each}
  {:else}
    {@render drawing(kind)}
  {/if}
</div>

<style>
  .glyph {
    position: relative;
    width: 64px;
    height: 104px;
    flex-shrink: 0;
    filter: drop-shadow(0 8px 12px rgba(0, 40, 125, 0.22));
  }
  .glyph :global(svg) {
    display: block;
    overflow: visible;
  }
  .slot {
    position: absolute;
    inset: 0;
    opacity: 0;
    animation: model 10s ease-in-out infinite both;
  }
  /* Each model shows for a quarter of the cycle and cross-fades into the next. */
  @keyframes model {
    0% { opacity: 0; }
    5%, 22% { opacity: 1; }
    27%, 100% { opacity: 0; }
  }
</style>
