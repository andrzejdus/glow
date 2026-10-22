import { BleClient, ScanMode, type ScanResult } from '@capacitor-community/bluetooth-le';
import { identify } from '../devices/registry';
import type { BleAdapter, FoundDevice } from './adapter';
import { serial } from './util';
import type { BleTransport } from './transport';

export function nativeAdapter(): BleAdapter {
  let initialized = false;
  let stopWaiting: (() => void) | null = null;

  return {
    native: true,

    async init() {
      if (!initialized) {
        await BleClient.initialize({ androidNeverForLocation: true });
        initialized = true;
      }
      if (!(await BleClient.isEnabled())) await BleClient.requestEnable();
    },

    async scan(onFound, timeoutMs) {
      const named = new Set<string>();
      await BleClient.requestLEScan(
        // Duplicates on: Android often reports a device first without its name.
        { allowDuplicates: true, scanMode: ScanMode.SCAN_MODE_LOW_LATENCY },
        (result: ScanResult) => {
          const id = result.device.deviceId;
          const name = result.localName || result.device.name || '';
          const kind = name ? identify(name) : null;
          if (!kind || named.has(id)) return;
          named.add(id);
          onFound({ id, name, kind, rssi: result.rssi });
        },
      );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        stopWaiting = () => { clearTimeout(timer); resolve(); };
      });
      stopWaiting = null;
      await BleClient.stopLEScan().catch(() => undefined);
    },

    async stopScan() {
      stopWaiting?.();
    },

    async choose() {
      return null;
    },

    async known() {
      return [];
    },

    async connect(device: FoundDevice, onDisconnect, timeoutMs) {
      await BleClient.connect(device.id, () => onDisconnect(), { timeout: timeoutMs });
      return transportFor(device.id);
    },

    async disconnect(id) {
      await BleClient.disconnect(id).catch(() => undefined);
    },
  };
}

function transportFor(id: string): BleTransport {
  const queue = serial();
  return {
    read: (s, c) => queue(() => BleClient.read(id, s, c, { timeout: 5000 })),
    write: (s, c, v) => queue(() => BleClient.write(id, s, c, v, { timeout: 5000 })),
    writeWithoutResponse: (s, c, v) => queue(() => BleClient.writeWithoutResponse(id, s, c, v, { timeout: 5000 })),
    startNotifications: (s, c, cb) => queue(() => BleClient.startNotifications(id, s, c, cb)),
    stopNotifications: (s, c) => queue(() => BleClient.stopNotifications(id, s, c)),
  };
}
