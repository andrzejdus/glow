<script lang="ts">
  import Icon from './Icon.svelte';
  import { tap } from '../lib/connection.svelte';
  import type { Tab } from '../lib/nav';
  interface Props {
    tab: Tab;
    workflows: boolean;
    onselect: (tab: Tab) => void;
  }
  let { tab, workflows, onselect }: Props = $props();

  const tabs = $derived(
    [
      { id: 'control' as const, label: 'Control', icon: 'control' as const },
      ...(workflows ? [{ id: 'workflows' as const, label: 'Workflows', icon: 'workflows' as const }] : []),
      { id: 'settings' as const, label: 'Settings', icon: 'settings' as const },
    ],
  );
  const index = $derived(Math.max(0, tabs.findIndex((t) => t.id === tab)));
</script>

<nav aria-label="Main" style:--count={tabs.length}>
  <span class="indicator" style:transform="translateX({index * 100}%)"></span>
  {#each tabs as t (t.id)}
    <button type="button" class:active={t.id === tab} aria-current={t.id === tab ? 'page' : undefined}
      onclick={() => { tap(); onselect(t.id); }}>
      <Icon name={t.icon} size={24} color={t.id === tab ? 'var(--orange)' : 'var(--muted-2)'} />
      {t.label}
    </button>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    padding-bottom: var(--sab);
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(16px);
    border-top: 1px solid var(--line);
    display: grid;
    grid-template-columns: repeat(var(--count), minmax(0, 1fr));
  }
  .indicator {
    position: absolute;
    top: -1px;
    left: 0;
    width: calc(100% / var(--count));
    height: 3px;
    display: flex;
    justify-content: center;
    transition: transform 0.4s cubic-bezier(0.3, 1.3, 0.5, 1);
  }
  .indicator::after {
    content: '';
    width: 36px;
    height: 3px;
    border-radius: 0 0 3px 3px;
    background: var(--orange);
  }
  button {
    height: 66px;
    border: 0;
    background: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--muted-2);
    cursor: pointer;
  }
  button.active {
    color: var(--orange-ink);
    font-weight: 800;
  }
</style>
