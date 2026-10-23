<script lang="ts">
  import Dial from '../components/Dial.svelte';
  import Header from '../components/Header.svelte';
  import HoursCard from '../components/HoursCard.svelte';
  import Icon from '../components/Icon.svelte';
  import Warmth from '../components/Warmth.svelte';
  import { conn } from '../lib/connection.svelte';
  import type { DeviceState, HeatMode } from '../lib/devices/types';
  import { toUnit } from '../lib/format';

  const d = $derived(conn.device as DeviceState);
  const caps = $derived(conn.caps);
  const unit = $derived(d.unit ?? 'C');
  const offline = $derived(conn.phase === 'reconnecting');
  const offset = $derived(d.mode === 'boost' ? d.boostOffset ?? 0 : d.mode === 'superboost' ? d.superBoostOffset ?? 0 : 0);
  const goal = $derived(d.targetTemp === undefined ? undefined : Math.min(d.maxTemp, d.targetTemp + offset));
  const diff = $derived(goal !== undefined && d.currentTemp !== undefined ? goal - d.currentTemp : undefined);
  // The names STORZ & BICKEL's manuals and support pages use for every device.
  const names = { normal: 'Base', boost: 'Booster', superboost: 'Superbooster' };
  // The device's own flag wins (it is what drives the CRAFTY+ LED); otherwise compare temperatures.
  const reached = $derived(d.heaterOn && (d.tempReached ?? (diff !== undefined && Math.abs(diff) < 1)));
  // Just the LED: red while heating, green when ready, grey when off.
  const status = $derived(offline ? 'Waiting for the device…' : !d.heaterOn ? 'Heater off' : reached ? 'Ready' : 'Heating');
  const led = $derived(
    offline
      ? null
      : {
          color: !d.heaterOn ? 'off' : reached ? 'green' : 'red',
          blink: d.mode === 'superboost' ? 'fast' : d.mode === 'boost' ? 'slow' : 'steady',
        },
  );
  // Without a live reading (VENTY/VEAZY) the screen warms up once the device is ready.
  const glowTemp = $derived(d.currentTemp ?? (reached ? goal : undefined));
  const warmth = $derived(d.heaterOn && glowTemp !== undefined ? Math.max(0, Math.min(1, (glowTemp - 40) / 170)) : 0);

  const modes = $derived.by(() => {
    if (!caps?.boost) return [];
    // Real temperatures, not offsets: CRAFTY+ counts its Superbooster from the Booster, VENTY from the base.
    const at = (offset: number | undefined) =>
      d.targetTemp === undefined || offset === undefined ? '–' : `${toUnit(Math.min(d.maxTemp, d.targetTemp + offset), unit)}°`;
    const list: { id: HeatMode; label: string; sub: string }[] = [
      { id: 'normal', label: names.normal, sub: at(0) },
      { id: 'boost', label: names.boost, sub: at(d.boostOffset) },
    ];
    if (caps.superBoost) list.push({ id: 'superboost', label: names.superboost, sub: at(d.superBoostOffset) });
    return list;
  });
  const modeIndex = $derived(Math.max(0, modes.findIndex((m) => m.id === d.mode)));
  const modeLocked = $derived(!d.heaterOn || offline);

  function pickMode(mode: HeatMode) {
    if (offline) return;
    if (!d.heaterOn) return conn.say(`${names.boost} works while the heater is on.`);
    conn.setMode(mode);
  }

  // The dial gets whatever height is left, so the dashboard fits without scrolling.
  let areaH = $state(268);
  let areaW = $state(320);
  const dialScale = $derived(Math.max(0.62, Math.min(1, (areaH - 6) / 262, (areaW - 8) / 290)));
</script>

<Warmth {warmth} />
<div class="screen fit">
  <Header />

  <div class="dial-area" bind:clientHeight={areaH} bind:clientWidth={areaW}>
  <Dial scale={dialScale} current={d.currentTemp} target={goal} min={d.minTemp} max={d.maxTemp} heating={d.heaterOn} ready={reached} {unit} {offline}
    onstep={(delta) => conn.setTarget((d.targetTemp ?? d.minTemp) + (unit === 'F' ? delta * 5 / 9 : delta))} />
  </div>

  <div class="status rise d1 num" class:ready={reached} class:off={!d.heaterOn}>
    {#if led}
      <span class="led {led.color} {led.blink}" role="img"
        aria-label="Device LED {led.color}{led.blink === 'steady' ? '' : led.blink === 'fast' ? ', flashing fast' : ', flashing'}"></span>
    {/if}
    {status}
  </div>

  {#if modes.length && !conn.modeSwitchable}
    <!-- CRAFTY: the app cannot switch levels (the device button does), so this is a readout, not a control. -->
    <div class="levels rise d2" role="group" aria-label="Heat levels, switched with the button on the device">
      {#each modes as m, i (m.id)}
        {#if i > 0}<span class="sep" aria-hidden="true">›</span>{/if}
        <div class="level" class:on={m.id === d.mode} aria-current={m.id === d.mode ? 'true' : undefined}>
          <span class="l-label">{m.label}</span>
          <span class="l-temp num">{m.sub}</span>
        </div>
      {/each}
    </div>
  {:else if modes.length}
    <div class="modes rise d2" class:locked={modeLocked} style:--n={modes.length}>
      <span class="thumb" style:transform="translateX({modeIndex * 100}%)"></span>
      {#each modes as m (m.id)}
        <button type="button" class:on={m.id === d.mode} aria-pressed={m.id === d.mode} aria-disabled={modeLocked}
          onclick={() => pickMode(m.id)}>
          <span class="m-label">{m.label}</span><span class="m-sub">{m.sub}</span>
        </button>
      {/each}
    </div>
  {/if}

  <HoursCard />

  {#if caps?.pump}
    <div class="duo rise d4">
      <button type="button" class="tile press heat" class:on={d.heaterOn} aria-pressed={d.heaterOn} disabled={offline}
        onclick={() => conn.setHeater(!d.heaterOn)}>
        <Icon name="flame" size={24} class={d.heaterOn ? 'flicker' : ''} /> {d.heaterOn ? 'Heat on' : 'Heat'}
      </button>
      <button type="button" class="tile press air" class:on={d.pumpOn} aria-pressed={!!d.pumpOn} disabled={offline}
        onclick={() => conn.setPump(!d.pumpOn)}>
        <Icon name="fan" size={24} class={d.pumpOn ? 'spinning' : ''} /> {d.pumpOn ? 'Air on' : 'Air'}
      </button>
    </div>
  {:else if caps?.heaterToggle}
    <!-- The VOLCANO Heat tile, full width. -->
    <button type="button" class="tile press heat rise d4" class:on={d.heaterOn} aria-pressed={d.heaterOn} disabled={offline}
      onclick={() => conn.setHeater(!d.heaterOn)}>
      <Icon name="flame" size={24} class={d.heaterOn ? 'flicker' : ''} /> {d.heaterOn ? 'Heat on' : 'Heat'}
    </button>
  {/if}
</div>

<style>
  .screen {
    position: relative;
    z-index: 1;
  }
  .screen.fit {
    min-height: 100dvh;
    padding-bottom: calc(var(--sab) + 78px);
  }
  .dial-area {
    flex: 1 1 0;
    min-height: 168px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .status {
    text-align: center;
    margin-top: 4px;
    font-size: 14px;
    font-weight: 700;
    color: var(--navy);
    height: 20px;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .status.ready {
    color: var(--orange-ink);
  }
  .led {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--track);
  }
  .led.red {
    background: var(--led-heat);
    box-shadow: 0 0 8px color-mix(in srgb, var(--led-heat) 60%, transparent);
  }
  .led.green {
    background: var(--led-ready);
    box-shadow: 0 0 8px color-mix(in srgb, var(--led-ready) 60%, transparent);
  }
  .led.off {
    box-shadow: none;
  }
  .led.slow:not(.off) {
    animation: led 1.2s steps(1, end) infinite;
  }
  .led.fast:not(.off) {
    animation: led 0.4s steps(1, end) infinite;
  }
  @keyframes led {
    50% { opacity: 0.15; }
  }
  .status.off {
    color: var(--muted);
  }
  .modes {
    position: relative;
    height: 50px;
    border-radius: 999px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    padding: 4px;
  }
  .thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc((100% - 8px) / var(--n));
    border-radius: 999px;
    background: var(--orange);
    box-shadow: 0 6px 16px rgba(255, 102, 0, 0.35);
    transition: transform 0.35s cubic-bezier(0.3, 1.3, 0.5, 1), opacity 0.3s;
  }
  .modes.locked .thumb {
    opacity: 0.55;
  }
  .modes button {
    position: relative;
    border: 0;
    background: none;
    color: var(--navy);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    cursor: pointer;
  }
  .modes button.on {
    color: var(--navy-deep);
  }
  .levels {
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .level {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    color: var(--faint);
    transition: color 0.3s ease;
  }
  .level.on {
    color: var(--navy);
  }
  .l-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .level.on .l-label {
    color: var(--orange-ink);
  }
  .l-temp {
    font-size: 17px;
    font-weight: 700;
  }
  .sep {
    font-size: 18px;
    color: var(--faint);
    margin-top: 10px;
  }
  .m-label {
    font-size: 13px;
    font-weight: 800;
  }
  .m-sub {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.8;
  }
  .duo {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .tile {
    height: 64px;
    border-radius: 22px;
    border: 0;
    background: var(--card);
    color: var(--navy);
    box-shadow: var(--shadow-sm);
    font-size: 15px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
  }
  /* Waiting for the device: the controls stay where they are, greyed out. */
  .tile:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .tile.heat.on {
    background: var(--orange);
    color: var(--navy-deep);
    box-shadow: 0 12px 28px rgba(255, 102, 0, 0.4);
  }
  .tile.air.on {
    background: var(--navy-fill);
    color: #fff;
    box-shadow: 0 10px 24px rgba(0, 40, 125, 0.25);
  }
  :global(.flicker) {
    animation: flicker 0.9s ease-in-out infinite;
    transform-origin: 12px 20px;
  }
  :global(.spinning .fan) {
    animation: spin 0.7s linear infinite;
  }
  @keyframes flicker {
    0%, 100% { transform: scale(1) translateY(0); }
    50% { transform: scale(1.08) translateY(-1px); }
  }
</style>
