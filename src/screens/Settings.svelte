<script lang="ts">
  import Battery from '../components/Battery.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Slider from '../components/Slider.svelte';
  import Icon from '../components/Icon.svelte';
  import Toggle from '../components/Toggle.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import { background } from '../lib/background';
  import { conn, tap } from '../lib/connection.svelte';
  import { debugging, type DebuggingState } from '../lib/debugging';
  import type { DeviceState, SettingDef } from '../lib/devices/types';
  import { decimal, deltaToUnit, duration, splitHours, toUnit, usageTime } from '../lib/format';
  import { locale, resolveUnit, type UnitChoice, type WeekChoice } from '../lib/locale.svelte';
  import { usage } from '../lib/usage.svelte';

  /** Opens the Stats screen. */
  let { onstats }: { onstats: () => void } = $props();

  const d = $derived(conn.device as DeviceState);
  // Setting texts name the connected model rather than "the device".
  const describe = (s: SettingDef) => s.description?.replaceAll('{model}', d.model);
  const life = $derived(usage.lifetimeSec(usage.now));
  const parts = $derived(life === null ? null : splitHours(life));
  const months = $derived(usage.months(8, usage.now));
  const thisMonth = $derived(months[months.length - 1]?.hours);
  function openStats() {
    tap();
    onstats();
  }

  // A battery device leads with its battery; a VOLCANO (mains, no battery) keeps the hours there.
  const hero = $derived(!!conn.caps?.battery && d.battery !== undefined);
  const level = $derived(Math.max(0, Math.min(100, Math.round(d.battery ?? 0))));
  const low = $derived(level <= 15);
  // Older CRAFTY firmware does not report the charger, so it gets no charging state rather than a wrong one.
  // On the charger at 100 % the battery is full; the bolt stays because it is still plugged in.
  const batteryState = $derived(
    d.charging ? (level >= 100 ? 'Charged' : 'Charging') : low ? 'Low battery' : d.charging === false ? 'On battery' : undefined,
  );

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
  const unit = $derived(locale.unitFor(d.unit));
  // CRAFTY only: in the unit chosen under App, whole degrees like every other temperature here.
  const temp = $derived(d.batteryTemp === undefined ? undefined : `${toUnit(d.batteryTemp, unit)} °${unit}`);
  const plus = (v: number | undefined) => (v === undefined ? '–' : `+${deltaToUnit(v, unit)}°`);
  // Factory offsets (S&B support): Booster +15 over the base, Superbooster +15 over the Booster
  // (+30 over the base) on CRAFTY+, VENTY and VEAZY.
  const factory = { boost: 15, superBoost: 15 };
  // The Superbooster row shows and sets its own step over the Booster, like the Booster row does over
  // the base; the device stores it counted from the base.
  const superOwn = $derived(d.superBoostOffset === undefined ? undefined : d.superBoostOffset - (d.boostOffset ?? 0));
  const superRoom = $derived(Math.max(1, room - (d.boostOffset ?? 0)));

  // The app's own unit, apart from the device setting that changes the device's display.
  const unitChoices: { id: UnitChoice; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'C', label: '°C' },
    { id: 'F', label: '°F' },
  ];
  const unitIndex = $derived(unitChoices.findIndex((c) => c.id === locale.unitChoice));
  const autoUnit = $derived(resolveUnit('auto', d.unit, locale.temperatureUnit));
  function chooseUnit(choice: UnitChoice) {
    tap();
    locale.setUnitChoice(choice);
  }

  // Where weeks start in Stats. Saturday (parts of the Middle East) stays with Auto: a fourth
  // full day name does not fit the row on a narrow phone.
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekChoices: { id: WeekChoice; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 1, label: 'Monday' },
    { id: 0, label: 'Sunday' },
  ];
  const weekIndex = $derived(weekChoices.findIndex((c) => c.id === locale.weekChoice));
  function chooseWeek(choice: WeekChoice) {
    tap();
    locale.setWeekChoice(choice);
  }

  let diagnostics = $state(false);
  let debug = $state<DebuggingState | null>(null);
  debugging?.get().then((s) => (debug = s), () => {});
  function setDebugging(on: boolean) {
    debugging?.set({ enabled: on }).then((s) => (debug = s), () => {});
  }
  // Background recording is set up for one device: the switch shows it on only for that one.
  const bgShown = $derived(!!conn.bg?.supported && !conn.demo);
  const bgOn = $derived(!!conn.bg?.enabled && conn.bg.id?.toUpperCase() === conn.target?.id.toUpperCase());
  // Android's battery optimization may stop the recorder; only Android's own settings can exempt Glow.
  const bgRestricted = $derived(bgOn && conn.bg?.unrestricted === false);
  function batterySettings() {
    background?.openBatterySettings().catch(() => undefined);
  }
  let finding = $state(false);
  function find() {
    conn.findMy();
    finding = true;
    setTimeout(() => (finding = false), 3500);
  }

  function show(def: SettingDef, value: number) {
    if (def.unit === 's') return duration(value);
    if (def.unit === 'min') return value >= 60 ? `${decimal(value / 60, 0, 1)} h` : `${value} min`;
    return `${value}${def.unit ?? ''}`;
  }
  // Battery voltage, current and their product. Current and power show their size only; the
  // battery state above says which way it flows (a CRAFTY+ reports charging as positive).
  // A VENTY or VEAZY reports none of these, only its lifetime time on the charger.
  const electrics = $derived.by(() => {
    const out: { label: string; value: string; unit: string }[] = [];
    const mv = d.batteryVoltage;
    const ma = d.batteryCurrent === undefined ? undefined : Math.abs(d.batteryCurrent);
    if (mv !== undefined) out.push({ label: 'Voltage', value: decimal(mv / 1000, 2), unit: 'V' });
    if (ma !== undefined) out.push(ma < 1000 ? { label: 'Current', value: String(ma), unit: 'mA' } : { label: 'Current', value: decimal(ma / 1000, 2), unit: 'A' });
    if (mv !== undefined && ma !== undefined) out.push({ label: 'Power', value: decimal((mv * ma) / 1e6, 2), unit: 'W' });
    const cm = d.chargingMinutes;
    if (cm !== undefined) out.push(cm < 60 ? { label: 'Charge time', value: String(cm), unit: 'min' } : { label: 'Charge time', value: String(Math.round(cm / 60)), unit: 'h' });
    return out;
  });
  const asNumber = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
</script>

<div class="screen">
  <header class="rise">
    <h1>Settings</h1>
    <div class="pill">{d.model}</div>
  </header>

  <section class="card device rise d1">
    {#if hero && d.battery !== undefined}
      <!-- Settings is where the battery is checked, so it leads; the hours shrink to a row that opens Stats. -->
      <div class="d-top hero">
        <Battery level={d.battery} charging={d.charging} size="lg" />
        <div class="hero-text">
          <div class="label">Battery</div>
          <div class="pct num" class:low>{level}<span>%</span></div>
          {#if batteryState || temp}
            <div class="chips">
              {#if batteryState}
                <span class="chip" class:warm={d.charging || low}>
                  {#if d.charging}<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" /></svg>{/if}{batteryState}
                </span>
              {/if}
              {#if temp}
                <span class="chip t num" class:hot={d.batteryHot} aria-label="Battery temperature {temp}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z" /><path d="M12 9v7" /></svg>{temp}
                </span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {#if d.batteryHot}
        <div class="too-hot" role="status">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
          <div>
            <strong>Battery too hot</strong>
            <span>Let it cool down before heating.</span>
          </div>
        </div>
      {/if}
    {:else}
      <div class="d-top">
        {#if conn.caps?.battery}
          <Glyph kind={d.kind} scale={0.9} />
        {:else}
          <div class="mains"><Icon name="plug" size={30} stroke={2} /><span>Mains</span></div>
        {/if}
        <div>
          <div class="label">Hours of operation</div>
          <div class="life num">
            {#if parts}<span class="h">{parts.h}</span><span class="u">h</span><span class="m">{parts.m}</span><span class="u">m</span>
            {:else}<span class="h">–</span>{/if}
          </div>
          {#if thisMonth !== null && thisMonth !== undefined}
            <button type="button" class="week num" aria-label="+{usageTime(thisMonth)} this month, open Stats" onclick={openStats}>
              +{usageTime(thisMonth)} this month<Icon name="chevron" size={14} stroke={2.6} />
            </button>
          {/if}
        </div>
      </div>
    {/if}
    {#if electrics.length}
      <div class="electrics" style:--n={electrics.length}>
        {#each electrics as e (e.label)}
          <div>
            <span class="e-label">{e.label}</span>
            <span class="e-value num">{e.value}<small>{e.unit}</small></span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="facts">
      <div><span>Serial</span><strong class="num">{d.serial ?? '–'}</strong></div>
      <div><span>Firmware</span><strong class="num">{d.firmware ?? '–'}</strong></div>
      <div><span>{d.kind === 'venty' || d.kind === 'veazy' ? 'Bootloader' : 'BLE'}</span><strong class="num">{d.firmwareBle ?? '–'}</strong></div>
    </div>
    {#if hero}
      <button type="button" class="hours press" aria-label="Hours of operation {parts ? `${parts.h} h ${parts.m} m` : 'unknown'}, open Stats" onclick={openStats}>
        <span class="hours-label">Hours of operation</span>
        <span class="hours-value num">{parts ? `${parts.h} h ${parts.m} m` : '–'}</span>
        <Icon name="chevron" size={16} stroke={2.6} color="var(--orange-ink)" />
      </button>
    {/if}
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
                <span class="value num">{plus(superOwn)}</span>
              </div>
              <div class="temps num">
                <span class="temp"><span>Superbooster</span><strong>{at(d.superBoostOffset)}</strong></span>
              </div>
              {#if crafty}
                <div class="desc">Fixed on CRAFTY+: always {deltaToUnit(15, unit)} °{unit} above the Booster, so it follows the Booster offset.</div>
              {/if}
              <Slider id="superBoostOffset" min={1} max={superRoom} step={1} value={Math.max(1, Math.min(superRoom, superOwn ?? 1))}
                defaultValue={factory.superBoost} disabled={crafty} onchange={(v) => conn.setSuperBoostOffset((d.boostOffset ?? 0) + v)} />
            </div>
          {/if}
        {/if}
        {#each g.items as s (s.key)}
          {#if s.type === 'toggle'}
            <div class="row">
              <div class="text">
                <div class="name"><label for={s.key}>{s.label}</label></div>
                {#if s.description}<div class="desc">{describe(s)}</div>{/if}
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
              {#if s.description}<div class="desc">{describe(s)}</div>{/if}
              <Slider id={s.key} min={s.min ?? 0} max={s.max ?? 100} step={s.step ?? 1} {value} defaultValue={s.defaultValue}
                onchange={(v) => conn.setSetting(s.key, v)} />
            </div>
          {/if}
        {/each}
      </div>
    </section>
  {/each}

  <section class="group rise d2">
    <h2>App</h2>
    <div class="card list">
      <div class="row range">
        <div class="text">
          <div class="name" id="unitLabel">Temperature unit</div>
          <div class="desc">Auto uses the {d.unit ? `${d.model}'s` : "phone's"} unit, now °{autoUnit}.</div>
        </div>
        <div class="seg" role="radiogroup" aria-labelledby="unitLabel" style:--n={unitChoices.length}>
          <span class="thumb" style:transform="translateX({unitIndex * 100}%)"></span>
          {#each unitChoices as c (c.id)}
            <button type="button" role="radio" aria-checked={c.id === locale.unitChoice} class:on={c.id === locale.unitChoice}
              onclick={() => chooseUnit(c.id)}>{c.label}</button>
          {/each}
        </div>
      </div>
      <div class="row range">
        <div class="text">
          <div class="name" id="weekLabel">First day of week</div>
          <div class="desc">Auto uses the phone's, now {days[locale.firstDayOfWeek]}.</div>
        </div>
        <div class="seg" role="radiogroup" aria-labelledby="weekLabel" style:--n={weekChoices.length}>
          <span class="thumb" style:transform="translateX({weekIndex * 100}%)"></span>
          {#each weekChoices as c (c.id)}
            <button type="button" role="radio" aria-checked={c.id === locale.weekChoice} class:on={c.id === locale.weekChoice}
              onclick={() => chooseWeek(c.id)}>{c.label}</button>
          {/each}
        </div>
      </div>
      {#if bgShown}
        <div class="row" class:joined={bgRestricted}>
          <div class="text">
            <div class="name"><label for="background">Record in the background</label></div>
            <div class="desc">
              Records sessions while Glow is closed: Android wakes Glow when the {d.model} is switched on nearby, and shows
              a notification while Glow is connected. Glow lets go of the {d.model} for a moment while you allow it.
            </div>
          </div>
          <Toggle id="background" label="Record in the background" on={bgOn} onchange={(on) => conn.setBackground(on)} />
        </div>
        {#if bgRestricted}
          <div class="row hint">
            <div class="text">
              <div class="desc">
                Battery optimization can stop Glow while it records. Set Glow to “Don't optimize”. On OnePlus and some
                other phones, also lock Glow in the recent apps.
              </div>
            </div>
            <button type="button" class="small press" onclick={batterySettings}>Battery settings</button>
          </div>
        {/if}
      {/if}
      {#if debug}
        <div class="row">
          <div class="text">
            <div class="name"><label for="debugging">Debugging from a computer</label></div>
            <div class="desc">
              Lets a computer with adb access to this phone open DevTools on Glow and read its log. The log starts
              the next time Glow opens.{debug.debugBuild ? ' Debug builds are always open to DevTools.' : ''}
            </div>
          </div>
          <Toggle id="debugging" label="Debugging from a computer" on={debug.enabled} onchange={setDebugging} />
        </div>
      {/if}
    </div>
  </section>

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
  .hero {
    gap: 20px;
  }
  .hero-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pct {
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-size: 60px;
    font-weight: 300;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .pct span {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0;
    color: var(--muted);
  }
  .pct.low {
    color: var(--orange-ink);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--card-2);
    color: var(--ink);
  }
  .chip svg {
    flex-shrink: 0;
  }
  .chip.t {
    gap: 4px;
    padding-left: 7px;
  }
  .chip.warm {
    background: var(--orange-tint);
    color: var(--orange-ink);
  }
  /* The same deep orange in both themes, so white text keeps its contrast on it. */
  .chip.hot {
    background: #c44b00;
    color: #fff;
  }
  .too-hot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--orange-tint);
    border: 1px solid color-mix(in srgb, var(--orange-ink) 35%, transparent);
    color: var(--orange-ink);
  }
  .too-hot svg {
    flex-shrink: 0;
  }
  .too-hot strong {
    display: block;
    font-size: 14px;
    font-weight: 800;
  }
  .too-hot span {
    display: block;
    font-size: 13px;
    color: var(--muted-2);
    margin-top: 1px;
  }
  .mains {
    width: 64px;
    height: 88px;
    flex-shrink: 0;
    border-radius: 18px;
    background: var(--card-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .mains span {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted-2);
  }
  .hours {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 12px 0 14px;
    border: 0;
    border-radius: 14px;
    background: var(--bg);
    color: var(--navy);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .hours-label {
    flex-grow: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-2);
  }
  .hours-value {
    font-size: 15px;
    font-weight: 700;
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
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    color: var(--orange-ink);
    margin-top: 4px;
    cursor: pointer;
  }
  .electrics {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    border-radius: 16px;
    /* Orange mixed into the card: a pale tint on light, a warm glow on dark (not brown). */
    background: color-mix(in srgb, var(--orange) 11%, var(--card));
    padding: 10px 4px;
  }
  .electrics div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .electrics div + div {
    border-left: 1px solid color-mix(in srgb, var(--orange) 22%, transparent);
  }
  .e-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--orange-ink);
  }
  .e-value {
    font-size: 20px;
    font-weight: 300;
    color: var(--navy);
    letter-spacing: -0.01em;
  }
  .e-value small {
    font-size: 12px;
    font-weight: 700;
    margin-left: 2px;
    color: var(--muted);
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
    border-bottom: 1px solid var(--divider);
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
    color: var(--navy);
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
  .seg {
    position: relative;
    height: 40px;
    border-radius: 999px;
    background: var(--bg);
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    padding: 3px;
    margin-top: 4px;
  }
  .seg .thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / var(--n));
    border-radius: 999px;
    background: var(--orange);
    transition: transform 0.35s cubic-bezier(0.3, 1.3, 0.5, 1);
  }
  .seg button {
    position: relative;
    border: 0;
    background: none;
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    color: var(--navy);
    cursor: pointer;
  }
  .seg button.on {
    color: var(--navy-deep);
    font-weight: 800;
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
  .row.joined {
    border-bottom: 0;
  }
  .hint {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding-top: 0;
  }
  .hint .desc {
    margin-top: 0;
  }
  .small {
    flex-shrink: 0;
    height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1.5px solid var(--orange-ink);
    background: transparent;
    color: var(--orange-ink);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
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
