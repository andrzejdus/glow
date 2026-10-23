<script lang="ts">
  interface Props {
    level: number;
    charging?: boolean;
    size?: 'sm' | 'lg';
  }
  let { level, charging = false, size = 'sm' }: Props = $props();

  const pct = $derived(Math.max(0, Math.min(100, Math.round(level))));
  const low = $derived(pct <= 15);
  // While charging, a lighter fill keeps rising from the charge level to full; nothing to show once full.
  const filling = $derived(charging && pct < 100);
  const uid = $props.id();
</script>

{#if size === 'lg'}
  <!-- Upright cell: terminal cap, rounded body, fill rising from the bottom. -->
  <svg class="lg" class:charging viewBox="0 0 64 112" width="64" height="112" role="img"
    aria-label="Battery {pct} percent{charging ? ', charging' : ''}">
    <defs>
      <linearGradient id="fill-{uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color={low ? '#E0561B' : '#FF9A52'} />
        <stop offset="1" stop-color={low ? '#C44B00' : '#FF6600'} />
      </linearGradient>
      <clipPath id="cell-{uid}">
        <rect x="9" y="17" width="46" height="86" rx="10" />
      </clipPath>
    </defs>
    <rect x="22" y="2" width="20" height="9" rx="3.5" style="fill: var(--navy)" />
    <rect x="3" y="10" width="58" height="100" rx="16" stroke-width="3.5" style="fill: var(--card); stroke: var(--navy)" />
    <g clip-path="url(#cell-{uid})">
      <rect x="9" y="17" width="46" height="86" style="fill: var(--card-2)" />
      <rect class="fill" x="9" y="17" width="46" height="86" fill="url(#fill-{uid})" style:transform="scaleY({pct / 100})" />
      {#if filling}<rect class="rise-v" x="9" y="17" width="46" height="86" fill="url(#fill-{uid})" style:--from={pct / 100} />{/if}
      <!-- glass highlight -->
      <rect x="14" y="21" width="6" height="78" rx="3" fill="#FFFFFF" opacity="0.28" />
    </g>
    {#if charging}
      <path class="bolt" d="M35 30 L23 56 H31 L28 78 L41 50 H33 Z" fill="#FFFFFF" stroke="#001A4D" stroke-width="2.5" stroke-linejoin="round" />
    {:else}
      <text x="32" y="66" text-anchor="middle" class="pct" style:fill={pct >= 55 ? '#001A4D' : 'var(--navy)'}>{pct}%</text>
    {/if}
  </svg>
{:else}
  <svg class="sm" viewBox="0 0 30 16" width="30" height="16" aria-hidden="true">
    <rect x="1" y="1.5" width="24" height="13" rx="4" fill="none" stroke-width="1.8" style="stroke: var(--navy)" />
    <rect x="26.2" y="5.2" width="2.8" height="5.6" rx="1.2" style="fill: var(--navy)" />
    <rect class="fill-h" x="3.4" y="3.9" width="19.2" height="8.2" rx="2.2" fill={low ? '#C44B00' : '#FF6600'}
      style:transform="scaleX({Math.max(0.06, pct / 100)})" />
    {#if filling}
      <rect class="rise-h" x="3.4" y="3.9" width="19.2" height="8.2" rx="2.2" fill={low ? '#C44B00' : '#FF6600'}
        style:--from={Math.max(0.06, pct / 100)} />
    {/if}
    {#if charging}
      <path d="M14.5 2.8 L9.8 8.8 H13.2 L11.8 13.2 L16.6 7.2 H13.2 Z" fill="#FFFFFF" stroke="#001A4D" stroke-width="0.9" stroke-linejoin="round" />
    {/if}
  </svg>
{/if}

<style>
  svg {
    display: block;
    flex-shrink: 0;
    overflow: visible;
  }
  .lg {
    filter: drop-shadow(0 10px 18px rgba(0, 40, 125, 0.16));
  }
  .fill {
    transform-box: fill-box;
    transform-origin: bottom;
    transition: transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1);
    animation: fill-in 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes fill-in {
    from { transform: scaleY(0); }
  }
  .fill-h {
    transform-box: fill-box;
    transform-origin: left;
    transition: transform 0.8s ease;
  }
  .rise-v {
    transform-box: fill-box;
    transform-origin: bottom;
    animation: rise-v 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes rise-v {
    0% { transform: scaleY(var(--from)); opacity: 0.45; }
    75% { transform: scaleY(1); opacity: 0.45; }
    100% { transform: scaleY(1); opacity: 0; }
  }
  .rise-h {
    transform-box: fill-box;
    transform-origin: left;
    animation: rise-h 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
  @keyframes rise-h {
    0% { transform: scaleX(var(--from)); opacity: 0.45; }
    75% { transform: scaleX(1); opacity: 0.45; }
    100% { transform: scaleX(1); opacity: 0; }
  }
  .bolt {
    animation: pulse 1.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
  .pct {
    font-family: var(--font);
    font-size: 15px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
</style>
