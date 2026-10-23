import type { BleTransport } from '../ble/transport';

export type DeviceKind = 'venty' | 'veazy' | 'volcano' | 'crafty';
export type HeatMode = 'normal' | 'boost' | 'superboost';

/** One row on the Settings screen. Values live in DeviceState.settings[key]. */
export interface SettingDef {
  key: string;
  group: 'connection' | 'battery' | 'boost' | 'device';
  label: string;
  description?: string;
  type: 'toggle' | 'range';
  /** range only */
  min?: number;
  max?: number;
  step?: number;
  /** range only: shown after the value, e.g. "%", "s" */
  unit?: string;
  /** range only: the factory value, from STORZ & BICKEL's documentation. Omitted when it is not documented. */
  defaultValue?: number;
}

/** Everything the UI shows. Drivers report changes as partial patches. */
export interface DeviceState {
  kind: DeviceKind;
  /** Display name: "VENTY", "VEAZY", "VOLCANO HYBRID", "CRAFTY", "CRAFTY+". */
  model: string;
  serial?: string;
  firmware?: string;
  firmwareBle?: string;
  /** Measured temperature, °C. */
  currentTemp?: number;
  /** Base target temperature, °C, without the boost offset. */
  targetTemp?: number;
  minTemp: number;
  maxTemp: number;
  /** °C added to targetTemp in boost / superboost mode. */
  boostOffset?: number;
  superBoostOffset?: number;
  mode: HeatMode;
  heaterOn: boolean;
  /**
   * The device's own "target temperature reached" flag (what turns the CRAFTY+ LED green).
   * Undefined when the device does not report one; the app then compares the temperatures.
   */
  tempReached?: boolean;
  /** VOLCANO air pump. */
  pumpOn?: boolean;
  /** 0–100 */
  battery?: number;
  charging?: boolean;
  /** Lifetime hours of operation as the device reports it, in minutes. */
  operatingMinutes?: number;
  /** The automatic shutoff setting, seconds. */
  autoShutoffSec?: number;
  /** Seconds until automatic shutoff, only when the device reports it. */
  autoShutoffRemainingSec?: number;
  /** The unit the device's own display uses. */
  unit?: 'C' | 'F';
  settings: Record<string, boolean | number>;
}

/** One raw register on the diagnostics screen. */
export interface DiagnosticValue {
  label: string;
  /** Where it comes from, e.g. the characteristic "0x0063". */
  source: string;
  /** Unsigned 16-bit value; null when the read failed. */
  value: number | null;
  /** Set for a plain number (shown with this unit, no bits), e.g. "%" or "s". */
  unit?: string;
  /** Changes all the time (a countdown): shown, but not written to the change log. */
  quiet?: boolean;
}

export interface DeviceCapabilities {
  pump: boolean;
  battery: boolean;
  boost: boolean;
  /** The device has a second boost level (Superboost / CRAFTY+ Superbooster), adjustable or not. */
  superBoost: boolean;
  findMy: boolean;
  /** The heater can be switched from the app (false on devices that only heat while powered on). */
  heaterToggle: boolean;
}

export interface DeviceDriver {
  readonly kind: DeviceKind;
  readonly capabilities: DeviceCapabilities;
  readonly settingDefs: SettingDef[];
  /** Called once after the GATT connection is up: discover, subscribe, read the initial state. */
  start(onChange: (patch: Partial<DeviceState>) => void): Promise<void>;
  /** Unsubscribe; the app closes the connection afterwards. */
  stop(): Promise<void>;
  setTargetTemp(celsius: number): Promise<void>;
  setHeater(on: boolean): Promise<void>;
  setMode(mode: HeatMode): Promise<void>;
  setBoostOffsets?(boost: number, superBoost?: number): Promise<void>;
  setPump?(on: boolean): Promise<void>;
  setSetting(key: string, value: boolean | number): Promise<void>;
  findMyDevice?(): Promise<void>;
  /** Re-read values the device does not notify (hours of operation, battery…). Called every ~30 s. */
  refresh?(): Promise<void>;
  /** Raw registers, read fresh, for working out what undocumented bits mean (CRAFTY charging). */
  diagnostics?(): Promise<DiagnosticValue[]>;
}

/** What each driver module exports next to its driver class. */
export interface DriverModule {
  kinds: DeviceKind[];
  /** Advertised-name prefixes that identify this device family, matched case-insensitively. */
  namePrefixes: string[];
  /** Every primary service UUID the driver uses (Web Bluetooth needs them up front). */
  services: string[];
  /** Pick the exact kind from the advertised name, or null if the name is not this family. */
  identify(name: string): DeviceKind | null;
  create(kind: DeviceKind, transport: BleTransport): DeviceDriver;
}
