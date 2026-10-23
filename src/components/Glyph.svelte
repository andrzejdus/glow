<script lang="ts">
  import type { DeviceKind } from '../lib/devices/types';
  // One drawing for every device (the user's call): the VENTY shape in the app's own colours.
  let { kind, scale = 1 }: { kind: DeviceKind | null; scale?: number } = $props();
  const uid = $props.id();
  const ribs = Array.from({ length: 10 }, (_, i) => 13 + i * 3.2);
</script>

<!-- A plain drawing of the device shape, never a product photo or logo. -->
<svg class="glyph" data-kind={kind ?? 'venty'} style:transform="scale({scale})" viewBox="0 0 40 104" width="40" height="104"
  aria-hidden="true">
  <defs>
    <clipPath id="body-{uid}">
      <path d="M3 10 Q3 7 6 7 H34 Q37 7 37 10 V96 Q37 103 30 103 H10 Q3 103 3 96 Z" />
    </clipPath>
  </defs>
  <!-- mouthpiece, with the opening on top -->
  <path d="M5 9 V4 Q5 1.5 8 1.5 H32 Q35 1.5 35 4 V9 Z" fill="#001A4D" />
  <rect x="10" y="2.6" width="13" height="3" rx="1.5" fill="#00287D" />
  <rect x="35" y="9.5" width="3" height="6" rx="1.2" fill="#FF6600" />
  <g clip-path="url(#body-{uid})">
    <rect x="3" y="7" width="34" height="96" fill="#00287D" />
    <!-- cooling unit: ribbed, with an air slot -->
    {#each ribs as y (y)}
      <rect x="3" {y} width="34" height="1.1" fill="#001A4D" opacity="0.55" />
    {/each}
    <rect x="14" y="26" width="12" height="2.4" rx="1.2" fill="#001A4D" />
    <rect x="3" y="45" width="34" height="1.6" fill="#001A4D" />
    <!-- light from the left -->
    <rect x="3" y="7" width="4" height="96" fill="#FFFFFF" opacity="0.08" />
  </g>
  <!-- display: temperature and battery bar -->
  <rect x="10" y="57" width="20" height="13" rx="2.2" fill="#001A4D" />
  <rect x="12.5" y="59.5" width="11" height="4.5" rx="1" fill="#FF8A3D" />
  <rect x="12.5" y="66" width="9" height="1.6" rx="0.8" fill="#FF8A3D" opacity="0.8" />
  <circle cx="26.5" cy="66.8" r="0.9" fill="#FF8A3D" opacity="0.8" />
  <!-- + and − buttons -->
  <path d="M20 76.5 L25.5 85 H14.5 Z" fill="#FF6600" stroke="#FF6600" stroke-width="2" stroke-linejoin="round" />
  <path d="M20 97.5 L25.5 89 H14.5 Z" fill="#FF6600" stroke="#FF6600" stroke-width="2" stroke-linejoin="round" />
  <path d="M20 80.2 V83.6 M18.3 81.9 H21.7 M18.3 92 H21.7" stroke="#001A4D" stroke-width="1" stroke-linecap="round" />
</svg>

<style>
  .glyph {
    display: block;
    overflow: visible;
    filter: drop-shadow(0 8px 12px rgba(0, 40, 125, 0.22));
  }
</style>
