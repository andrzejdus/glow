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
    {#if k === 'venty'}
      <!-- VENTY: mouthpiece with the side tab, ribbed cooling unit, display and the +/- buttons -->
      <defs>
        <clipPath id="venty-{uid}">
          <path d="M15 10 Q15 7 18 7 H46 Q49 7 49 10 V96 Q49 103 42 103 H22 Q15 103 15 96 Z" />
        </clipPath>
      </defs>
      <path d="M17 9 V4 Q17 1.5 20 1.5 H44 Q47 1.5 47 4 V9 Z" style="fill: var(--g-dark)" />
      <rect x="22" y="2.6" width="13" height="3" rx="1.5" style="fill: var(--g-body)" />
      <rect x="47" y="9.5" width="3" height="6" rx="1.2" fill="#FF6600" />
      <g clip-path="url(#venty-{uid})">
        <rect x="15" y="7" width="34" height="96" style="fill: var(--g-body)" />
        {#each ribs(13, 10) as y (y)}<rect x="15" {y} width="34" height="1.1" opacity="0.55" style="fill: var(--g-dark)" />{/each}
        <rect x="26" y="26" width="12" height="2.4" rx="1.2" style="fill: var(--g-dark)" />
        <rect x="15" y="45" width="34" height="1.6" style="fill: var(--g-dark)" />
        <rect x="15" y="7" width="4" height="96" fill="#FFFFFF" opacity="0.08" />
      </g>
      <rect x="22" y="57" width="20" height="13" rx="2.2" style="fill: var(--g-dark)" />
      <rect x="24.5" y="59.5" width="11" height="4.5" rx="1" fill="#FF8A3D" />
      <rect x="24.5" y="66" width="9" height="1.6" rx="0.8" fill="#FF8A3D" opacity="0.8" />
      <circle cx="38.5" cy="66.8" r="0.9" fill="#FF8A3D" opacity="0.8" />
      <path d="M32 76.5 L37.5 85 H26.5 Z" fill="#FF6600" stroke="#FF6600" stroke-width="2" stroke-linejoin="round" />
      <path d="M32 97.5 L37.5 89 H26.5 Z" fill="#FF6600" stroke="#FF6600" stroke-width="2" stroke-linejoin="round" />
      <path d="M32 80.2 V83.6 M30.3 81.9 H33.7 M30.3 92 H33.7" stroke-width="1" stroke-linecap="round" style="stroke: var(--g-dark)" />
    {:else if k === 'veazy'}
      <!-- VEAZY: as tall as VENTY but slimmer; ribbed cooling unit, a plain body narrowing to the bottom -->
      <path d="M19 9 V4 Q19 1.5 22 1.5 H42 Q45 1.5 45 4 V9 Z" style="fill: var(--g-dark)" />
      <rect x="23" y="2.6" width="11" height="3" rx="1.5" style="fill: var(--g-body)" />
      <defs>
        <clipPath id="veazy-cool-{uid}"><rect x="17" y="7" width="30" height="36" rx="2.5" /></clipPath>
      </defs>
      <g clip-path="url(#veazy-cool-{uid})">
        <rect x="17" y="7" width="30" height="36" style="fill: var(--g-body)" />
        {#each ribs(10, 10) as y (y)}<rect x="17" {y} width="30" height="1.3" opacity="0.6" style="fill: var(--g-dark)" />{/each}
        <rect x="27" y="23.5" width="10" height="2.4" rx="1.2" style="fill: var(--g-dark)" />
        <rect x="17" y="7" width="3.5" height="36" fill="#FFFFFF" opacity="0.08" />
      </g>
      <rect x="17.5" y="42" width="29" height="3" style="fill: var(--g-dark)" />
      <rect x="27.5" y="39" width="9" height="1.8" rx="0.9" style="fill: var(--g-dark)" />
      <path d="M16.5 46 Q16.5 44 18.5 44 H45.5 Q47.5 44 47.5 46 L45.5 99 Q45.3 103 41.5 103 H22.5 Q18.7 103 18.5 99 Z" style="fill: var(--g-body)" />
      <path d="M16.5 46 Q16.5 44 18.5 44 H21 L22.5 103 Q18.7 103 18.5 99 Z" fill="#FFFFFF" opacity="0.08" />
    {:else if k === 'crafty'}
      <!-- CRAFTY: a ribbed block, flat on top with the mouthpiece flush in it, a groove down the side, and a base band with the light bar -->
      <!-- Every drawing is centred on the canvas: this one is 78 tall, so it moves up 12. -->
      <g transform="translate(0 -12)">
      <defs>
        <clipPath id="crafty-{uid}">
          <path d="M9 30 Q9 25 13 25 H51 Q55 25 55 30 V97 Q55 103 49 103 H15 Q9 103 9 97 Z" />
        </clipPath>
      </defs>
      <g clip-path="url(#crafty-{uid})">
        <rect x="9" y="25" width="46" height="78" style="fill: var(--g-body)" />
        {#each Array.from({ length: 19 }, (_, i) => 31 + i * 3) as y (y)}
          <rect x="9" {y} width="46" height="1.3" opacity="0.6" style="fill: var(--g-dark)" />
        {/each}
        <rect x="9" y="25" width="46" height="4" opacity="0.35" style="fill: var(--g-dark)" />
        <rect x="25" y="25.8" width="16" height="2" rx="1" style="fill: var(--g-dark)" />
        <rect x="40.5" y="30" width="1.4" height="58" fill="#FFFFFF" opacity="0.28" />
        <rect x="9" y="25" width="4" height="66" fill="#FFFFFF" opacity="0.08" />
        <rect x="9" y="89" width="46" height="14" style="fill: var(--g-dark)" />
      </g>
      <rect x="13" y="94" width="10" height="3.6" rx="1.8" fill="#FF8A3D" />
      <rect x="54.5" y="92.5" width="2.2" height="6" rx="1" fill="#FF6600" />
      </g>
    {:else}
      <!-- VOLCANO: a wide cone with the triangular control panel, a ring at its foot and a low base -->
      <!-- 63 tall, centred: up 19.5 -->
      <g transform="translate(0 -19.5)">
      <rect x="25" y="40" width="14" height="7" rx="1.5" style="fill: var(--g-body)" />
      <rect x="25" y="40" width="14" height="2" rx="1" opacity="0.6" style="fill: var(--g-dark)" />
      <path d="M25.5 47 H38.5 L60 84 H4 Z" stroke-width="2" stroke-linejoin="round" style="fill: var(--g-body); stroke: var(--g-body)" />
      <path d="M25.5 47 H29 L12 84 H4 Z" fill="#FFFFFF" opacity="0.08" />
      <path d="M32 54 L48 80 H16 Z" stroke-width="5" stroke-linejoin="round" style="fill: var(--g-dark); stroke: var(--g-dark)" />
      <rect x="25.5" y="66" width="13" height="9" rx="1" style="fill: var(--g-darker)" />
      <rect x="27.5" y="67.5" width="8" height="2.2" rx="0.6" fill="#FF8A3D" />
      <rect x="27.5" y="71.2" width="8" height="2.2" rx="0.6" fill="#FFFFFF" opacity="0.75" />
      <rect x="17.5" y="72" width="6" height="3.4" rx="1.7" fill="#FF6600" />
      <rect x="40.5" y="72" width="6" height="3.4" rx="1.7" fill="#FF6600" />
      <rect x="2" y="84" width="60" height="5" rx="2" style="fill: var(--g-body)" />
      <rect x="2" y="84" width="60" height="1.6" rx="0.8" fill="#FFFFFF" opacity="0.15" />
      <rect x="6" y="89" width="52" height="11" rx="2" style="fill: var(--g-dark)" />
      <rect x="11" y="100" width="6" height="3" rx="1" style="fill: var(--g-dark)" />
      <rect x="47" y="100" width="6" height="3" rx="1" style="fill: var(--g-dark)" />
      </g>
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
    --g-body: #00287d;
    --g-dark: #001a4d;
    --g-darker: #000f33;
    position: relative;
    width: 64px;
    height: 104px;
    flex-shrink: 0;
    filter: drop-shadow(0 8px 12px rgba(0, 40, 125, 0.22));
  }
  /* Lighter blues on dark cards, so the drawing stays visible. */
  @media (prefers-color-scheme: dark) {
    .glyph {
      --g-body: #2c55c0;
      --g-dark: #1a326f;
      --g-darker: #0e1c45;
    }
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
