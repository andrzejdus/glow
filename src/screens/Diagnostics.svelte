<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from '../components/Icon.svelte';
  import { conn, tap } from '../lib/connection.svelte';
  import type { DiagnosticValue } from '../lib/devices/types';

  let { onclose }: { onclose: () => void } = $props();

  type Change = { time: string; label: string; source: string; from: number | null; to: number | null };

  let rows = $state<DiagnosticValue[]>([]);
  /** The values bits are compared against; set by the first reading and by "Mark as baseline". */
  let baseline = $state<Record<string, number | null>>({});
  let log = $state<Change[]>([]);
  let copied = $state(false);

  const bits = Array.from({ length: 16 }, (_, i) => 15 - i);
  const hex = (v: number | null) => (v === null ? '–' : `0x${v.toString(16).padStart(4, '0')}`);
  const bit = (v: number | null, i: number) => (v === null ? '·' : (v >> i) & 1 ? '1' : '0');
  const changed = (source: string, v: number | null, i: number) => {
    const b = baseline[source];
    return v !== null && b !== null && b !== undefined && ((v ^ b) >> i) & 1;
  };
  /** "bit 6 on, bit 2 off" */
  function flips(from: number | null, to: number | null) {
    if (from === null || to === null) return '';
    const out: string[] = [];
    for (let i = 15; i >= 0; i--) if (((from ^ to) >> i) & 1) out.push(`bit ${i} ${(to >> i) & 1 ? 'on' : 'off'}`);
    return out.join(', ');
  }

  // Read every second while the screen is open; one read in flight at a time.
  $effect(() => {
    let alive = true;
    (async () => {
      while (alive) {
        const next = await conn.diagnostics().catch(() => [] as DiagnosticValue[]);
        if (!alive) return;
        if (next.length) {
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const before = new Map(rows.map((r) => [r.source, r.value]));
          for (const r of next) {
            if (!(r.source in baseline)) baseline[r.source] = r.value;
            if (before.has(r.source) && before.get(r.source) !== r.value) {
              log = [{ time, label: r.label, source: r.source, from: before.get(r.source)!, to: r.value }, ...log].slice(0, 200);
            }
          }
          rows = next;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    return () => {
      alive = false;
    };
  });

  function rebase() {
    tap();
    baseline = Object.fromEntries(rows.map((r) => [r.source, r.value]));
  }

  function report() {
    const d = conn.device;
    return [
      `Glow ${__APP_VERSION__} · ${d?.model ?? ''} firmware ${d?.firmware ?? '–'} BLE ${d?.firmwareBle ?? '–'}`,
      `Battery ${d?.battery ?? '–'} %`,
      '',
      ...rows.map((r) => `${r.label} ${r.source}: ${hex(r.value)} (baseline ${hex(baseline[r.source] ?? null)})`),
      '',
      'Changes, newest first:',
      ...(log.length ? log.map((c) => `${c.time} ${c.label} ${c.source}: ${hex(c.from)} → ${hex(c.to)} ${flips(c.from, c.to)}`) : ['none']),
    ].join('\n');
  }

  async function copy() {
    tap();
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older WebViews: copy through a selected textarea.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) return conn.say('Could not copy. Long-press the log to select it.');
    }
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="overlay" transition:fly={{ y: 16, duration: 300 }}>
  <div class="screen">
    <header>
      <button type="button" class="round press" aria-label="Back to Settings" onclick={onclose}>
        <Icon name="back" size={20} color="var(--navy)" />
      </button>
      <h1>Diagnostics</h1>
    </header>

    <p class="intro">
      Raw registers, read every second. Bits that differ from the baseline are marked. Plug the charger in, wait a
      few seconds, unplug it, then copy the log.
    </p>

    <section class="card regs">
      <div class="reg head num" aria-hidden="true">
        <span></span>
        <span class="cells">{#each bits as i (i)}<span>{i % 4 === 0 || i === 15 ? i : ''}</span>{/each}</span>
      </div>
      {#each rows as r (r.source)}
        <div class="reg">
          <div class="r-top">
            <span class="r-label">{r.label}</span>
            <span class="r-src num">{r.source}</span>
            <span class="r-hex num">{r.label === 'Battery %' ? `${r.value ?? '–'} %` : hex(r.value)}</span>
          </div>
          {#if r.label !== 'Battery %'}
            <span class="cells num">
              {#each bits as i (i)}<span class:hi={changed(r.source, r.value, i)} class:one={bit(r.value, i) === '1'}>{bit(r.value, i)}</span>{/each}
            </span>
          {/if}
        </div>
      {:else}
        <div class="waiting"><span class="spinner"></span>Reading the device…</div>
      {/each}
    </section>

    <div class="actions">
      <button type="button" class="secondary press" onclick={rebase}>Mark as baseline</button>
      <button type="button" class="primary press" onclick={copy}>{copied ? 'Copied' : 'Copy log'}</button>
    </div>

    <section class="group">
      <h2>Changes</h2>
      <div class="card log num">
        {#each log as c (c)}
          <div class="change">
            <span class="c-time">{c.time}</span>
            <span class="c-what">{c.label} {hex(c.from)} → {hex(c.to)}</span>
            <span class="c-bits">{flips(c.from, c.to)}</span>
          </div>
        {:else}
          <div class="none">No changes yet.</div>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    background: var(--bg);
  }
  .screen {
    padding-bottom: calc(var(--sab) + 24px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 44px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 800;
    color: var(--navy);
  }
  .intro {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--muted-2);
  }
  .regs {
    padding: 8px 16px;
  }
  .reg {
    padding: 10px 0;
    border-bottom: 1px solid #eee;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .reg:last-child {
    border-bottom: 0;
  }
  .reg.head {
    padding: 4px 0 0;
    border-bottom: 0;
    font-size: 10px;
    color: var(--muted);
  }
  .r-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .r-label {
    flex-grow: 1;
    font-size: 14px;
    font-weight: 700;
    color: var(--navy);
  }
  .r-src {
    font-size: 11px;
    color: var(--muted);
  }
  .r-hex {
    font-size: 14px;
    font-weight: 700;
    color: var(--navy);
    min-width: 58px;
    text-align: right;
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: 2px;
    text-align: center;
  }
  .reg:not(.head) .cells span {
    font-size: 12px;
    line-height: 20px;
    border-radius: 5px;
    background: #f1f1f1;
    color: #a0a0a0;
  }
  .reg:not(.head) .cells span.one {
    color: var(--navy);
    font-weight: 700;
  }
  .reg:not(.head) .cells span.hi {
    background: var(--orange);
    color: var(--navy-deep);
    font-weight: 800;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    font-size: 14px;
    color: var(--muted);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .actions button {
    height: 52px;
    font-size: 15px;
  }
  h2 {
    margin: 8px 4px 8px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted-2);
  }
  .log {
    padding: 6px 16px;
    user-select: text;
    -webkit-user-select: text;
  }
  .change {
    padding: 8px 0;
    border-bottom: 1px solid #eee;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 10px;
    font-size: 13px;
    color: var(--navy);
  }
  .change:last-child {
    border-bottom: 0;
  }
  .c-time {
    color: var(--muted);
  }
  .c-what {
    font-weight: 700;
  }
  .c-bits {
    grid-column: 2;
    color: var(--orange-ink);
    font-weight: 600;
  }
  .none {
    padding: 12px 0;
    font-size: 14px;
    color: var(--muted);
  }
</style>
