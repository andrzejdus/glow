// VENTY and VEAZY ("Qvap" in the official app). One write+notify
// characteristic carries framed commands; byte 0 of every frame is the
// command id and the device answers each request with a frame of the same id.
// The device does not push on its own, so the driver polls the status frame.
// Protocol reference: docs/protocol/qvap.md.

import type { BleTransport } from '../ble/transport';
import type {
  DeviceCapabilities,
  DeviceDriver,
  DiagnosticValue,
  DeviceKind,
  DeviceState,
  DriverModule,
  HeatMode,
  SettingDef,
} from './types';

export const QVAP_SERVICE = '00000000-5354-4f52-5a26-4249434b454c';
export const QVAP_CONTROL = '00000001-5354-4f52-5a26-4249434b454c';
export const GAP_SERVICE = '00001800-0000-1000-8000-00805f9b34fb';
export const GAP_DEVICE_NAME = '00002a00-0000-1000-8000-00805f9b34fb';

export const CMD = {
  status: 0x01,
  firmware: 0x02,
  usage: 0x04,
  identity: 0x05,
  ui: 0x06,
  findMy: 0x0d,
  advertising: 0x1d,
} as const;

/** Byte 1 of a status (0x01) write: which fields the device takes from the frame. */
export const STATUS_MASK = {
  target: 1 << 1,
  boost: 1 << 2,
  superBoost: 1 << 3,
  heater: 1 << 5,
  settings: 1 << 7,
} as const;

/** Status frame byte 14. */
export const SETTINGS_BIT = {
  fahrenheit: 1 << 0,
  setpointReached: 1 << 1,
  chargeOptimization: 1 << 3,
  targetChangedOnDevice: 1 << 4,
  chargeLimit: 1 << 5,
  boostVisualization: 1 << 6,
} as const;

/** Status frame byte 16. */
export const SETTINGS2_BIT = { permanentBluetooth: 1 << 0 } as const;

/** Byte 1 of a 0x06 write. */
export const UI_MASK = { brightness: 1 << 0, vibration: 1 << 3, boostTimeout: 1 << 4 } as const;

const FIRMWARE_FLAG_APPLICATION = 1 << 0;
const FIND_MY_ACTIVE = 1 << 4;

export const MIN_TEMP = 40;
export const MAX_TEMP = 210;
const MIN_OFFSET = 1;
const MAX_OFFSET = 99;

const FRAME_LEN = 20;
const UI_FRAME_LEN = 7;
/** A field we just wrote is not overwritten by stale poll replies for this long. */
const PENDING_WRITE_MS = 2500;
/** The official app fetches usage every 31st status poll. */
const USAGE_EVERY_N_POLLS = 31;

const MODE_CODES: Record<HeatMode, number> = { normal: 1, boost: 2, superboost: 3 };
/** How long to wait for the device to leave boost after writing mode 1, before cycling the heater. */
const LEAVE_BOOST_CHECK_MS = 1500;

const MODELS: Record<'venty' | 'veazy', string> = { venty: 'VENTY', veazy: 'VEAZY' };

export type QvapKind = 'venty' | 'veazy';

export interface QvapOptions {
  /** Status poll period. The official app polls every 500 ms; 0 disables polling. */
  pollIntervalMs?: number;
  /** How long start() waits for the firmware reply. */
  firmwareTimeoutMs?: number;
}

function frame(length: number, entries: Record<number, number>): DataView {
  const out = new Uint8Array(length);
  for (const [index, value] of Object.entries(entries)) out[Number(index)] = value & 0xff;
  return new DataView(out.buffer);
}

function request(cmd: number): DataView {
  return frame(FRAME_LEN, { 0: cmd });
}

function bytesOf(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function text(view: DataView, start: number, length: number): string {
  const end = Math.min(view.byteLength, start + length);
  if (end <= start) return '';
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, end - start);
  return new TextDecoder('utf-8').decode(raw).replace(/\0/g, '').trim();
}

/** Builds the 20-byte status write that updates only the masked fields. */
export function statusWrite(mask: number, fields: Record<number, number>): DataView {
  return frame(FRAME_LEN, { 0: CMD.status, 1: mask, ...fields });
}

/** Masked write of settings byte 14 (bits) or settings2 byte 16. */
function settingsWrite(byte: 14 | 16, bit: number, on: boolean): DataView {
  return statusWrite(STATUS_MASK.settings, { [byte]: on ? bit : 0, [byte + 1]: bit });
}

function uiWrite(mask: number, fields: Record<number, number>): DataView {
  return frame(UI_FRAME_LEN, { 0: CMD.ui, 1: mask, ...fields });
}

export interface StatusFrame {
  currentTemp: number;
  targetTemp: number;
  boostOffset: number;
  superBoostOffset: number;
  battery: number;
  autoShutoffRemainingSec: number;
  heaterMode: number;
  charging: boolean;
  settings: number;
  settings2?: number;
}

/** Decodes a status (0x01) notification; null when it is too short. */
export function parseStatus(view: DataView): StatusFrame | null {
  if (view.byteLength < 15 || view.getUint8(0) !== CMD.status) return null;
  return {
    currentTemp: view.getUint16(2, true) / 10,
    targetTemp: view.getUint16(4, true) / 10,
    boostOffset: view.getUint8(6),
    superBoostOffset: view.getUint8(7),
    battery: view.getUint8(8),
    autoShutoffRemainingSec: view.getUint16(9, true),
    heaterMode: view.getUint8(11),
    charging: view.getUint8(13) > 0,
    settings: view.getUint8(14),
    settings2: view.byteLength >= 17 ? view.getUint8(16) : undefined,
  };
}

const SETTING_DEFS: Record<string, SettingDef> = {
  permanentBluetooth: {
    key: 'permanentBluetooth',
    group: 'connection',
    label: 'Permanent Bluetooth',
    description:
      'Keeps the {model} ready to connect at any time. Uses a little battery, even while it is off.',
    type: 'toggle',
  },
  chargeOptimization: {
    key: 'chargeOptimization',
    group: 'battery',
    label: 'Charge current optimization',
    description: 'Slower charging to reduce battery aging.',
    type: 'toggle',
  },
  chargeLimit: {
    key: 'chargeLimit',
    group: 'battery',
    label: 'Charge voltage limit',
    description: 'Charges to about 90 % to reduce battery aging.',
    type: 'toggle',
  },
  permanentBoost: {
    key: 'permanentBoost',
    group: 'boost',
    label: 'Permanent boost',
    description: 'Disables the 90 s timeout of Boost and Superboost.',
    type: 'toggle',
  },
  boostVisualization: {
    key: 'boostVisualization',
    group: 'boost',
    label: 'Boost & Superboost visualization',
    type: 'toggle',
  },
  vibration: { key: 'vibration', group: 'device', label: 'Vibration', type: 'toggle' },
  brightness: {
    key: 'brightness',
    group: 'device',
    label: 'LED brightness',
    type: 'range',
    min: 1,
    max: 9,
    step: 1,
  },
  fahrenheit: {
    key: 'fahrenheit',
    group: 'device',
    label: 'Show °F on the device',
    type: 'toggle',
  },
};

interface PendingField {
  value: number;
  until: number;
}

export class QvapDriver implements DeviceDriver {
  readonly kind: QvapKind;
  readonly capabilities: DeviceCapabilities = {
    pump: false,
    battery: true,
    boost: true,
    superBoost: true,
    findMy: true,
    heaterToggle: true,
  };
  readonly settingDefs: SettingDef[];

  private onChange: (patch: Partial<DeviceState>) => void = () => {};
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polls = 0;
  private running = false;
  private firmwareReply: ((applicationRunning: boolean) => void) | undefined;
  private findModeOnConnect = false;
  private gotFirstStatus = false;
  private heaterMode = 0;
  /** The raw offsets as the device reports them; the superboost byte is on top of the boost. */
  private boostRaw = 0;
  private superBoostRaw = 0;
  private modeWrite = 0;
  private pending: { target?: PendingField; boost?: PendingField; superBoost?: PendingField } = {};
  /** The last frame the device sent for each command, for the diagnostics screen. */
  private readonly frames = new Map<number, Uint8Array>();
  /** Status frames whose target is outside 40–210 °C, which no real status has. */
  private oddStatusFrames = 0;
  private lastStatus: Uint8Array | undefined;
  private readonly pollIntervalMs: number;
  private readonly firmwareTimeoutMs: number;

  constructor(
    kind: QvapKind,
    private readonly transport: BleTransport,
    options: QvapOptions = {},
  ) {
    this.kind = kind;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.firmwareTimeoutMs = options.firmwareTimeoutMs ?? 5000;
    const keys = [
      ...(kind === 'veazy' ? ['permanentBluetooth'] : []),
      'chargeOptimization',
      'chargeLimit',
      'permanentBoost',
      'boostVisualization',
      'vibration',
      'brightness',
      'fahrenheit',
    ];
    this.settingDefs = keys.map((key) => SETTING_DEFS[key]);
  }

  async start(onChange: (patch: Partial<DeviceState>) => void): Promise<void> {
    this.onChange = onChange;
    this.running = true;
    onChange({ kind: this.kind, model: MODELS[this.kind], minTemp: MIN_TEMP, maxTemp: MAX_TEMP });

    await this.transport.startNotifications(QVAP_SERVICE, QVAP_CONTROL, (value) =>
      this.handleNotification(value),
    );

    await this.enqueue(async () => {
      try {
        const name = text(await this.transport.read(GAP_SERVICE, GAP_DEVICE_NAME), 0, 64);
        const serial = name.split(' ')[1];
        if (serial) this.onChange({ serial });
      } catch {
        // Generic Access is optional; command 0x05 reports the serial too.
      }
    });

    // Nothing else may be sent before we know the application (not the
    // bootloader) is running: in the bootloader 0x01 is the page-write command.
    const applicationRunning = await this.queryFirmware();
    if (!applicationRunning) {
      throw new Error(
        `The ${MODELS[this.kind]} is in firmware update mode. Update it with the official app or restart it.`,
      );
    }

    for (const cmd of [CMD.advertising, CMD.status, CMD.usage, CMD.identity]) {
      await this.send(request(cmd));
    }
    await this.send(uiWrite(0, {}));

    if (this.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    await this.queue;
    try {
      await this.transport.stopNotifications(QVAP_SERVICE, QVAP_CONTROL);
    } catch {
      // The link may already be gone.
    }
  }

  async setTargetTemp(celsius: number): Promise<void> {
    const value = clamp(Math.round(celsius), MIN_TEMP, MAX_TEMP);
    const raw = value * 10;
    this.pending.target = { value, until: Date.now() + PENDING_WRITE_MS };
    this.onChange({ targetTemp: value });
    await this.send(statusWrite(STATUS_MASK.target, { 4: raw & 0xff, 5: raw >> 8 }));
  }

  async setHeater(on: boolean): Promise<void> {
    await this.send(statusWrite(STATUS_MASK.heater, { 11: on ? 1 : 0 }));
  }

  /**
   * The official app never writes heater modes 2/3; the device's own buttons
   * select boost. Writing them through the heater mask is what community
   * clients do. A mode change while the heater is off is ignored so that it
   * can never switch the heater on.
   */
  async setMode(mode: HeatMode): Promise<void> {
    if (this.heaterMode === 0) return;
    const write = ++this.modeWrite;
    await this.send(statusWrite(STATUS_MASK.heater, { 11: MODE_CODES[mode] }));
    if (mode !== 'normal') return;
    // One live-tested client reports that a VENTY stays in boost after mode 1 and needs the heater
    // switched off and on; another writes mode 1 alone. So: check, and cycle only if boost stayed.
    await new Promise((r) => setTimeout(r, LEAVE_BOOST_CHECK_MS));
    if (write !== this.modeWrite || this.heaterMode < 2) return;
    await this.send(statusWrite(STATUS_MASK.heater, { 11: 0 }));
    await this.send(statusWrite(STATUS_MASK.heater, { 11: 1 }));
  }

  /**
   * Offsets from the base temperature, as the app shows them. The device stores the superboost
   * offset on top of the boost one (superboost = target + boost + superboost byte).
   */
  async setBoostOffsets(boost: number, superBoost?: number): Promise<void> {
    const boostValue = clamp(Math.round(boost), MIN_OFFSET, MAX_OFFSET);
    this.boostRaw = boostValue;
    this.pending.boost = { value: boostValue, until: Date.now() + PENDING_WRITE_MS };
    this.onChange({ boostOffset: boostValue, superBoostOffset: boostValue + this.superBoostRaw });
    await this.send(statusWrite(STATUS_MASK.boost, { 6: boostValue }));
    if (superBoost !== undefined) {
      const superValue = clamp(Math.round(superBoost) - boostValue, MIN_OFFSET, MAX_OFFSET);
      this.superBoostRaw = superValue;
      this.pending.superBoost = { value: superValue, until: Date.now() + PENDING_WRITE_MS };
      this.onChange({ superBoostOffset: boostValue + superValue });
      await this.send(statusWrite(STATUS_MASK.superBoost, { 7: superValue }));
    }
  }

  async setSetting(key: string, value: boolean | number): Promise<void> {
    const on = Boolean(value);
    let write: DataView;
    let confirm: DataView | undefined;
    let stored: boolean | number = on;
    switch (key) {
      case 'chargeOptimization':
        write = settingsWrite(14, SETTINGS_BIT.chargeOptimization, on);
        break;
      case 'chargeLimit':
        write = settingsWrite(14, SETTINGS_BIT.chargeLimit, on);
        break;
      case 'boostVisualization':
        // The Veazy stores this bit inverted (1 = visualization off).
        write = settingsWrite(14, SETTINGS_BIT.boostVisualization, this.kind === 'veazy' ? !on : on);
        break;
      case 'fahrenheit':
        write = settingsWrite(14, SETTINGS_BIT.fahrenheit, on);
        this.onChange({ unit: on ? 'F' : 'C' });
        break;
      case 'permanentBluetooth':
        if (this.kind !== 'veazy') throw new Error('Permanent Bluetooth can only be set on a VEAZY');
        write = settingsWrite(16, SETTINGS2_BIT.permanentBluetooth, on);
        break;
      case 'vibration':
        write = uiWrite(UI_MASK.vibration, { 5: on ? 1 : 0 });
        confirm = uiWrite(0, {});
        break;
      case 'permanentBoost':
        write = uiWrite(UI_MASK.boostTimeout, { 6: on ? 1 : 0 });
        confirm = uiWrite(0, {});
        break;
      case 'brightness':
        stored = clamp(Math.round(Number(value)), 1, 9);
        write = uiWrite(UI_MASK.brightness, { 2: stored });
        confirm = uiWrite(0, {});
        break;
      default:
        throw new Error(`Unknown setting: ${key}`);
    }
    this.onChange({ settings: { [key]: stored } });
    await this.send(write);
    if (confirm) await this.send(confirm);
  }

  async findMyDevice(): Promise<void> {
    await this.send(frame(FRAME_LEN, { 0: CMD.findMy, 1: 0x01 }));
  }

  /**
   * Bytes of the last frames that the app does not decode, or decodes from a single source, as the
   * device sent them. Nothing is read for this: the status is polled every second anyway.
   */
  async diagnostics(): Promise<DiagnosticValue[]> {
    const bytes = (cmd: number, at: number, length: number): number | null => {
      const f = this.frames.get(cmd);
      if (!f || f.length < at + length) return null;
      let v = 0;
      for (let i = length - 1; i >= 0; i--) v = v * 256 + f[at + i];
      return v;
    };
    // label, command, first byte, length (little-endian), unit (plain number instead of bits), quiet (not logged)
    const rows: [string, number, number, number, string?, boolean?][] = [
      ['Current temperature (raw)', CMD.status, 2, 2],
      ['Battery', CMD.status, 8, 1, '%'],
      ['Auto-off left', CMD.status, 9, 2, 's', true],
      ['Heater mode', CMD.status, 11, 1],
      ['Status byte 12', CMD.status, 12, 1],
      ['Charger', CMD.status, 13, 1],
      ['Settings', CMD.status, 14, 1],
      ['Settings 2', CMD.status, 16, 1],
      ['Status bytes 18–19', CMD.status, 18, 2],
      ['Firmware flags', CMD.firmware, 1, 1],
      ['Firmware bytes 8–9', CMD.firmware, 8, 2],
      ['Firmware byte 10', CMD.firmware, 10, 1],
      ['Charging time', CMD.usage, 4, 3, 'min'],
      ['UI bytes 3–4', CMD.ui, 3, 2],
      ['Advertising flags', CMD.advertising, 1, 1],
    ];
    const out: DiagnosticValue[] = rows.map(([label, cmd, at, length, unit, quiet]) => ({
      label,
      source: `0x${cmd.toString(16).padStart(2, '0')} b${at}${length > 1 ? `–${at + length - 1}` : ''}`,
      value: bytes(cmd, at, length),
      unit,
      quiet,
    }));
    out.push({ label: 'Odd status frames', source: 'target out of range', value: this.oddStatusFrames, unit: '×' });
    return out;
  }

  async refresh(): Promise<void> {
    await this.send(request(CMD.usage));
    await this.send(uiWrite(0, {}));
  }

  // --- internals -----------------------------------------------------------

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    this.queued++;
    const run = this.queue.then(op);
    this.queue = run.then(
      () => void this.queued--,
      () => void this.queued--,
    );
    return run;
  }

  private send(value: DataView): Promise<void> {
    return this.enqueue(() => this.transport.write(QVAP_SERVICE, QVAP_CONTROL, value));
  }

  private poll(): void {
    if (!this.running || this.queued > 0) return;
    this.polls++;
    const cmd = this.polls % USAGE_EVERY_N_POLLS === 0 ? CMD.usage : CMD.status;
    this.send(request(cmd)).catch(() => {
      // A failed poll is retried on the next tick; the app notices a dropped link itself.
    });
  }

  private queryFirmware(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.firmwareReply = undefined;
        reject(new Error(`No answer from the ${MODELS[this.kind]} (firmware query timed out)`));
      }, this.firmwareTimeoutMs);
      this.firmwareReply = (applicationRunning) => {
        clearTimeout(timer);
        this.firmwareReply = undefined;
        resolve(applicationRunning);
      };
      this.send(request(CMD.firmware)).catch((error: unknown) => {
        clearTimeout(timer);
        this.firmwareReply = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Accept a reported value unless we wrote a different one moments ago. */
  private accept(field: 'target' | 'boost' | 'superBoost', reported: number): boolean {
    const pending = this.pending[field];
    if (!pending) return true;
    if (pending.value === reported || Date.now() > pending.until) {
      this.pending[field] = undefined;
      return true;
    }
    return false;
  }

  handleNotification(view: DataView): void {
    if (view.byteLength === 0) return;
    this.frames.set(view.getUint8(0), bytesOf(view));
    switch (view.getUint8(0)) {
      case CMD.status:
        this.applyStatus(view);
        break;
      case CMD.firmware:
        this.applyFirmware(view);
        break;
      case CMD.usage:
        if (view.byteLength >= 4) {
          const minutes = view.getUint8(1) | (view.getUint8(2) << 8) | (view.getUint8(3) << 16);
          this.onChange({ operatingMinutes: minutes });
        }
        break;
      case CMD.identity:
        if (view.byteLength > 17) {
          const serial = text(view, 15, 2) + text(view, 9, 6);
          if (serial) this.onChange({ serial });
        }
        break;
      case CMD.ui:
        if (view.byteLength >= 6) {
          const settings: Record<string, boolean | number> = {
            brightness: view.getUint8(2),
            vibration: view.getUint8(5) !== 0,
          };
          if (view.byteLength >= 7) settings.permanentBoost = view.getUint8(6) !== 0;
          this.onChange({ settings });
        }
        break;
      case CMD.advertising:
        if (view.byteLength > 1 && view.getUint8(1) & FIND_MY_ACTIVE) this.findModeOnConnect = true;
        break;
      default:
        break;
    }
  }

  private applyStatus(view: DataView): void {
    const status = parseStatus(view);
    if (!status) return;
    // Raw frames into the console (logcat with the debugging switch on): every odd one, and every
    // change of battery, heater mode or settings, to settle what the status bytes really do.
    const raw = bytesOf(view);
    if (status.targetTemp < MIN_TEMP || status.targetTemp > MAX_TEMP) {
      // No real status has a target outside 40–210 °C: count it and do not let it reset the state.
      this.oddStatusFrames++;
      console.warn(`${MODELS[this.kind]} odd status ${hex(raw)}`);
      return;
    }
    if (!this.lastStatus || [8, 11, 14].some((i) => this.lastStatus![i] !== raw[i])) {
      console.info(`${MODELS[this.kind]} status ${hex(raw)}`);
    }
    this.lastStatus = raw;

    // Connected while the device was in find-my mode: the official app
    // re-reads identity and UI settings once it answers normally.
    if (!this.gotFirstStatus && this.findModeOnConnect) {
      this.findModeOnConnect = false;
      void this.send(request(CMD.identity)).catch(() => {});
      void this.send(uiWrite(0, {})).catch(() => {});
    }
    this.gotFirstStatus = true;
    this.heaterMode = status.heaterMode;

    const mode: HeatMode =
      status.heaterMode === 3 ? 'superboost' : status.heaterMode === 2 ? 'boost' : 'normal';
    const visualizationBit = (status.settings & SETTINGS_BIT.boostVisualization) !== 0;
    const settings: Record<string, boolean | number> = {
      chargeOptimization: (status.settings & SETTINGS_BIT.chargeOptimization) !== 0,
      chargeLimit: (status.settings & SETTINGS_BIT.chargeLimit) !== 0,
      boostVisualization: this.kind === 'veazy' ? !visualizationBit : visualizationBit,
      fahrenheit: (status.settings & SETTINGS_BIT.fahrenheit) !== 0,
    };
    if (status.settings2 !== undefined && this.kind === 'veazy') {
      settings.permanentBluetooth = (status.settings2 & SETTINGS2_BIT.permanentBluetooth) !== 0;
    }

    // No currentTemp: a VENTY/VEAZY does not measure it for the app. The official app hides it,
    // and live-tested clients see 0x8000 ("not available") in bytes 2-3.
    const patch: Partial<DeviceState> = {
      battery: status.battery,
      charging: status.charging,
      heaterOn: status.heaterMode > 0,
      tempReached: (status.settings & SETTINGS_BIT.setpointReached) !== 0,
      mode,
      autoShutoffRemainingSec: status.autoShutoffRemainingSec,
      unit: status.settings & SETTINGS_BIT.fahrenheit ? 'F' : 'C',
      settings,
    };
    if (this.accept('target', status.targetTemp)) patch.targetTemp = status.targetTemp;
    if (this.accept('boost', status.boostOffset)) this.boostRaw = status.boostOffset;
    if (this.accept('superBoost', status.superBoostOffset)) this.superBoostRaw = status.superBoostOffset;
    patch.boostOffset = this.boostRaw;
    patch.superBoostOffset = this.boostRaw + this.superBoostRaw;
    this.onChange(patch);
  }

  private applyFirmware(view: DataView): void {
    if (view.byteLength < 19) return;
    const flags = view.getUint8(1);
    const firmware = text(view, 2, 6);
    const bootloader = text(view, 11, 6);
    this.onChange({ firmware, firmwareBle: bootloader });

    // Permanent boost exists on every Veazy, and on the Venty from firmware x.08.
    if (this.kind === 'venty') {
      const minor = /(\d+)\.?(\d+)$/.exec(firmware);
      if (minor && Number(minor[2]) < 8) {
        const index = this.settingDefs.findIndex((def) => def.key === 'permanentBoost');
        if (index >= 0) this.settingDefs.splice(index, 1);
      }
    }
    this.firmwareReply?.((flags & FIRMWARE_FLAG_APPLICATION) !== 0);
  }
}

export const qvap: DriverModule = {
  kinds: ['venty', 'veazy'],
  namePrefixes: ['S&B VY', 'S&B VZ'],
  services: [QVAP_SERVICE, GAP_SERVICE],
  identify(name: string): DeviceKind | null {
    const upper = name.toUpperCase();
    if (upper.includes('S&B VY')) return 'venty';
    if (upper.includes('S&B VZ')) return 'veazy';
    return null;
  },
  create(kind: DeviceKind, transport: BleTransport): DeviceDriver {
    if (kind !== 'venty' && kind !== 'veazy') throw new Error(`qvap cannot drive a ${kind}`);
    return new QvapDriver(kind, transport);
  },
};
