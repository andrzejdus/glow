import { bytes, type BleTransport } from '../ble/transport';
import type {
  DeviceCapabilities,
  DeviceDriver,
  DeviceKind,
  DeviceState,
  DiagnosticValue,
  DriverModule,
  HeatMode,
  SettingDef,
} from './types';

// Every CRAFTY UUID is 0000xxxx-4c45-4b43-4942-265a524f5453 ("STORZ&BICKEL" reversed).
const uuid = (short: number): string =>
  `${short.toString(16).padStart(8, '0')}-4c45-4b43-4942-265a524f5453`;

const SVC_CONTROL = uuid(0x01);
const SVC_INFO = uuid(0x02);
const SVC_SYSTEM = uuid(0x03);

const CHR = {
  currentTemp: uuid(0x11),
  targetTemp: uuid(0x21),
  boostOffset: uuid(0x31),
  battery: uuid(0x41),
  ledBrightness: uuid(0x51),
  autoShutoff: uuid(0x61),
  autoShutoffRemaining: uuid(0x71),
  heaterOn: uuid(0x81),
  heaterOff: uuid(0x91),
  firmware: uuid(0x32),
  serial: uuid(0x52),
  firmwareBle: uuid(0x72),
  useHours: uuid(0x23),
  status: uuid(0x93),
  batteryStatus: uuid(0x63),
  batteryStatus2: uuid(0x73),
  systemStatus: uuid(0x83),
  // Not in the official app; named alike by J-Cat/crafty-control, duramson/vo0t and lfuelling/sbcontrol.
  chargingStatus: uuid(0xa3),
  batteryVoltage: uuid(0xb3),
  mainsVoltage: uuid(0xc3),
  batteryCurrent: uuid(0xe3),
  securityCode: uuid(0x1b3),
  status2: uuid(0x1c3),
  useMinutes: uuid(0x1e3),
} as const;

/** Project status register (0x93). */
const STATUS_HEATER_ACTIVE = 1 << 4;
const STATUS_BOOST = 1 << 5;
const STATUS_SUPERBOOST = 1 << 6;
/**
 * Undocumented: what the LED shows. On a CRAFTY+ (V03.24) it came on with every green LED and went
 * off with every red one, 4–8 s after the user saw the LED change; nothing else followed the LED.
 */
const STATUS_READY = 1 << 8;

/** Project status register 2 (0x1c3). */
const STATUS2_VIBRATION_OFF = 1 << 0;
const STATUS2_CHARGE_LED_OFF = 1 << 1;
/** The official app's "reached" flag; on a CRAFTY+ it is on for only ~4 s once the target is first hit. */
const STATUS2_TEMP_REACHED = 1 << 2;
const STATUS2_FIND_DEVICE = 1 << 3;
const STATUS2_PERMANENT_BLE = 1 << 12;

/**
 * Battery status (0x63), undocumented. On a CRAFTY+ (V03.24) bits 2, 7 and 15 came on with the charger
 * plugged in and went off when it was pulled, together with bit 13 of battery status 2 and bit 0 of
 * the system status. Glow reads bit 7. The register is not notified, so it is polled.
 */
const BATTERY_STATUS_CHARGER = 1 << 7;
const CHARGER_POLL_MS = 3000;
/** In the background nobody sees the battery, so the charger is not polled. */
const pageHidden = () => globalThis.document?.visibilityState === 'hidden';

/** Written to the security-code characteristic right before the auto shutoff value. */
const SECURITY_CODE_AUTO_SHUTOFF = 815;

const MIN_TEMP = 40;
const MAX_TEMP = 210;
const MIN_BOOST = 1;
const MAX_BOOST = 99;
/** CRAFTY+ superboost sits a fixed 15 °C above the boost temperature. */
const SUPERBOOST_EXTRA = 15;
const AUTO_SHUTOFF_MIN = 30;
const AUTO_SHUTOFF_MAX = 300;
const AUTO_SHUTOFF_STEP = 30;

export const SETTING = {
  vibration: 'vibration',
  permanentBluetooth: 'permanentBluetooth',
  chargeIndicator: 'chargeIndicator',
  ledBrightness: 'ledBrightness',
  autoShutoff: 'autoShutoff',
} as const;

const ALL_SETTINGS: SettingDef[] = [
  {
    key: SETTING.permanentBluetooth,
    group: 'connection',
    label: 'Permanent Bluetooth',
    description:
      'Keeps the {model} ready to connect at any time. Uses a little battery, even while it is off.',
    type: 'toggle',
  },
  {
    key: SETTING.chargeIndicator,
    group: 'battery',
    label: 'Charge indicator lamp',
    type: 'toggle',
  },
  { key: SETTING.vibration, group: 'device', label: 'Vibration', type: 'toggle' },
  {
    key: SETTING.ledBrightness,
    group: 'device',
    label: 'LED brightness',
    type: 'range',
    min: 0,
    max: 100,
    step: 10,
    unit: '%',
  },
  {
    key: SETTING.autoShutoff,
    group: 'device',
    label: 'Automatic shutoff',
    type: 'range',
    min: AUTO_SHUTOFF_MIN,
    max: AUTO_SHUTOFF_MAX,
    step: AUTO_SHUTOFF_STEP,
    unit: 's',
    // S&B support, CRAFTY+ Operation: "automatically turns off after 2 minutes of inactivity".
    defaultValue: 120,
  },
];

/** Settings the official app hides on firmware older than 2.51. */
const NEW_FIRMWARE_ONLY = new Set<string>([SETTING.permanentBluetooth, SETTING.autoShutoff]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const u16 = (value: number) => {
  const v = Math.round(value) & 0xffff;
  return bytes(v & 0xff, v >> 8);
};

const readU16 = (view: DataView): number =>
  view.byteLength >= 2 ? view.getUint16(0, true) : view.byteLength === 1 ? view.getUint8(0) : 0;

const readI16 = (view: DataView): number => (view.byteLength >= 2 ? view.getInt16(0, true) : 0);

const readText = (view: DataView): string =>
  new TextDecoder('utf-8')
    .decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    .replace(/\0+$/, '')
    .trim();

/** Target/boost temperatures are °C × 10; a target above 210 means the device stored °F. */
export function decodeTargetTemp(view: DataView): number {
  const t = Math.round(readU16(view) / 10);
  return t > MAX_TEMP ? Math.round((t - 32) / 1.8) : t;
}

export function decodeCurrentTemp(view: DataView): number {
  return Math.round(readU16(view) / 10);
}

export interface CraftyFirmware {
  major: number;
  minor: number;
  /** Below 2.51: no Settings tab, no heater control, no project-register notifications. */
  legacy: boolean;
  /** Major version 3 and up is a CRAFTY+. */
  plus: boolean;
}

/** Firmware strings look like "V02.51": major = chars 1–2, minor = last two chars. */
export function parseFirmware(text: string): CraftyFirmware {
  const major = parseInt(text.substring(1, 3), 10);
  const minor = parseInt(text.slice(-2), 10);
  const legacy = minor < 51 && major <= 2;
  return { major, minor, legacy, plus: !legacy && major >= 3 };
}

export function modeFromStatus(status: number): HeatMode {
  if (status & STATUS_SUPERBOOST) return 'superboost';
  if (status & STATUS_BOOST) return 'boost';
  return 'normal';
}

export function settingsFromStatus2(status2: number): Record<string, boolean> {
  return {
    [SETTING.vibration]: (status2 & STATUS2_VIBRATION_OFF) === 0,
    [SETTING.chargeIndicator]: (status2 & STATUS2_CHARGE_LED_OFF) === 0,
    [SETTING.permanentBluetooth]: (status2 & STATUS2_PERMANENT_BLE) !== 0,
  };
}

/**
 * CRAFTY-specific extras on top of DeviceDriver.
 * - modeSwitchable: the app cannot switch boost/superboost on a CRAFTY; the button on the
 *   device does. mode is reported live, setMode() rejects anything but the current mode.
 * - tempReached: what the LED shows (green). Project status bit 8 on current firmware; legacy
 *   firmware falls back to the official app's status register 2 bit 2.
 */
export interface CraftyDriverExtras {
  readonly modeSwitchable: false;
  readonly tempReached: boolean;
}

class CraftyDriver implements DeviceDriver, CraftyDriverExtras {
  readonly kind: DeviceKind = 'crafty';
  readonly modeSwitchable = false as const;

  private emit: (patch: Partial<DeviceState>) => void = () => {};
  private queue: Promise<unknown> = Promise.resolve();
  private subscribed: [string, string][] = [];
  private firmware: CraftyFirmware | null = null;
  private status = 0;
  private status2 = 0;
  private target = MIN_TEMP;
  private boost = 10;
  private autoShutoff = AUTO_SHUTOFF_MIN;
  private ledBrightness = 100;
  private mode: HeatMode = 'normal';
  private _tempReached = false;
  private chargerTimer: ReturnType<typeof setInterval> | undefined;
  /** Battery status updates the device pushed by itself (unknown whether it does; three clients subscribe). */
  private batteryStatusPushes = 0;

  constructor(private readonly ble: BleTransport) {}

  get tempReached(): boolean {
    return this._tempReached;
  }

  private get legacy(): boolean {
    return this.firmware?.legacy ?? false;
  }

  get capabilities(): DeviceCapabilities {
    return {
      pump: false,
      battery: true,
      boost: true,
      // CRAFTY+ has a Superbooster (triple click); its offset is fixed at Booster + 15 °C.
      superBoost: this.firmware?.plus ?? false,
      findMy: this.firmware ? this.firmware.plus : true,
      heaterToggle: !this.legacy,
    };
  }

  get settingDefs(): SettingDef[] {
    return this.legacy ? ALL_SETTINGS.filter((d) => !NEW_FIRMWARE_ONLY.has(d.key)) : ALL_SETTINGS;
  }

  /** Runs GATT operations strictly one after another. */
  private op<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private read(service: string, chr: string) {
    return this.op(() => this.ble.read(service, chr));
  }

  private write(service: string, chr: string, value: DataView) {
    return this.op(() => this.ble.write(service, chr, value));
  }

  private async subscribe(service: string, chr: string, handler: (v: DataView) => void) {
    await this.op(() => this.ble.startNotifications(service, chr, handler));
    this.subscribed.push([service, chr]);
  }

  private onCurrentTemp = (v: DataView) => this.emit({ currentTemp: decodeCurrentTemp(v) });
  private onBattery = (v: DataView) => this.emit({ battery: clamp(readU16(v), 0, 100) });
  private onAutoShutoffRemaining = (v: DataView) =>
    this.emit({ autoShutoffRemainingSec: readU16(v) });

  private onStatus = (v: DataView) => {
    this.status = readU16(v);
    this.mode = modeFromStatus(this.status);
    this._tempReached = this.reached();
    this.emit({ heaterOn: (this.status & STATUS_HEATER_ACTIVE) !== 0, mode: this.mode, tempReached: this._tempReached });
  };

  private onStatus2 = (v: DataView) => {
    this.status2 = readU16(v);
    this._tempReached = this.reached();
    this.emit({ tempReached: this._tempReached, settings: this.currentSettings() });
  };

  private reached(): boolean {
    return this.legacy ? (this.status2 & STATUS2_TEMP_REACHED) !== 0 : (this.status & STATUS_READY) !== 0;
  }

  private currentSettings(): Record<string, boolean | number> {
    const s: Record<string, boolean | number> = {
      ...settingsFromStatus2(this.status2),
      [SETTING.ledBrightness]: this.ledBrightness,
    };
    if (this.legacy) delete s[SETTING.permanentBluetooth];
    else s[SETTING.autoShutoff] = this.autoShutoff;
    return s;
  }

  private boostPatch(): Partial<DeviceState> {
    const patch: Partial<DeviceState> = { boostOffset: this.boost };
    if (this.firmware?.plus) patch.superBoostOffset = this.boost + SUPERBOOST_EXTRA;
    return patch;
  }

  async start(onChange: (patch: Partial<DeviceState>) => void): Promise<void> {
    this.emit = onChange;
    this.emit({ kind: 'crafty', model: 'CRAFTY', minTemp: MIN_TEMP, maxTemp: MAX_TEMP });

    this.target = decodeTargetTemp(await this.read(SVC_CONTROL, CHR.targetTemp));
    this.emit({ targetTemp: this.target });

    this.emit({ serial: readText(await this.read(SVC_INFO, CHR.serial)).substring(0, 8) });

    await this.subscribe(SVC_CONTROL, CHR.currentTemp, this.onCurrentTemp);
    this.onCurrentTemp(await this.read(SVC_CONTROL, CHR.currentTemp));

    this.boost = Math.round(readU16(await this.read(SVC_CONTROL, CHR.boostOffset)) / 10);

    const fwText = readText(await this.read(SVC_INFO, CHR.firmware));
    this.firmware = parseFirmware(fwText);
    this.emit({
      firmware: fwText,
      model: this.firmware.plus ? 'CRAFTY+' : 'CRAFTY',
      ...this.boostPatch(),
    });

    await this.subscribe(SVC_SYSTEM, CHR.status2, this.onStatus2);
    this.status2 = readU16(await this.read(SVC_SYSTEM, CHR.status2));
    this._tempReached = this.reached();
    this.emit({ tempReached: this._tempReached });

    await this.readOperatingTime();

    if (!this.legacy) {
      const v = await this.read(SVC_INFO, CHR.firmwareBle);
      const parts = [0, 1, 2].map((i) => (i < v.byteLength ? v.getUint8(i) : 0));
      this.emit({ firmwareBle: `V${parts.join('.')}` });
    }

    this.ledBrightness = readU16(await this.read(SVC_CONTROL, CHR.ledBrightness));

    if (!this.legacy) {
      // Like the official app, which calls it "autoOffCountdown", Glow reads the auto-off setting
      // only here. On a CRAFTY+ it stayed the same through a whole heating session.
      this.autoShutoff = readU16(await this.read(SVC_CONTROL, CHR.autoShutoff));
      this.emit({ autoShutoffSec: this.autoShutoff });
      await this.subscribe(SVC_CONTROL, CHR.autoShutoffRemaining, this.onAutoShutoffRemaining);
      this.onAutoShutoffRemaining(await this.read(SVC_CONTROL, CHR.autoShutoffRemaining));
    }
    this.emit({ settings: this.currentSettings() });

    await this.subscribe(SVC_CONTROL, CHR.battery, this.onBattery);
    this.onBattery(await this.read(SVC_CONTROL, CHR.battery));
    await this.readBatteryStats();

    if (!this.legacy) await this.subscribe(SVC_SYSTEM, CHR.status, this.onStatus);
    this.onStatus(await this.read(SVC_SYSTEM, CHR.status));

    // The official app reads the battery status only on current firmware, so legacy units get no charging state.
    if (!this.legacy) {
      // Try notifications too; the 3 s poll stays until diagnostics show the device sends them.
      await this.subscribe(SVC_SYSTEM, CHR.batteryStatus, this.onBatteryStatus).catch(() => undefined);
      await this.readCharger();
      // The current changes quickly, so it is read with the charger while the app is visible.
      this.chargerTimer = setInterval(() => pageHidden() || this.readCharger().then(() => this.readBatteryStats()), CHARGER_POLL_MS);
      globalThis.document?.addEventListener('visibilitychange', this.onVisible);
    }
  }

  private onVisible = () => {
    if (!pageHidden()) this.readCharger();
  };

  /**
   * 00b3 voltage and 00e3 current, as J-Cat/crafty-control and duramson/vo0t read them; each is
   * reported only when plausible (one Li-ion cell, at most 10 A).
   */
  private async readBatteryStats() {
    const v = await this.read(SVC_SYSTEM, CHR.batteryVoltage).catch(() => null);
    const mv = v ? readU16(v) : 0;
    if (mv >= 2500 && mv <= 4500) this.emit({ batteryVoltage: mv });
    const c = await this.read(SVC_SYSTEM, CHR.batteryCurrent).catch(() => null);
    const ma = c ? readI16(c) : undefined;
    if (ma !== undefined && Math.abs(ma) <= 10000) this.emit({ batteryCurrent: ma });
  }

  private async readCharger() {
    const v = await this.read(SVC_SYSTEM, CHR.batteryStatus).catch(() => null);
    if (v) this.emit({ charging: (readU16(v) & BATTERY_STATUS_CHARGER) !== 0 });
  }

  private onBatteryStatus = (v: DataView) => {
    this.batteryStatusPushes++;
    this.emit({ charging: (readU16(v) & BATTERY_STATUS_CHARGER) !== 0 });
  };

  private async readOperatingTime() {
    const hours = readU16(await this.read(SVC_SYSTEM, CHR.useHours));
    const minutes = this.legacy ? 0 : readU16(await this.read(SVC_SYSTEM, CHR.useMinutes));
    this.emit({ operatingMinutes: hours * 60 + minutes });
  }

  async stop(): Promise<void> {
    clearInterval(this.chargerTimer);
    globalThis.document?.removeEventListener('visibilitychange', this.onVisible);
    const subs = this.subscribed;
    this.subscribed = [];
    for (const [service, chr] of subs) {
      await this.op(() => this.ble.stopNotifications(service, chr)).catch(() => undefined);
    }
    this.emit = () => {};
  }

  /** Like the official app, the boost offset is rewritten after the target so the sum stays ≤ 210 °C. */
  async setTargetTemp(celsius: number): Promise<void> {
    const target = clamp(Math.round(celsius), MIN_TEMP, MAX_TEMP);
    const boost = clamp(Math.min(this.boost, MAX_TEMP - target), MIN_BOOST, MAX_BOOST);
    await this.write(SVC_CONTROL, CHR.targetTemp, u16(target * 10));
    this.target = target;
    this.emit({ targetTemp: target });
    await this.write(SVC_CONTROL, CHR.boostOffset, u16(boost * 10));
    this.boost = boost;
    this.emit(this.boostPatch());
  }

  async setHeater(on: boolean): Promise<void> {
    if (this.legacy) throw new Error('This CRAFTY firmware does not allow heater control from the app');
    await this.write(SVC_CONTROL, on ? CHR.heaterOn : CHR.heaterOff, bytes(0x00, 0x00));
    this.emit({ heaterOn: on });
  }

  async setMode(mode: HeatMode): Promise<void> {
    if (mode !== this.mode) {
      throw new Error('CRAFTY boost and superboost are switched with the button on the device');
    }
  }

  async setBoostOffsets(boost: number): Promise<void> {
    const value = clamp(Math.round(boost), MIN_BOOST, Math.min(MAX_BOOST, MAX_TEMP - this.target));
    await this.write(SVC_CONTROL, CHR.boostOffset, u16(value * 10));
    this.boost = value;
    this.emit(this.boostPatch());
  }

  private async writeStatus2Bit(mask: number, set: boolean) {
    const next = set ? this.status2 | mask : this.status2 & ~mask;
    await this.write(SVC_SYSTEM, CHR.status2, u16(next));
    this.onStatus2(await this.read(SVC_SYSTEM, CHR.status2));
  }

  async setSetting(key: string, value: boolean | number): Promise<void> {
    switch (key) {
      case SETTING.vibration:
        return this.writeStatus2Bit(STATUS2_VIBRATION_OFF, !value);
      case SETTING.chargeIndicator:
        return this.writeStatus2Bit(STATUS2_CHARGE_LED_OFF, !value);
      case SETTING.permanentBluetooth:
        if (this.legacy) throw new Error('Not supported by this CRAFTY firmware');
        return this.writeStatus2Bit(STATUS2_PERMANENT_BLE, Boolean(value));
      case SETTING.ledBrightness: {
        const level = clamp(Math.round(Number(value)), 0, 100);
        await this.write(SVC_CONTROL, CHR.ledBrightness, u16(level));
        this.ledBrightness = level;
        this.emit({ settings: this.currentSettings() });
        return;
      }
      case SETTING.autoShutoff: {
        if (this.legacy) throw new Error('Not supported by this CRAFTY firmware');
        const stepped = Math.round(Number(value) / AUTO_SHUTOFF_STEP) * AUTO_SHUTOFF_STEP;
        const seconds = clamp(stepped, AUTO_SHUTOFF_MIN, AUTO_SHUTOFF_MAX);
        await this.op(async () => {
          await this.ble.write(SVC_SYSTEM, CHR.securityCode, u16(SECURITY_CODE_AUTO_SHUTOFF));
          await this.ble.write(SVC_CONTROL, CHR.autoShutoff, u16(seconds));
        });
        this.autoShutoff = seconds;
        this.emit({ autoShutoffSec: seconds, settings: this.currentSettings() });
        return;
      }
      default:
        throw new Error(`Unknown CRAFTY setting: ${key}`);
    }
  }

  /** Sets the find-device bit; the device beeps/vibrates and clears it after about 30 s. */
  async findMyDevice(): Promise<void> {
    if (this.firmware && !this.firmware.plus) throw new Error('Find My CRAFTY needs a CRAFTY+');
    if (this.status2 & STATUS2_FIND_DEVICE) return;
    await this.writeStatus2Bit(STATUS2_FIND_DEVICE, true);
  }

  async diagnostics(): Promise<DiagnosticValue[]> {
    // The official app reads the last three only for its analysis; their bits are undocumented.
    // label, service, characteristic, unit (plain number instead of bits), quiet (not logged), signed
    const registers: [string, string, string, string?, boolean?, boolean?][] = [
      ['Project status', SVC_SYSTEM, CHR.status],
      ['Project status 2', SVC_SYSTEM, CHR.status2],
      ['System status', SVC_SYSTEM, CHR.systemStatus],
      ['Battery status', SVC_SYSTEM, CHR.batteryStatus],
      ['Battery status 2', SVC_SYSTEM, CHR.batteryStatus2],
      ['Battery', SVC_CONTROL, CHR.battery, '%'],
      ['Auto-off setting', SVC_CONTROL, CHR.autoShutoff, 's'],
      ['Auto-off left', SVC_CONTROL, CHR.autoShutoffRemaining, 's', true],
      // Other clients read these as the charger state (2 = charging), mains voltage and battery current.
      ['Charging status', SVC_SYSTEM, CHR.chargingStatus],
      ['Battery voltage', SVC_SYSTEM, CHR.batteryVoltage, 'mV', true],
      ['Mains voltage', SVC_SYSTEM, CHR.mainsVoltage, 'mV', true],
      ['Battery current', SVC_SYSTEM, CHR.batteryCurrent, 'mA', true, true],
    ];
    const out: DiagnosticValue[] = [];
    for (const [label, service, chr, unit, quiet, signed] of registers) {
      const value = await this.read(service, chr).then(signed ? readI16 : readU16, () => null);
      out.push({ label, source: `0x${chr.slice(4, 8)}`, value, unit, quiet });
    }
    out.push({ label: 'Battery status pushes', source: 'notify 0x0063', value: this.batteryStatusPushes, unit: '×' });
    return out;
  }

  async refresh(): Promise<void> {
    this.target = decodeTargetTemp(await this.read(SVC_CONTROL, CHR.targetTemp));
    this.boost = Math.round(readU16(await this.read(SVC_CONTROL, CHR.boostOffset)) / 10);
    this.emit({ targetTemp: this.target, ...this.boostPatch() });
    await this.readOperatingTime();
    this.ledBrightness = readU16(await this.read(SVC_CONTROL, CHR.ledBrightness));
    // Not the auto-off setting: see start().
    this.emit({ settings: this.currentSettings() });
    this.onBattery(await this.read(SVC_CONTROL, CHR.battery));
    await this.readBatteryStats();
    // Legacy firmware does not notify the status register.
    if (this.legacy) this.onStatus(await this.read(SVC_SYSTEM, CHR.status));
  }
}

export const crafty: DriverModule = {
  kinds: ['crafty'],
  // Original CRAFTY advertises "STORZ&BICKEL", newer units "Storz&Bickel"; matching is case-insensitive.
  namePrefixes: ['STORZ&BICKEL'],
  services: [SVC_CONTROL, SVC_INFO, SVC_SYSTEM],
  identify(name: string): DeviceKind | null {
    return name.trim().toUpperCase().startsWith('STORZ&BICKEL') ? 'crafty' : null;
  },
  create(kind: DeviceKind, transport: BleTransport): DeviceDriver {
    if (kind !== 'crafty') throw new Error(`crafty driver cannot drive ${kind}`);
    return new CraftyDriver(transport);
  },
};

export const CRAFTY_UUIDS = { SVC_CONTROL, SVC_INFO, SVC_SYSTEM, ...CHR };
