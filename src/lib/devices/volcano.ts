import type { BleTransport } from '../ble/transport';
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

// VOLCANO HYBRID. Protocol notes: docs/protocol/volcano.md

const uuid = (prefix: string) => `${prefix}-5354-4f52-5a26-4249434b454c`;

export const VOLCANO_SERVICE_DEVICE = uuid('10100000');
export const VOLCANO_SERVICE_CONTROL = uuid('10110000');

export const VOLCANO_CHAR = {
  firmware: uuid('10100003'),
  firmwareBle: uuid('10100004'),
  serial: uuid('10100008'),
  register1: uuid('1010000c'),
  register2: uuid('1010000d'),
  register3: uuid('1010000e'),
  currentTemp: uuid('10110001'),
  targetTemp: uuid('10110003'),
  ledBrightness: uuid('10110005'),
  autoShutoffRemaining: uuid('1011000c'),
  autoShutoffTime: uuid('1011000d'),
  heaterOn: uuid('1011000f'),
  heaterOff: uuid('10110010'),
  pumpOn: uuid('10110013'),
  pumpOff: uuid('10110014'),
  hours: uuid('10110015'),
  minutes: uuid('10110016'),
} as const;

/** Register 1 (status). */
export const REG1_HEATER = 0x0020;
export const REG1_AUTO_SHUTOFF_ACTIVE = 0x0200;
export const REG1_PUMP = 0x2000;
/** Register 2 (settings). DISPLAY_ON_COOLING is set when the feature is OFF. */
export const REG2_FAHRENHEIT = 0x0200;
export const REG2_DISPLAY_ON_COOLING_OFF = 0x1000;
/** Register 3 (settings). Set when vibration is OFF. */
export const REG3_VIBRATION_OFF = 0x0400;
/** Register write: the mask alone clears the bit, mask | REG_SET sets it. */
export const REG_SET = 0x10000;

export const VOLCANO_MIN_TEMP = 40;
export const VOLCANO_MAX_TEMP = 230;

const capabilities: DeviceCapabilities = {
  pump: true,
  battery: false,
  boost: false,
  superBoost: false,
  findMy: false,
  heaterToggle: true,
};

const settingDefs: SettingDef[] = [
  { key: 'vibration', group: 'device', label: 'Vibration', description: 'Vibrate when the target temperature is reached', type: 'toggle' },
  { key: 'displayOnCooling', group: 'device', label: 'Display on cooling', description: 'Show the temperature while the {model} cools down', type: 'toggle' },
  // Factory values from S&B support, VOLCANO HYBRID Technical Overview: auto shut-off 30 min,
  // display at full brightness ("can be reduced to 10 % via the S&B Web App").
  { key: 'ledBrightness', group: 'device', label: 'LED brightness', type: 'range', min: 0, max: 100, step: 10, unit: '%', defaultValue: 100 },
  { key: 'autoShutoff', group: 'device', label: 'Automatic shutoff', type: 'range', min: 30, max: 360, step: 30, unit: 'min', defaultValue: 30 },
  { key: 'fahrenheit', group: 'device', label: 'Display in °F', description: 'Unit shown on the {model} display', type: 'toggle' },
];

function uintLE(view: DataView, maxBytes = 4): number {
  const n = Math.min(view.byteLength, maxBytes);
  let value = 0;
  for (let i = n - 1; i >= 0; i--) value = value * 256 + view.getUint8(i);
  return value;
}

function u8(value: number): DataView {
  return new DataView(Uint8Array.of(value & 0xff).buffer);
}

function u16(value: number): DataView {
  const view = new DataView(new ArrayBuffer(2));
  view.setUint16(0, value, true);
  return view;
}

function u32(value: number): DataView {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, value >>> 0, true);
  return view;
}

function text(view: DataView): string {
  const raw = new TextDecoder('utf-8').decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return raw.replace(/\0+$/g, '').trim();
}

/** Temperatures are uint16 LE in tenths of °C; the app rounds them to whole degrees. */
export function decodeTemp(view: DataView): number | undefined {
  const celsius = Math.round(uintLE(view, 2) / 10);
  // 0xFFFF-ish values mean "no reading" (the official app drops anything >= 6536 °C).
  return celsius < 6536 ? celsius : undefined;
}

export function encodeTemp(celsius: number): DataView {
  const clamped = Math.min(VOLCANO_MAX_TEMP, Math.max(VOLCANO_MIN_TEMP, celsius));
  return u32(Math.round(clamped * 10));
}

export function encodeRegisterBit(mask: number, set: boolean): DataView {
  return u32(set ? mask | REG_SET : mask);
}

class VolcanoDriver implements DeviceDriver {
  readonly kind: DeviceKind = 'volcano';
  readonly capabilities = capabilities;
  readonly settingDefs = settingDefs;

  private queue: Promise<unknown> = Promise.resolve();
  private onChange: (patch: Partial<DeviceState>) => void = () => {};
  private settings: Record<string, boolean | number> = {};
  private subscribed: Array<[string, string]> = [];
  private autoShutoffActive = false;
  private autoShutoffRemaining?: number;
  private hours?: number;
  private minutes?: number;

  constructor(private readonly ble: BleTransport) {}

  /** Runs GATT operations strictly one at a time. */
  private gatt<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private read(service: string, characteristic: string): Promise<DataView> {
    return this.gatt(() => this.ble.read(service, characteristic));
  }

  private write(service: string, characteristic: string, value: DataView): Promise<void> {
    return this.gatt(() => this.ble.write(service, characteristic, value));
  }

  private async subscribe(service: string, characteristic: string, handler: (v: DataView) => void): Promise<void> {
    await this.gatt(() => this.ble.startNotifications(service, characteristic, handler));
    this.subscribed.push([service, characteristic]);
  }

  private emit(patch: Partial<DeviceState>): void {
    this.onChange(patch);
  }

  private patchSettings(values: Record<string, boolean | number>): void {
    this.settings = { ...this.settings, ...values };
    this.emit({ settings: { ...this.settings } });
  }

  private onRegister1 = (view: DataView): void => {
    const reg = uintLE(view);
    const wasActive = this.autoShutoffActive;
    this.autoShutoffActive = (reg & REG1_AUTO_SHUTOFF_ACTIVE) !== 0;
    const patch: Partial<DeviceState> = { heaterOn: (reg & REG1_HEATER) !== 0, pumpOn: (reg & REG1_PUMP) !== 0 };
    // The time left only when the timer starts or stops: re-sending the last value heard would pull
    // the app's countdown back to it.
    if (this.autoShutoffActive !== wasActive) patch.autoShutoffRemainingSec = this.autoShutoffActive ? this.autoShutoffRemaining : undefined;
    this.emit(patch);
  };

  private onRegister2 = (view: DataView): void => {
    const reg = uintLE(view);
    const fahrenheit = (reg & REG2_FAHRENHEIT) !== 0;
    this.emit({ unit: fahrenheit ? 'F' : 'C' });
    this.patchSettings({ fahrenheit, displayOnCooling: (reg & REG2_DISPLAY_ON_COOLING_OFF) === 0 });
  };

  private onRegister3 = (view: DataView): void => {
    this.patchSettings({ vibration: (uintLE(view) & REG3_VIBRATION_OFF) === 0 });
  };

  private onCurrentTemp = (view: DataView): void => {
    const t = decodeTemp(view);
    if (t !== undefined) this.emit({ currentTemp: t });
  };

  private onTargetTemp = (view: DataView): void => {
    const t = decodeTemp(view);
    if (t !== undefined) this.emit({ targetTemp: t });
  };

  private onAutoShutoffRemaining = (view: DataView): void => {
    this.autoShutoffRemaining = uintLE(view, 2);
    if (this.autoShutoffActive) this.emit({ autoShutoffRemainingSec: this.autoShutoffRemaining });
  };

  private onAutoShutoffTime = (view: DataView): void => {
    const seconds = uintLE(view, 2);
    this.emit({ autoShutoffSec: seconds });
    this.patchSettings({ autoShutoff: Math.round(seconds / 60) });
  };

  private onLedBrightness = (view: DataView): void => {
    this.patchSettings({ ledBrightness: uintLE(view, 2) });
  };

  private onHours = (view: DataView): void => {
    this.hours = uintLE(view, 2);
    this.emitOperatingTime();
  };

  private onMinutes = (view: DataView): void => {
    this.minutes = uintLE(view, 2);
    this.emitOperatingTime();
  };

  private emitOperatingTime(): void {
    if (this.hours === undefined || this.minutes === undefined) return;
    this.emit({ operatingMinutes: this.hours * 60 + this.minutes });
  }

  async start(onChange: (patch: Partial<DeviceState>) => void): Promise<void> {
    this.onChange = onChange;
    this.emit({
      kind: 'volcano',
      model: 'VOLCANO HYBRID',
      minTemp: VOLCANO_MIN_TEMP,
      maxTemp: VOLCANO_MAX_TEMP,
      mode: 'normal',
      heaterOn: false,
      pumpOn: false,
    });

    const D = VOLCANO_SERVICE_DEVICE;
    const C = VOLCANO_SERVICE_CONTROL;
    const ch = VOLCANO_CHAR;

    // Same order as the official app (bootloader and firmware-update steps left out).
    this.onRegister2(await this.read(D, ch.register2));
    await this.subscribe(D, ch.register2, this.onRegister2);

    await this.subscribe(C, ch.targetTemp, this.onTargetTemp);
    this.onTargetTemp(await this.read(C, ch.targetTemp));

    await this.subscribe(C, ch.currentTemp, this.onCurrentTemp);
    this.onCurrentTemp(await this.read(C, ch.currentTemp));

    this.emit({ serial: text(await this.read(D, ch.serial)).substring(0, 8) });
    this.emit({ firmware: text(await this.read(D, ch.firmware)).substring(0, 8) });
    this.emit({ firmwareBle: text(await this.read(D, ch.firmwareBle)) });

    await this.subscribe(C, ch.autoShutoffRemaining, this.onAutoShutoffRemaining);
    this.onAutoShutoffRemaining(await this.read(C, ch.autoShutoffRemaining));

    await this.subscribe(C, ch.hours, this.onHours);
    this.onHours(await this.read(C, ch.hours));
    await this.subscribe(C, ch.minutes, this.onMinutes);
    this.onMinutes(await this.read(C, ch.minutes));

    await this.subscribe(D, ch.register1, this.onRegister1);
    this.onRegister1(await this.read(D, ch.register1));

    this.onRegister3(await this.read(D, ch.register3));
    this.onAutoShutoffTime(await this.read(C, ch.autoShutoffTime));
    this.onLedBrightness(await this.read(C, ch.ledBrightness));
  }

  async stop(): Promise<void> {
    const subs = this.subscribed;
    this.subscribed = [];
    for (const [service, characteristic] of subs) {
      await this.gatt(() => this.ble.stopNotifications(service, characteristic)).catch(() => undefined);
    }
    this.onChange = () => {};
  }

  async setTargetTemp(celsius: number): Promise<void> {
    await this.write(VOLCANO_SERVICE_CONTROL, VOLCANO_CHAR.targetTemp, encodeTemp(celsius));
  }

  async setHeater(on: boolean): Promise<void> {
    await this.write(VOLCANO_SERVICE_CONTROL, on ? VOLCANO_CHAR.heaterOn : VOLCANO_CHAR.heaterOff, u8(0));
    this.emit({ heaterOn: on });
  }

  async setPump(on: boolean): Promise<void> {
    await this.write(VOLCANO_SERVICE_CONTROL, on ? VOLCANO_CHAR.pumpOn : VOLCANO_CHAR.pumpOff, u8(0));
    this.emit({ pumpOn: on });
  }

  async setMode(_mode: HeatMode): Promise<void> {
    // The Volcano has no boost modes.
  }

  async setSetting(key: string, value: boolean | number): Promise<void> {
    const D = VOLCANO_SERVICE_DEVICE;
    const C = VOLCANO_SERVICE_CONTROL;
    switch (key) {
      case 'vibration':
        await this.write(D, VOLCANO_CHAR.register3, encodeRegisterBit(REG3_VIBRATION_OFF, !value));
        this.patchSettings({ vibration: Boolean(value) });
        return;
      case 'displayOnCooling':
        await this.write(D, VOLCANO_CHAR.register2, encodeRegisterBit(REG2_DISPLAY_ON_COOLING_OFF, !value));
        this.patchSettings({ displayOnCooling: Boolean(value) });
        return;
      case 'fahrenheit':
        await this.write(D, VOLCANO_CHAR.register2, encodeRegisterBit(REG2_FAHRENHEIT, Boolean(value)));
        this.emit({ unit: value ? 'F' : 'C' });
        this.patchSettings({ fahrenheit: Boolean(value) });
        return;
      case 'ledBrightness': {
        const level = Math.min(100, Math.max(0, Math.round(Number(value))));
        await this.write(C, VOLCANO_CHAR.ledBrightness, u16(level));
        this.patchSettings({ ledBrightness: level });
        return;
      }
      case 'autoShutoff': {
        const minutes = Math.min(360, Math.max(30, Math.round(Number(value))));
        await this.write(C, VOLCANO_CHAR.autoShutoffTime, u16(minutes * 60));
        this.emit({ autoShutoffSec: minutes * 60 });
        this.patchSettings({ autoShutoff: minutes });
        return;
      }
      default:
        throw new Error(`Unknown VOLCANO setting: ${key}`);
    }
  }

  /**
   * Raw registers, read fresh. Unconfirmed reports to check on a device: register 1 bit 10
   * (0x0400) as "setpoint reached" and bit 9 (0x0200) as "reached once", both from one client
   * (SavageNL/home-assistant-volcano-hybrid); Glow does not act on them yet.
   */
  async diagnostics(): Promise<DiagnosticValue[]> {
    const D = VOLCANO_SERVICE_DEVICE;
    const C = VOLCANO_SERVICE_CONTROL;
    const rows: [string, string, string, string?, boolean?][] = [
      ['Register 1', D, VOLCANO_CHAR.register1],
      ['Register 2', D, VOLCANO_CHAR.register2],
      ['Register 3', D, VOLCANO_CHAR.register3],
      ['Auto-off left', C, VOLCANO_CHAR.autoShutoffRemaining, 's', true],
    ];
    const out: DiagnosticValue[] = [];
    for (const [label, service, chr, unit, quiet] of rows) {
      const value = await this.read(service, chr).then((v) => uintLE(v) & 0xffff, () => null);
      out.push({ label, source: chr.slice(0, 8), value, unit, quiet });
    }
    return out;
  }

  async refresh(): Promise<void> {
    const D = VOLCANO_SERVICE_DEVICE;
    const C = VOLCANO_SERVICE_CONTROL;
    this.onRegister3(await this.read(D, VOLCANO_CHAR.register3));
    this.onAutoShutoffTime(await this.read(C, VOLCANO_CHAR.autoShutoffTime));
    this.onLedBrightness(await this.read(C, VOLCANO_CHAR.ledBrightness));
    this.onHours(await this.read(C, VOLCANO_CHAR.hours));
    this.onMinutes(await this.read(C, VOLCANO_CHAR.minutes));
  }
}

export const volcano: DriverModule = {
  kinds: ['volcano'],
  namePrefixes: ['S&B VOLCANO'],
  services: [VOLCANO_SERVICE_DEVICE, VOLCANO_SERVICE_CONTROL],
  identify(name: string): DeviceKind | null {
    return name.toUpperCase().includes('S&B VOLCANO') ? 'volcano' : null;
  },
  create(_kind: DeviceKind, transport: BleTransport): DeviceDriver {
    return new VolcanoDriver(transport);
  },
};

export type VolcanoWorkflowStep =
  | { kind: 'heat'; celsius: number }
  | { kind: 'pump'; seconds: number }
  | { kind: 'hold'; seconds: number };

export interface VolcanoWorkflow {
  id: string;
  name: string;
  steps: VolcanoWorkflowStep[];
}

/** [target °C, hold s, pump s] per stage, as in the official app. Hold 0 means no hold step. */
type Stage = [number, number, number];

function stages(list: Stage[]): VolcanoWorkflowStep[] {
  return list.flatMap(([celsius, hold, pump]): VolcanoWorkflowStep[] => [
    { kind: 'heat', celsius },
    ...(hold > 0 ? [{ kind: 'hold' as const, seconds: hold }] : []),
    { kind: 'pump', seconds: pump },
  ]);
}

export const volcanoWorkflows: VolcanoWorkflow[] = [
  {
    id: 'balloon',
    name: 'Balloon',
    steps: stages([170, 175, 180, 185, 190, 195, 200, 205, 210, 215, 220].map((t): Stage => [t, 0, 5])),
  },
  {
    id: 'flow1',
    name: 'Flow 1',
    steps: stages([
      [182, 10, 10],
      [192, 7, 12],
      [201, 5, 10],
      [220, 3, 10],
    ]),
  },
  {
    id: 'flow2',
    name: 'Flow 2',
    steps: stages([
      [175, 0, 7],
      [180, 0, 7],
      [185, 0, 7],
      [190, 0, 7],
      [195, 0, 10],
    ]),
  },
  {
    id: 'flow3',
    name: 'Flow 3',
    steps: stages([
      [174, 20, 8],
      [199, 0, 20],
      [213, 0, 10],
      [222, 0, 10],
    ]),
  },
];
