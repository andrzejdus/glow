import { Capacitor } from '@capacitor/core';
import type { DeviceKind } from '../devices/types';
import type { BleTransport } from './transport';
import { nativeAdapter } from './native-adapter';
import { webAdapter } from './web-adapter';

export interface FoundDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  rssi?: number;
}

export interface BleAdapter {
  /** True in the Android app: scanning and connecting need no taps. */
  readonly native: boolean;
  /** Ask for the Bluetooth permissions and make sure Bluetooth is on. */
  init(): Promise<void>;
  /** Report STORZ & BICKEL devices nearby until stopScan() or the timeout. Native only. */
  scan(onFound: (device: FoundDevice) => void, timeoutMs: number): Promise<void>;
  stopScan(): Promise<void>;
  /** Browser only: the Web Bluetooth device chooser. Needs a tap. */
  choose(): Promise<FoundDevice | null>;
  /** Browser only: devices this site may reconnect to without the chooser. */
  known(): Promise<FoundDevice[]>;
  connect(device: FoundDevice, onDisconnect: () => void, timeoutMs: number): Promise<BleTransport>;
  disconnect(id: string): Promise<void>;
}

export const ble: BleAdapter = Capacitor.isNativePlatform() ? nativeAdapter() : webAdapter();
