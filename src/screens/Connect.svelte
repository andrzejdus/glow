<script lang="ts">
  import { fly } from 'svelte/transition';
  import Glyph from '../components/Glyph.svelte';
  import Icon from '../components/Icon.svelte';
  import Toggle from '../components/Toggle.svelte';
  import { conn, tap } from '../lib/connection.svelte';
  import { modelNames } from '../lib/devices/registry';

  const who = $derived(conn.target ?? conn.last);
  const model = $derived(who ? modelNames[who.kind] : null);
  const busy = $derived(['starting', 'searching', 'connecting', 'syncing'].includes(conn.phase));
  const done = $derived(conn.phase === 'connected' || conn.phase === 'reconnecting');
  const p = $derived(
    conn.phase === 'starting' ? 0
      : conn.phase === 'searching' ? (conn.meta.bluetoothMs > 0 ? 1 : 0)
        : conn.phase === 'connecting' ? 2
          : conn.phase === 'syncing' ? 3
            : done ? 4 : -1,
  );
  const steps = $derived([
    { label: 'Bluetooth ready', meta: `${(conn.meta.bluetoothMs / 1000).toFixed(1)} s` },
    { label: `${model ?? 'Device'} found`, meta: conn.meta.rssi !== undefined ? `${conn.meta.rssi} dBm` : '' },
    { label: 'Connecting', meta: '' },
    { label: 'Syncing settings', meta: conn.meta.values ? `${conn.meta.values} values` : '' },
  ]);

  const headline = $derived(
    done ? 'Connected'
      : conn.phase === 'choosing' ? (conn.found.length ? 'Choose your device' : 'Looking for devices')
        : p >= 2 ? `${model} found`
          : busy ? `Looking for your ${model ?? 'device'}`
            : 'Ready to connect',
  );
  const subline = $derived(
    done ? 'Your last settings are back.'
      : conn.phase === 'choosing' ? 'Tap the one you want to use.'
        : busy ? (conn.native && conn.autoConnect ? 'Auto-connect is on - no taps needed.' : 'Keep your device on and close.')
          : conn.message || (conn.native ? 'Switch your device on, then tap Connect.' : 'Tap Connect and pick your device.'),
  );

  function connect() {
    tap();
    if (conn.native) conn.search();
    else conn.chooseInBrowser();
  }
  function another() {
    tap();
    if (conn.native) conn.search(true);
    else conn.chooseInBrowser();
  }
</script>

<div class="screen">
  <header>
    <div class="brand">
      <div class="word">GLOW</div>
      <div class="for">for STORZ &amp; BICKEL devices</div>
    </div>
    <div class="pill bt"><span class="dot" class:on={done}></span>Bluetooth</div>
  </header>

  <div class="radar" class:idle={!busy && conn.phase !== 'choosing'} class:done>
    <div class="halo"></div>
    <div class="sweep"></div>
    <div class="ring"></div>
    <div class="ring r2"></div>
    <div class="ring r3"></div>
    <div class="core">
      {#if done}
        <div class="check"><Icon name="check" size={52} color="var(--navy-deep)" stroke={2.6} /></div>
      {:else}
        <div class="float"><Glyph kind={who?.kind ?? null} /></div>
      {/if}
    </div>
  </div>

  <div class="copy">
    <h1>{headline}</h1>
    <p>{subline}</p>
  </div>

  {#if conn.phase === 'choosing'}
    <div class="card list">
      {#each conn.found as d (d.id)}
        <button type="button" class="device press" in:fly={{ y: 10, duration: 300 }} onclick={() => conn.connect(d)}>
          <Glyph kind={d.kind} scale={0.45} />
          <span class="d-name">{d.name}</span>
          <span class="d-rssi num">{d.rssi ?? ''} dBm</span>
          <Icon name="arrow" size={18} color="var(--navy)" />
        </button>
      {/each}
      {#if conn.scanning}<div class="scanning"><span class="spinner"></span>Scanning…</div>{/if}
      {#if !conn.scanning && conn.found.length === 0}<div class="scanning">No device found nearby.</div>{/if}
    </div>
  {:else if p >= 0}
    <div class="card steps">
      {#each steps as s, i (i)}
        <div class="step">
          <div class="icon">
            {#if i < p}
              <span class="tick"><Icon name="check" size={14} color="var(--navy-deep)" stroke={3.4} /></span>
            {:else if i === p}
              <span class="spinner"></span>
            {:else}
              <span class="todo"></span>
            {/if}
          </div>
          <div class="s-label" class:pending={i > p}>{s.label}</div>
          <div class="s-meta num">{i < p ? s.meta : ''}</div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="card auto">
    <div class="a-text">
      <label for="auto">Auto-connect on open</label>
      <div>Reconnects to your last {model ?? 'device'} when it is in range.</div>
    </div>
    <Toggle id="auto" label="Auto-connect on open" on={conn.autoConnect} onchange={(v) => conn.setAutoConnect(v)} />
  </div>

  <div class="bottom">
    {#if !busy && !done && conn.phase !== 'choosing'}
      <button type="button" class="primary press" in:fly={{ y: 14, duration: 400 }} onclick={connect}>
        Connect <Icon name="arrow" size={20} color="var(--navy-deep)" stroke={2.6} />
      </button>
    {:else if conn.phase === 'choosing' && conn.native && !conn.scanning}
      <button type="button" class="secondary press" onclick={another}>Scan again</button>
    {/if}
    <div class="links">
      <button type="button" class="link" onclick={another}>Pair another device</button>
      <a href="https://www.storz-bickel.com/en/support/web/troubleshooting" target="_blank" rel="noreferrer">Can't connect?</a>
    </div>
    <div class="demo">
      Try without a device:
      <button type="button" class="link small" onclick={() => conn.startDemo('venty')}>VENTY</button>·
      <button type="button" class="link small" onclick={() => conn.startDemo('volcano')}>VOLCANO</button>
    </div>
  </div>
</div>

<style>
  .screen {
    padding-bottom: calc(var(--sab) + 20px);
    min-height: 100dvh;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }
  .word {
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 0.32em;
    color: var(--navy);
  }
  .for {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    margin-top: 1px;
  }
  .bt {
    cursor: default;
    color: var(--muted-2);
    font-size: 12px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--navy);
    transition: background 0.4s;
  }
  .dot.on {
    background: var(--orange);
  }
  .radar {
    position: relative;
    width: 280px;
    height: 280px;
    margin: 28px auto 0;
    flex-shrink: 0;
  }
  .halo {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 102, 0, 0.14) 0%, rgba(255, 102, 0, 0) 68%);
  }
  .sweep {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 0deg, rgba(255, 102, 0, 0) 0deg, rgba(255, 102, 0, 0.18) 60deg, rgba(255, 102, 0, 0) 61deg);
    animation: spin 2.2s linear infinite;
  }
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid var(--orange);
    animation: ring 2.4s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
  }
  .r2 { animation-delay: 0.8s; }
  .r3 { animation-delay: 1.6s; }
  @keyframes ring {
    0% { transform: scale(0.35); opacity: 0.9; }
    100% { transform: scale(1); opacity: 0; }
  }
  .radar.done .ring,
  .radar.done .sweep,
  .radar.idle .sweep {
    display: none;
  }
  .radar.idle .ring {
    animation-duration: 4.8s;
  }
  .core {
    position: absolute;
    inset: 70px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 18px 40px rgba(0, 40, 125, 0.14);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .check {
    width: 112px;
    height: 112px;
    border-radius: 50%;
    background: var(--orange);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pop 0.5s cubic-bezier(0.2, 0.8, 0.3, 1.3) both;
  }
  .float {
    animation: float 3.2s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  .copy {
    text-align: center;
    margin-top: 20px;
    min-height: 76px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    line-height: 1.1;
    font-weight: 800;
    color: var(--navy);
    letter-spacing: -0.01em;
  }
  .copy p {
    margin: 10px 0 0;
    font-size: 15px;
    color: var(--muted-2);
  }
  .steps,
  .list {
    padding: 6px 18px;
    border-radius: 22px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 44px;
    border-bottom: 1px solid #eee;
  }
  .step:last-child {
    border-bottom: 0;
  }
  .icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tick {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--orange);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pop 0.5s cubic-bezier(0.2, 0.8, 0.3, 1.3) both;
  }
  .todo {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid #d5d5d5;
  }
  .s-label {
    flex-grow: 1;
    font-size: 15px;
    font-weight: 600;
    color: var(--navy);
  }
  .s-label.pending {
    color: var(--muted);
  }
  .s-meta {
    font-size: 12px;
    color: var(--muted);
  }
  .device {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 60px;
    border: 0;
    border-bottom: 1px solid #eee;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .device :global(.glyph) {
    margin: -24px -14px;
  }
  .d-name {
    flex-grow: 1;
    font-size: 15px;
    font-weight: 700;
    color: var(--navy);
  }
  .d-rssi {
    font-size: 12px;
    color: var(--muted);
  }
  .scanning {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    font-size: 14px;
    color: var(--muted);
  }
  .auto {
    padding: 14px 18px;
    border-radius: 22px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .a-text {
    flex-grow: 1;
  }
  .a-text label {
    display: block;
    font-size: 15px;
    font-weight: 700;
    color: var(--navy);
  }
  .a-text div {
    font-size: 13px;
    color: var(--muted);
    margin-top: 2px;
  }
  .bottom {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
  }
  .links {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
  }
  .link {
    background: none;
    border: 0;
    padding: 12px 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--navy);
    cursor: pointer;
  }
  .links a {
    font-size: 14px;
    font-weight: 600;
    padding: 12px 0;
  }
  .demo {
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .link.small {
    font-size: 13px;
    padding: 8px 4px;
    color: var(--orange-ink);
  }
</style>
