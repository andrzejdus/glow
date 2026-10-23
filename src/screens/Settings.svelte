<script lang="ts">
  import Battery from '../components/Battery.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Slider from '../components/Slider.svelte';
  import Icon from '../components/Icon.svelte';
  import Toggle from '../components/Toggle.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import { conn } from '../lib/connection.svelte';
  import type { DeviceState, SettingDef } from '../lib/devices/types';
  import { deltaToUnit, duration, splitHours, toUnit, usageTime } from '../lib/format';
  import { usage } from '../lib/usage.svelte';

  const d = $derived(conn.device as DeviceState);
  const life = $derived(usage.lifetimeSec(usage.now));
  const parts = $derived(life === null ? null : splitHours(life));
  const months = $derived(usage.months(8, usage.now));
  const thisMonth = $derived(months[months.length - 1]?.hours);

  const titles: Record<SettingDef['group'], string> = {
    connection: 'Connection',
    battery: 'Battery',
    boost: 'Boost',
    device: 'Device',
  };
  const groups = $derived(
    (Object.keys(titles) as SettingDef['group'][])
      .map((g) => ({ id: g, title: titles[g], items: conn.settingDefs.filter((s) => s.group === g) }))
      .filter((g) => g.items.length || g.id === 'connection' || (g.id === 'boost' && offsets)),
  );

  // Boost offsets, in °C above the base temperature. CRAFTY has one (the Superbooster follows at +15).
  const offsets = $derived(conn.offsetsAdjustable && d.boostOffset !== undefined);
  const crafty = $derived(d.kind === 'crafty');
  const room = $derived(Math.max(1, Math.min(99, d.maxTemp - (d.targetTemp ?? d.minTemp))));
  const at = (offset: number | undefined) =>
    d.targetTemp === undefined || offset === undefined ? '–' : `${toUnit(Math.min(d.maxTemp, d.targetTemp + offset), unit)}°`;
  const unit = $derived(d.unit ?? 'C');
  const plus = (v: number | undefined) => (v === undefined ? '–' : `+${deltaToUnit(v, unit)}°`);
  // Factory offsets from base (S&B support): Booster +15, Superbooster +30 on CRAFTY+, VENTY and VEAZY.
  const factory = { boost: 15, superBoost: 30 };

  let diagnostics = $state(false);
  let finding = $state(false);
  function find() {
    conn.findMy();
    finding = true;
    setTimeout(() => (finding = false), 3500);
  }

  function show(def: SettingDef, value: number) {
    if (def.unit === 's') return duration(value);
    if (def.unit === 'min') return value >= 60 ? `${Math.round(value / 6) / 10} h` : `${value} min`;
    return `${value}${def.unit ?? ''}`;
  }
  const asNumber = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
</script>

<div class="screen">
  <header class="rise">
    <h1>Settings</h1>
    <div class="pill">{d.model}</div>
  </header>

  <section class="card device rise d1">
    <div class="d-top">
      {#if conn.caps?.battery && d.battery !== undefined}
        <div class="cell">
          <Battery level={d.battery} charging={d.charging} size="lg" />
          <!-- Older CRAFTY firmware does not report the charger, so it gets no state rather than a wrong one. -->
          {#if d.charging !== undefined}
            <!-- On the charger at 100 % the battery is full; the bolt stays because it is still plugged in. -->
            <div class="cell-state" class:charging={d.charging}>{d.charging ? (d.battery >= 100 ? 'Charged' : 'Charging') : 'On battery'}</div>
          {/if}
        </div>
      {:else}
        <Glyph kind={d.kind} scale={0.9} />
      {/if}
      <div>
        <div class="label">Hours of operation</div>
        <div class="life num">
          {#if parts}<span class="h">{parts.h}</span><span class="u">h</span><span class="m">{parts.m}</span><span class="u">m</span>
          {:else}<span class="h">–</span>{/if}
        </div>
        {#if thisMonth !== null && thisMonth !== undefined}<div class="week num">+{usageTime(thisMonth)} this month</div>{/if}
      </div>
    </div>
    <div class="facts">
      <div><span>Serial</span><strong class="num">{d.serial ?? '–'}</strong></div>
      <div><span>Firmware</span><strong class="num">{d.firmware ?? '–'}</strong></div>
      <div><span>{d.kind === 'venty' || d.kind === 'veazy' ? 'Bootloader' : 'BLE'}</span><strong class="num">{d.firmwareBle ?? '–'}</strong></div>
    </div>
    {#if conn.caps?.findMy}
      <button type="button" class="primary find press" onclick={find}>
        <span class="bell">
          {#if finding}<span class="ping"></span><span class="ping late"></span>{/if}
          <Icon name="bell" size={20} class={finding ? 'shake' : ''} />
        </span>
        {finding ? 'Ringing…' : `Find my ${d.model}`}
      </button>
    {/if}
  </section>

  {#each groups as g (g.id)}
    <section class="group rise d2">
      <h2>{g.title}</h2>
      <div class="card list">
        {#if g.id === 'connection'}
          <div class="row">
            <div class="text">
              <div class="name"><label for="autoConnect">Auto-connect on open</label><span class="new">NEW</span></div>
              <div class="desc">Skips the Connect button and reconnects to your last device when it is in range.</div>
            </div>
            <Toggle id="autoConnect" label="Auto-connect on open" on={conn.autoConnect} onchange={(v) => conn.setAutoConnect(v)} />
          </div>
        {/if}
        {#if g.id === 'boost' && offsets}
          <div class="row range">
            <div class="range-top">
              <label for="boostOffset" class="name">Booster offset</label>
              <span class="value num">{plus(d.boostOffset)}</span>
            </div>
            <div class="temps num">
              <span class="temp"><span>Booster</span><strong>{at(d.boostOffset)}</strong></span>
            </div>
            <Slider id="boostOffset" min={1} max={room} step={1} value={d.boostOffset ?? 1} defaultValue={factory.boost}
              onchange={(v) => conn.setBoostOffset(v)} />
          </div>
          {#if conn.caps?.superBoost && d.superBoostOffset !== undefined}
            <div class="row range" class:fixed={crafty}>
              <div class="range-top">
                <label for="superBoostOffset" class="name">Superbooster offset</label>
                <span class="value num">{plus(d.superBoostOffset)}</span>
              </div>
              <div class="temps num">
                <span class="temp"><span>Superbooster</span><strong>{at(d.superBoostOffset)}</strong></span>
              </div>
              {#if crafty}
                <div class="desc">Fixed on CRAFTY+: always 15 °C above the Booster, so it follows the Booster offset.</div>
              {/if}
              <Slider id="superBoostOffset" min={1} max={room} step={1} value={Math.min(room, d.superBoostOffset)}
                defaultValue={factory.superBoost} disabled={crafty} onchange={(v) => conn.setSuperBoostOffset(v)} />
            </div>
          {/if}
        {/if}
        {#each g.items as s (s.key)}
          {#if s.type === 'toggle'}
            <div class="row">
              <div class="text">
                <div class="name"><label for={s.key}>{s.label}</label></div>
                {#if s.description}<div class="desc">{s.description}</div>{/if}
              </div>
              <Toggle id={s.key} label={s.label} on={!!d.settings[s.key]} onchange={(v) => conn.setSetting(s.key, v)} />
            </div>
          {:else}
            {@const value = asNumber(d.settings[s.key], s.min ?? 0)}
            <div class="row range">
              <div class="range-top">
                <label for={s.key} class="name">{s.label}</label>
                <span class="value num">{show(s, value)}</span>
              </div>
              {#if s.description}<div class="desc">{s.description}</div>{/if}
              <Slider id={s.key} min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} {value} defaultValue={s.defaultValue}
                onchange={(v) => conn.setSetting(s.key, v)} />
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/each}

  <button type="button" class="outline press rise d3" onclick={() => conn.disconnect()}>Disconnect</button>
  {#if conn.diagnosable}
    <button type="button" class="diag" onclick={() => (diagnostics = true)}>Device diagnostics</button>
  {/if}
  <p class="foot">Glow {__APP_VERSION__} · an unofficial app, not made by STORZ &amp; BICKEL</p>
</div>

{#if diagnostics}
  <Diagnostics onclose={() => (diagnostics = false)} />
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 800;
    color: var(--navy);
    letter-spacing: -0.01em;
  }
  .pill {
    cursor: default;
    letter-spacing: 0.14em;
    font-size: 12px;
  }
  .device {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    color: var(--navy);
  }
  .d-top {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .cell-state {
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
  }
  .cell-state.charging {
    color: var(--orange-ink);
  }
  .life {
    display: flex;
    align-items: baseline;
    gap: 3px;
    margin-top: 2px;
  }
  .h {
    font-size: 40px;
    font-weight: 300;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .m {
    font-size: 24px;
    margin-left: 4px;
  }
  .u {
    font-size: 15px;
    font-weight: 600;
    color: var(--muted);
  }
  .week {
    font-size: 13px;
    font-weight: 700;
    color: var(--orange-ink);
    margin-top: 4px;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .facts div {
    background: var(--bg);
    border-radius: 14px;
    padding: 10px;
    min-width: 0;
  }
  .facts span {
    display: block;
    font-size: 11px;
    color: var(--muted);
  }
  .facts strong {
    display: block;
    font-size: 14px;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find {
    height: 48px;
    font-size: 15px;
  }
  .bell {
    position: relative;
    width: 20px;
    height: 20px;
    display: inline-flex;
  }
  .ping {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: #fff;
    animation: ping 1.2s ease-out infinite;
  }
  .ping.late {
    animation-delay: 0.4s;
  }
  @keyframes ping {
    0% { transform: scale(1); opacity: 0.7; }
    100% { transform: scale(2.6); opacity: 0; }
  }
  .bell :global(.shake) {
    position: relative;
    animation: shake 0.6s ease-in-out infinite;
  }
  @keyframes shake {
    0%, 100% { transform: rotate(0); }
    20% { transform: rotate(-12deg); }
    40% { transform: rotate(10deg); }
    60% { transform: rotate(-8deg); }
    80% { transform: rotate(6deg); }
  }
  .group h2 {
    margin: 8px 4px 8px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted-2);
  }
  .list {
    padding: 0 16px;
    border-radius: 22px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 0;
    border-bottom: 1px solid #eee;
  }
  .row:last-child {
    border-bottom: 0;
  }
  .text {
    flex-grow: 1;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    color: var(--navy);
  }
  .new {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    color: var(--navy-deep);
    background: var(--orange);
    border-radius: 6px;
    padding: 3px 6px;
  }
  .desc {
    font-size: 13px;
    line-height: 1.35;
    color: var(--muted);
    margin-top: 3px;
  }
  .fixed .name,
  .fixed .value {
    color: var(--muted);
  }
  .fixed .temp {
    filter: grayscale(1);
  }
  .temps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;
  }
  .temp {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--orange-tint);
    color: var(--navy-deep);
  }
  .temp span {
    font-size: 12px;
    font-weight: 600;
  }
  .temp strong {
    font-size: 15px;
    font-weight: 800;
  }
  .row.range {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .range-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .value {
    font-size: 15px;
    font-weight: 800;
    color: var(--orange-ink);
  }
  .outline {
    height: 52px;
    border-radius: 999px;
    border: 1.5px solid var(--orange-ink);
    background: transparent;
    color: var(--orange-ink);
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
    margin-top: 6px;
  }
  .diag {
    align-self: center;
    background: none;
    border: 0;
    padding: 10px 12px 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--navy);
    cursor: pointer;
  }
  .foot {
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    margin: 4px 0 0;
  }
</style>
