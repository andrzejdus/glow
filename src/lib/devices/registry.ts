import type { BleTransport } from '../ble/transport';
import { crafty } from './crafty';
import { qvap } from './qvap';
import type { DeviceDriver, DeviceKind, DriverModule } from './types';
import { volcano } from './volcano';

export const modules: DriverModule[] = [qvap, volcano, crafty];

export function identify(name: string): DeviceKind | null {
  for (const m of modules) {
    const kind = m.identify(name);
    if (kind) return kind;
  }
  return null;
}

export function createDriver(kind: DeviceKind, transport: BleTransport): DeviceDriver {
  const m = modules.find((x) => x.kinds.includes(kind));
  if (!m) throw new Error(`No driver for ${kind}`);
  return m.create(kind, transport);
}

export const allServices = [...new Set(modules.flatMap((m) => m.services))];
export const allNamePrefixes = [...new Set(modules.flatMap((m) => m.namePrefixes))];

export const modelNames: Record<DeviceKind, string> = {
  venty: 'VENTY',
  veazy: 'VEAZY',
  volcano: 'VOLCANO',
  crafty: 'CRAFTY',
};
