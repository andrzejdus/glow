<script lang="ts">
  import Icon from './Icon.svelte';
  import { conn } from '../lib/connection.svelte';

  const d = $derived(conn.device);
  const status = $derived(
    conn.phase === 'reconnecting' ? 'Reconnecting…' : conn.demo ? 'Demo device' : conn.autoConnect ? 'Connected · auto' : 'Connected',
  );
</script>

<header class="rise">
  <button type="button" class="round press" aria-label="Disconnect" onclick={() => conn.disconnect()}>
    <Icon name="back" size={20} color="var(--navy)" />
  </button>
  <div class="title">
    <div class="model">{d?.model ?? ''}</div>
    <div class="status">
      {#if conn.phase === 'reconnecting'}<span class="spinner small"></span>{:else}<span class="dot"></span>{/if}
      {status}
    </div>
  </div>
  {#if d && conn.caps?.battery && d.battery !== undefined}
    <div class="pill num" aria-label="Battery {d.battery} percent{d.charging ? ', charging' : ''}">
      {#if d.charging}<Icon name="bolt" size={14} color="var(--orange-ink)" />{/if}
      <span class="battery"><span style:width="{d.battery}%"></span></span>{d.battery}%
    </div>
  {/if}
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
  }
  .title {
    flex-grow: 1;
    min-width: 0;
  }
  .model {
    font-size: 19px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: var(--navy);
  }
  .status {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted-2);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--orange);
  }
  .spinner.small {
    width: 10px;
    height: 10px;
    border-width: 2px;
  }
  .pill {
    cursor: default;
  }
  .battery {
    width: 22px;
    height: 11px;
    border: 1.5px solid var(--navy);
    border-radius: 3px;
    padding: 1.5px;
    display: inline-flex;
  }
  .battery span {
    background: var(--orange);
    border-radius: 1px;
    transition: width 0.6s ease;
  }
</style>
