import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { ble, type FoundDevice } from './ble/adapter';
import type { BleTransport } from './ble/transport';
import { withTimeout } from './ble/util';
import { createDemoDriver } from './devices/demo';
import { createDriver, modelNames } from './devices/registry';
import type { DeviceCapabilities, DeviceDriver, DeviceKind, DeviceState, DiagnosticValue, HeatMode, SettingDef } from './devices/types';
import { load, save } from './prefs';
import { demoHistory, usage } from './usage.svelte';

export type Phase =
  | 'starting'
  | 'idle'
  | 'searching'
  | 'choosing'
  | 'connecting'
  | 'syncing'
  | 'connected'
  | 'reconnecting';

interface Saved {
  last: FoundDevice | null;
  autoConnect: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function tap() {
  if (ble.native) Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

class Connection {
  readonly native = ble.native;
  phase = $state<Phase>('starting');
  message = $state('');
  device = $state<DeviceState | null>(null);
  caps = $state<DeviceCapabilities | null>(null);
  settingDefs = $state.raw<SettingDef[]>([]);
  /** False on CRAFTY: boost is switched with the button on the device only. */
  modeSwitchable = $state(true);
  /** The boost offsets can be written (VENTY/VEAZY: both, CRAFTY: one common Booster offset). */
  offsetsAdjustable = $state(false);
  /** The driver can show its raw registers (Settings › Device diagnostics). */
  diagnosable = $state(false);
  target = $state<FoundDevice | null>(null);
  last = $state<FoundDevice | null>(null);
  autoConnect = $state(true);
  found = $state<FoundDevice[]>([]);
  scanning = $state(false);
  demo = $state(false);
  /** Shown next to the connect steps. */
  meta = $state({ bluetoothMs: 0, rssi: undefined as number | undefined, values: 0 });
  toast = $state<string | null>(null);
  /** When the device last reported the auto-off time left; the UI counts down from there. */
  autoOffAt = $state(0);
  /**
   * Whether the device's auto-off timer is running, and when it will run out. A CRAFTY+ holds the
   * full time while heating up and after a draw cools it below the target, repeating it every
   * ~2.4 s, and counts down only once it is ready again.
   */
  private autoOffRunning = true;
  private autoOffEnd = 0;
  /** When the device last restarted its auto-off timer while heating (a CRAFTY+ does on each draw). */
  autoOffRestartAt = $state(0);

  private driver: DeviceDriver | null = null;
  private generation = 0;
  private userDisconnect = false;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private writers = new Map<string, { op: () => Promise<void> | undefined; busy: boolean; timer?: ReturnType<typeof setTimeout> }>();
  /** Field → until when the device's reports of it are ignored (a newer value is on its way). */
  private holds = new Map<string, number>();

  async start() {
    const saved = await load<Saved>('connection', { last: null, autoConnect: true });
    this.last = saved.last;
    this.autoConnect = saved.autoConnect;

    const demo = new URLSearchParams(location.search).get('demo');
    if (demo === 'venty' || demo === 'volcano' || demo === 'crafty') return this.startDemo(demo);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.phase === 'idle' && this.native && this.autoConnect && !this.userDisconnect) this.search();
      // The refresh is skipped in the background, so catch up as soon as the app is back.
      else if (this.phase === 'connected') this.driver?.refresh?.().catch(() => undefined);
    });

    if (this.native) {
      if (this.autoConnect || !this.last) return this.search();
      this.phase = 'idle';
      return;
    }
    this.phase = 'idle';
    if (this.autoConnect && this.last) {
      const known = await ble.known().catch(() => [] as FoundDevice[]);
      const match = known.find((d) => d.id === this.last?.id);
      if (match) this.connectTo(match, ++this.generation, true);
    }
  }

  /**
   * Android: reconnect to the last device, or find one, with no taps.
   * `choose` lists every device nearby instead ("Pair another device").
   */
  async search(choose = false) {
    const gen = ++this.generation;
    this.userDisconnect = false;
    this.found = [];
    this.message = '';
    this.phase = choose ? 'choosing' : 'searching';
    const t0 = performance.now();
    try {
      await ble.init();
    } catch (e) {
      return this.fail(e, gen);
    }
    if (gen !== this.generation) return;
    this.meta.bluetoothMs = performance.now() - t0;

    if (!choose && this.last) {
      if (await this.connectTo(this.last, gen, true, 6000, true)) return;
      if (gen !== this.generation) return;
      this.phase = 'searching';
    }

    let decided = false;
    let firstAt = 0;
    const pick = (d: FoundDevice) => {
      decided = true;
      ble.stopScan();
      this.connectTo(d, gen);
    };
    this.scanning = true;
    const scan = ble.scan((d) => {
      if (gen !== this.generation || decided) return;
      this.found = [...this.found, d];
      if (choose) return;
      if (this.last && d.id === this.last.id) pick(d);
      else if (!firstAt) firstAt = performance.now();
    }, choose ? 10000 : 12000);
    const poll = setInterval(() => {
      if (choose || decided || gen !== this.generation) return clearInterval(poll);
      // Give other devices 2 s to show up; one device connects by itself, several are listed.
      if (firstAt && performance.now() - firstAt > 2000) {
        clearInterval(poll);
        if (this.found.length === 1) pick(this.found[0]);
        else {
          decided = true;
          ble.stopScan();
          this.phase = 'choosing';
        }
      }
    }, 250);
    await scan;
    clearInterval(poll);
    if (gen !== this.generation) return;
    this.scanning = false;
    if (decided || choose) return;
    if (this.found.length > 0) {
      this.phase = 'choosing';
      return;
    }
    this.phase = 'idle';
    this.message = 'No device found. Switch it on and keep it close.';
  }

  /** Browser: the Web Bluetooth chooser (one tap). */
  async chooseInBrowser() {
    const gen = ++this.generation;
    this.userDisconnect = false;
    this.message = '';
    try {
      await ble.init();
      const d = await ble.choose();
      if (d) await this.connectTo(d, gen);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      this.fail(e, gen);
    }
  }

  connect(d: FoundDevice) {
    tap();
    ble.stopScan();
    this.connectTo(d, ++this.generation);
  }

  async startDemo(kind: DeviceKind) {
    const gen = ++this.generation;
    this.demo = true;
    this.userDisconnect = false;
    const d: FoundDevice = { id: `demo-${kind}`, name: modelNames[kind], kind, rssi: -58 };
    this.target = d;
    this.phase = 'searching';
    this.meta = { bluetoothMs: 180, rssi: -58, values: 0 };
    await sleep(900);
    if (gen !== this.generation) return;
    this.phase = 'connecting';
    await sleep(900);
    if (gen !== this.generation) return;
    await usage.bind(d.id, demoHistory(kind === 'volcano' ? 811 * 60 + 42 : 142 * 60 + 18));
    this.device = null;
    await this.attach(d, createDemoDriver(kind), gen);
  }

  async disconnect() {
    tap();
    this.userDisconnect = true;
    this.generation++;
    clearInterval(this.refreshTimer);
    await this.driver?.stop().catch(() => undefined);
    if (this.target && !this.demo) await ble.disconnect(this.target.id);
    if (this.demo) this.target = null;
    this.driver = null;
    this.demo = false;
    this.device = null;
    this.phase = 'idle';
  }

  setAutoConnect(on: boolean) {
    tap();
    this.autoConnect = on;
    this.persist();
  }

  // Commands. The UI updates at once; the device's own notifications confirm or correct it.

  setTarget(celsius: number, immediate = false) {
    const d = this.device;
    if (!d || !this.live()) return;
    const c = Math.round(Math.min(d.maxTemp, Math.max(d.minTemp, celsius)));
    d.targetTemp = c;
    this.send('target', ['targetTemp'], immediate ? 0 : 150, () => this.driver?.setTargetTemp(c));
  }

  setHeater(on: boolean) {
    if (!this.live()) return;
    tap();
    this.device.heaterOn = on;
    this.send('heater', ['heaterOn'], 0, () => this.driver?.setHeater(on));
  }

  setMode(mode: HeatMode) {
    if (!this.live()) return;
    tap();
    this.device.mode = mode;
    this.send('mode', ['mode'], 0, () => this.driver?.setMode(mode));
  }

  setPump(on: boolean) {
    if (!this.live()) return;
    this.device.pumpOn = on;
    this.send('pump', ['pumpOn'], 0, () => this.driver?.setPump?.(on));
  }

  setSetting(key: string, value: boolean | number) {
    if (!this.live()) return;
    if (typeof value === 'boolean') tap();
    this.device.settings[key] = value;
    this.send(`setting:${key}`, [`settings.${key}`], typeof value === 'number' ? 200 : 0, () => this.driver?.setSetting(key, value));
  }

  setBoostOffset(boost: number) {
    const d = this.device;
    if (!d || !this.live()) return;
    // The Superbooster sits on top of the Booster (CRAFTY+: always 15 °C; VENTY/VEAZY: its own
    // offset), so it moves with it.
    if (d.superBoostOffset !== undefined && d.boostOffset !== undefined) d.superBoostOffset += boost - d.boostOffset;
    d.boostOffset = boost;
    this.send('offsets', ['boostOffset', 'superBoostOffset'], 200, () => this.driver?.setBoostOffsets?.(boost));
  }

  setSuperBoostOffset(superBoost: number) {
    const d = this.device;
    if (!d || d.boostOffset === undefined || !this.live()) return;
    d.superBoostOffset = superBoost;
    const boost = d.boostOffset;
    this.send('offsets', ['boostOffset', 'superBoostOffset'], 200, () => this.driver?.setBoostOffsets?.(boost, superBoost));
  }

  findMy() {
    if (!this.live()) return;
    tap();
    this.run(() => this.driver?.findMyDevice?.());
  }

  /** Commands only go to a connected device; while it reconnects they are refused, not queued. */
  private live(): this is { device: DeviceState } {
    if (this.device && this.phase === 'connected') return true;
    if (this.phase === 'reconnecting') this.say('Waiting for the device - try again once it is back.');
    return false;
  }

  /**
   * Sends only the newest value for `key`, one write at a time: fast taps never queue up a
   * backlog of stale writes. While a value is waiting or being written, and briefly after,
   * the device's reports of those `fields` are ignored so the UI does not jump back.
   */
  private send(key: string, fields: string[], delayMs: number, op: () => Promise<void> | undefined) {
    this.hold(fields, 60_000);
    let w = this.writers.get(key);
    if (!w) {
      w = { op, busy: false };
      this.writers.set(key, w);
    }
    w.op = op;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => this.flush(key, fields), delayMs);
  }

  private async flush(key: string, fields: string[]): Promise<void> {
    const w = this.writers.get(key);
    if (!w || w.busy) return;
    w.busy = true;
    const op = w.op;
    try {
      await op();
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e));
    } finally {
      w.busy = false;
    }
    if (w.op !== op) {
      clearTimeout(w.timer);
      return this.flush(key, fields);
    }
    this.hold(fields, 1500);
  }

  private hold(fields: string[], ms: number) {
    const until = Date.now() + ms;
    for (const f of fields) this.holds.set(f, until);
  }

  private run(op: () => Promise<void> | undefined) {
    op()?.catch((e: unknown) => this.say(e instanceof Error ? e.message : String(e)));
  }

  /**
   * Seconds until auto-off. Devices report it only every few seconds, so this counts down by itself
   * between reports. `now` may be the UI's last clock tick, from before the latest report: counting
   * from it showed a second too many after each report.
   */
  autoOffLeft(now: number): number | undefined {
    const left = this.device?.autoShutoffRemainingSec;
    if (left === undefined) return undefined;
    if (!this.autoOffRunning) return left;
    return Math.max(0, Math.ceil((this.autoOffEnd - Math.max(now, this.autoOffAt)) / 1000));
  }

  /** Fresh raw registers for the diagnostics screen; empty when not connected. */
  async diagnostics(): Promise<DiagnosticValue[]> {
    return (await this.driver?.diagnostics?.()) ?? [];
  }

  say(text: string) {
    this.toast = text;
    setTimeout(() => {
      if (this.toast === text) this.toast = null;
    }, 3500);
  }

  // Connection internals.

  /**
   * `probe`: a try at the remembered device, which no scan has seen yet. The screen stays on
   * "searching" until the device answers, so a device out of range is never shown as found.
   */
  private async connectTo(d: FoundDevice, gen: number, quiet = false, timeoutMs = 10000, probe = false): Promise<boolean> {
    this.target = d;
    this.meta.rssi = d.rssi;
    if (this.phase !== 'reconnecting' && !probe) this.phase = 'connecting';
    let transport: BleTransport;
    try {
      transport = await ble.connect(d, () => this.onDisconnect(d, gen), timeoutMs);
    } catch (e) {
      if (!quiet && gen === this.generation) this.fail(e, gen);
      return false;
    }
    if (gen !== this.generation) {
      ble.disconnect(d.id);
      return false;
    }
    if (this.phase !== 'reconnecting') this.phase = 'connecting';
    try {
      await usage.bind(d.id);
      await this.attach(d, createDriver(d.kind, transport), gen);
      return true;
    } catch (e) {
      ble.disconnect(d.id);
      if (!quiet && gen === this.generation) this.fail(e, gen);
      return false;
    }
  }

  private async attach(d: FoundDevice, driver: DeviceDriver, gen: number) {
    if (this.phase !== 'reconnecting') this.phase = 'syncing';
    this.driver = driver;
    this.caps = driver.capabilities;
    this.settingDefs = driver.settingDefs;
    if (!this.device || this.device.kind !== d.kind) {
      this.device = {
        kind: d.kind,
        model: modelNames[d.kind],
        minTemp: 40,
        maxTemp: d.kind === 'volcano' ? 230 : 210,
        mode: 'normal',
        heaterOn: false,
        settings: {},
      };
    }
    await withTimeout(driver.start((patch) => this.apply(patch)), 15000, 'Reading the device');
    if (gen !== this.generation) return;
    // Some drivers only know their capabilities once they have read the firmware.
    this.caps = { ...driver.capabilities };
    this.settingDefs = driver.settingDefs;
    this.modeSwitchable = (driver as { modeSwitchable?: boolean }).modeSwitchable !== false;
    this.offsetsAdjustable = typeof driver.setBoostOffsets === 'function';
    this.diagnosable = typeof driver.diagnostics === 'function';
    this.meta.values = Object.keys(this.device?.settings ?? {}).length;
    // A demo device is never remembered, or Connect would try to reach it afterwards.
    if (!this.demo) {
      this.last = { id: d.id, name: d.name, kind: d.kind };
      this.persist();
    }
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (globalThis.document?.visibilityState !== 'hidden') driver.refresh?.().catch(() => undefined);
    }, 30000);
    this.phase = 'connected';
    tap();
  }

  private apply(patch: Partial<DeviceState>) {
    const d = this.device;
    if (!d) return;
    const now = Date.now();
    const held = (field: string) => (this.holds.get(field) ?? 0) > now;
    const { settings, ...rest } = patch;
    if (rest.heaterOn === true && !d.heaterOn) {
      // A new session: the time left on record is from the last one. Hold the setting until the
      // device reports.
      d.autoShutoffRemainingSec = d.autoShutoffSec;
      this.autoOffRunning = false;
    }
    if (rest.tempReached === true && !d.tempReached && !this.autoOffRunning && d.heaterOn) {
      // Ready: a CRAFTY+ started counting up to ~1.5 s ago, but says so only in its next report,
      // ~2.4 s later. Waiting for that showed 3:30 jump to 3:28.
      this.autoOffEnd = now + ((d.autoShutoffRemainingSec ?? 1) - 1) * 1000;
      this.autoOffRunning = true;
      this.autoOffAt = now;
    }
    const v = rest.autoShutoffRemainingSec;
    if (v !== undefined) {
      const shown = this.autoOffLeft(now);
      // A restart goes back to the setting. Anything else well above what is shown came late: a
      // burst of reports held up for seconds once showed 1:44 jump back to 1:47.
      const restarted = shown !== undefined && v > shown + 5 && (d.autoShutoffSec === undefined || v === d.autoShutoffSec);
      if ((rest.heaterOn ?? d.heaterOn) && restarted && shown > 0) this.autoOffRestartAt = now;
      if (restarted || v === d.autoShutoffRemainingSec) {
        // Just restarted, or the same value again: the device is holding its timer.
        this.autoOffRunning = false;
      } else {
        // Counting down. Reports wobble by a second or so, and a CRAFTY+ second is ~3% short. The
        // end only ever moves earlier, so the time left never ticks back up, and by at most 0.4 s a
        // report, so it never skips a second, unless the setting was lowered.
        const end = now + v * 1000;
        if (!this.autoOffRunning || end < this.autoOffEnd - 5000) this.autoOffEnd = end;
        else if (end < this.autoOffEnd) this.autoOffEnd = Math.max(end, this.autoOffEnd - 400);
        this.autoOffRunning = true;
      }
      this.autoOffAt = now;
    }
    const fields = rest as Record<string, unknown>;
    const current = d as unknown as Record<string, unknown>;
    for (const k of Object.keys(fields)) if (held(k) && fields[k] !== current[k]) delete fields[k];
    Object.assign(d, fields);
    if (settings) {
      const next = { ...settings };
      for (const k of Object.keys(next)) if (held(`settings.${k}`) && next[k] !== d.settings[k]) delete next[k];
      d.settings = { ...d.settings, ...next };
    }
    usage.observe(d);
  }

  private onDisconnect(d: FoundDevice, gen: number) {
    if (gen !== this.generation || this.userDisconnect) return;
    clearInterval(this.refreshTimer);
    this.driver = null;
    if (this.phase !== 'connected' && this.phase !== 'reconnecting') return;
    this.phase = 'reconnecting';
    this.reconnect(d, gen);
  }

  private async reconnect(d: FoundDevice, gen: number) {
    for (let attempt = 0; gen === this.generation; attempt++) {
      await sleep(attempt < 3 ? 1000 * (attempt + 1) : attempt < 15 ? 5000 : 10000);
      if (gen !== this.generation) return;
      if (await this.connectTo(d, gen, true, 6000)) return;
    }
  }

  private fail(e: unknown, gen: number) {
    if (gen !== this.generation) return;
    this.scanning = false;
    this.phase = 'idle';
    const text = e instanceof Error ? e.message : String(e);
    this.message = /permission|denied/i.test(text)
      ? 'Glow needs the Nearby devices permission to find your device.'
      : /disabled|not enabled|enable/i.test(text)
        ? 'Bluetooth is off. Turn it on and try again.'
        : text;
  }

  private persist() {
    save('connection', { last: $state.snapshot(this.last), autoConnect: this.autoConnect } satisfies Saved);
  }
}

export const conn = new Connection();
