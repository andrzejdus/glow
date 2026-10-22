<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import TabBar from './components/TabBar.svelte';
  import { conn } from './lib/connection.svelte';
  import type { Tab } from './lib/nav';
  import Connect from './screens/Connect.svelte';
  import Control from './screens/Control.svelte';
  import Settings from './screens/Settings.svelte';
  import Workflows from './screens/Workflows.svelte';

  let tab = $state<Tab>('control');
  let showDevice = $state(false);
  const live = $derived(!!conn.device && (conn.phase === 'connected' || conn.phase === 'reconnecting'));

  // Let the "Connected" check pop for a moment before the dashboard slides in.
  $effect(() => {
    if (!live) {
      showDevice = false;
      tab = 'control';
      return;
    }
    const timer = setTimeout(() => (showDevice = true), 650);
    return () => clearTimeout(timer);
  });

  function select(next: Tab) {
    tab = next;
    window.scrollTo({ top: 0 });
  }
</script>

{#if showDevice && conn.device}
  {#key tab}
    <main in:fly={{ y: 12, duration: 380 }}>
      {#if tab === 'control'}
        <Control />
      {:else if tab === 'workflows'}
        <Workflows />
      {:else}
        <Settings />
      {/if}
    </main>
  {/key}
  <TabBar {tab} workflows={conn.device.kind === 'volcano'} onselect={select} />
{:else}
  <main in:fade={{ duration: 300 }}>
    <Connect />
  </main>
{/if}

{#if conn.toast}
  <div class="toast" role="status" transition:fly={{ y: 20, duration: 250 }}>{conn.toast}</div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 20px;
    right: 20px;
    bottom: calc(var(--sab) + 84px);
    z-index: 20;
    max-width: 440px;
    margin: 0 auto;
    padding: 14px 18px;
    border-radius: 18px;
    background: var(--navy-deep);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 12px 30px rgba(0, 26, 77, 0.3);
  }
</style>
