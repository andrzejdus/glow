<script lang="ts">
  type Name =
    | 'back' | 'plus' | 'minus' | 'flame' | 'fan' | 'check' | 'bell' | 'play' | 'pause' | 'stop'
    | 'control' | 'workflows' | 'stats' | 'settings' | 'clock' | 'bolt' | 'arrow' | 'refresh';
  interface Props {
    name: Name;
    size?: number;
    color?: string;
    stroke?: number;
    class?: string;
  }
  let { name, size = 22, color = 'currentColor', stroke = 2.2, class: cls = '' }: Props = $props();
</script>

<svg class={cls} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width={stroke}
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'back'}<path d="M15 5l-7 7 7 7" />
  {:else if name === 'plus'}<path d="M5 12h14M12 5v14" />
  {:else if name === 'minus'}<path d="M5 12h14" />
  {:else if name === 'flame'}<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3-1-3 0-5.5 0-8z" />
  {:else if name === 'fan'}<g class="fan"><path d="M12 12c0-4 1-8 4-8s2 5-4 8z" /><path d="M12 12c4 0 8 1 8 4s-5 2-8-4z" /><path d="M12 12c0 4-1 8-4 8s-2-5 4-8z" /><path d="M12 12c-4 0-8-1-8-4s5-2 8 4z" /></g>
  {:else if name === 'check'}<path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'bell'}<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" />
  {:else if name === 'play'}<path d="M7 4.5v15l12-7.5z" fill={color} stroke="none" />
  {:else if name === 'pause'}<path d="M8 5v14M16 5v14" />
  {:else if name === 'stop'}<rect x="5" y="5" width="14" height="14" rx="2" fill={color} stroke="none" />
  {:else if name === 'control'}<path d="M12 14V5" /><circle cx="12" cy="17" r="3" />
  {:else if name === 'workflows'}<path d="M4 6h10M4 12h16M4 18h7" />
  {:else if name === 'stats'}<path d="M5 20v-7M12 20V5M19 20v-11" />
  {:else if name === 'settings'}<circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  {:else if name === 'clock'}<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  {:else if name === 'bolt'}<path d="M13 3L5 13h6l-1 8 8-10h-6z" />
  {:else if name === 'arrow'}<path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === 'refresh'}<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  {/if}
</svg>

<style>
  svg :global(.fan) {
    transform-origin: 12px 12px;
  }
</style>
