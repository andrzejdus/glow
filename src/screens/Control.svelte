<script lang="ts">
  import Dial from '../components/Dial.svelte';
  import Header from '../components/Header.svelte';
  import HoursCard from '../components/HoursCard.svelte';
  import Icon from '../components/Icon.svelte';
  import Warmth from '../components/Warmth.svelte';
  import { conn } from '../lib/connection.svelte';
  import type { DeviceState, HeatMode } from '../lib/devices/types';
  import { deltaToUnit, mmss, toUnit } from '../lib/format';
  import { usage } from '../lib/usage.svelte';

  const d = $derived(conn.device as DeviceState);
  const caps = $derived(conn.caps);
  const unit = $derived(d.unit ?? 'C');
  const offline = $derived(conn.phase === 'reconnecting');
  const offset = $derived(d.mode === 'boost' ? d.boostOffset ?? 0 : d.mode === 'superboost' ? d.superBoostOffset ?? 0 : 0);
  const goal = $derived(d.targetTemp === undefined ? undefined : Math.min(d.maxTemp, d.targetTemp + offset));
  const diff = $derived(goal !== undefined && d.currentTemp !== undefined ? goal - d.currentTemp : undefined);
  // Mode names as each manual has them: CRAFTY+ says Booster / Superbooster.
  const names = $derived(
    d.kind === 'crafty'
      ? { normal: 'Base', boost: 'Booster', superboost: 'Superbooster' }
      : { normal: 'Normal', boost: 'Boost', superboost: 'Superboost' },
  );
  // The device's own flag wins (it is what drives the CRAFTY+ LED); otherwise compare temperatures.
  const reached = $derived(d.heaterOn && (d.tempReached ?? (diff !== undefined && Math.abs(diff) < 1)));
  const cooling = $derived(d.heaterOn && !reached && diff !== undefined && diff < -2);
  const eta = $derived(reached || cooling ? null : usage.etaSec(d.currentTemp, goal));
  const goalText = $derived(goal === undefined ? '' : ` ${toUnit(goal, unit)}°`);
  const status = $derived.by(() => {
    if (offline) return 'Waiting for the device…';
    if (!d.heaterOn) return 'Heater off';
    if (reached) return d.mode === 'normal' ? 'Temperature reached' : `${names[d.mode]} reached`;
    if (cooling) return `Cooling to${goalText}`;
    const to = d.mode === 'normal' ? `Heating to${goalText}` : `Heating to ${names[d.mode]}${goalText}`;
    return eta ? `${to} · ready in ${mmss(eta)}` : to;
  });
  // CRAFTY only: a dot that mirrors the device LED (red heating, green reached; flashing in Booster, fast in Superbooster).
  const led = $derived(
    d.kind !== 'crafty' || offline
      ? null
      : {
          color: !d.heaterOn ? 'off' : reached ? 'green' : 'red',
          blink: d.mode === 'superboost' ? 'fast' : d.mode === 'boost' ? 'slow' : 'steady',
        },
  );
  const warmth = $derived(d.heaterOn && d.currentTemp !== undefined ? Math.max(0, Math.min(1, (d.currentTemp - 40) / 170)) : 0);

  const modes = $derived.by(() => {
    if (!caps?.boost) return [];
    const list: { id: HeatMode; label: string; sub: string }[] = [
      { id: 'normal', label: names.normal, sub: d.targetTemp === undefined ? 'base' : `${toUnit(d.targetTemp, unit)}°` },
      { id: 'boost', label: names.boost, sub: `+${deltaToUnit(d.boostOffset ?? 0, unit)}°` },
    ];
    if (caps.superBoost) {
      list.push({ id: 'superboost', label: names.superboost, sub: `+${deltaToUnit(d.superBoostOffset ?? 0, unit)}°` });
    }
    return list;
  });
  const modeIndex = $derived(Math.max(0, modes.findIndex((m) => m.id === d.mode)));
  const modeLocked = $derived(!conn.modeSwitchable || !d.heaterOn);

  function pickMode(mode: HeatMode) {
    if (!conn.modeSwitchable) {
      return conn.say(
        d.kind === 'crafty'
          ? 'Switch on the device: double-click the power button for Booster, triple-click for Superbooster.'
          : 'Boost is switched with the button on the device.',
      );
    }
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

  {#if modes.length}
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
      <button type="button" class="tile press heat" class:on={d.heaterOn} aria-pressed={d.heaterOn}
        onclick={() => conn.setHeater(!d.heaterOn)}>
        <Icon name="flame" size={24} class={d.heaterOn ? 'flicker' : ''} /> {d.heaterOn ? 'Heat on' : 'Heat'}
      </button>
      <button type="button" class="tile press air" class:on={d.pumpOn} aria-pressed={!!d.pumpOn}
        onclick={() => conn.setPump(!d.pumpOn)}>
        <Icon name="fan" size={24} class={d.pumpOn ? 'spinning' : ''} /> {d.pumpOn ? 'Air on' : 'Air'}
      </button>
    </div>
  {:else if caps?.heaterToggle}
    <button type="button" class="heater press rise d4" class:on={d.heaterOn} aria-pressed={d.heaterOn}
      style:--glow={0.25 + 0.3 * warmth} onclick={() => conn.setHeater(!d.heaterOn)}>
      <Icon name="flame" size={22} class={d.heaterOn ? 'flicker' : ''} />
      {d.heaterOn ? 'Heater on' : 'Start heating'}
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
    background: #c9c9c9;
  }
  .led.red {
    background: #e0301e;
    box-shadow: 0 0 8px rgba(224, 48, 30, 0.6);
  }
  .led.green {
    background: #1f9d55;
    box-shadow: 0 0 8px rgba(31, 157, 85, 0.6);
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
  .m-label {
    font-size: 13px;
    font-weight: 800;
  }
  .m-sub {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.8;
  }
  .heater {
    height: 56px;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
    font-size: 17px;
    font-weight: 800;
    background: var(--navy);
    color: #fff;
    box-shadow: 0 8px 20px rgba(0, 40, 125, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .heater.on {
    background: var(--orange);
    color: var(--navy-deep);
    box-shadow: 0 14px 34px rgba(255, 102, 0, var(--glow));
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
  .tile.heat.on {
    background: var(--orange);
    color: var(--navy-deep);
    box-shadow: 0 12px 28px rgba(255, 102, 0, 0.4);
  }
  .tile.air.on {
    background: var(--navy);
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
