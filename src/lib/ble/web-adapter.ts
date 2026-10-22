import { allNamePrefixes, allServices, identify } from '../devices/registry';
import type { BleAdapter, FoundDevice } from './adapter';
import { serial, withTimeout } from './util';
import type { BleTransport } from './transport';

// Plain Web Bluetooth for running Glow in Chrome. The Android app never uses this.
export function webAdapter(): BleAdapter {
  const devices = new Map<string, BluetoothDevice>();

  const found = (device: BluetoothDevice): FoundDevice | null => {
    const name = device.name ?? '';
    const kind = identify(name);
    if (!kind) return null;
    devices.set(device.id, device);
    return { id: device.id, name, kind };
  };

  return {
    native: false,

    async init() {
      if (!navigator.bluetooth) throw new Error('This browser has no Web Bluetooth. Use Chrome, or the Android app.');
    },

    async scan() {},
    async stopScan() {},

    async choose() {
      const device = await navigator.bluetooth.requestDevice({
        filters: allNamePrefixes.map((namePrefix) => ({ namePrefix })),
        optionalServices: allServices,
      });
      return found(device);
    },

    async known() {
      if (!navigator.bluetooth?.getDevices) return [];
      const list = await navigator.bluetooth.getDevices();
      return list.map(found).filter((d): d is FoundDevice => d !== null);
    },

    async connect(target, onDisconnect, timeoutMs) {
      const device = devices.get(target.id);
      if (!device?.gatt) throw new Error('Device not available');
      const server = await withTimeout(device.gatt.connect(), timeoutMs, 'Connecting');
      device.addEventListener('gattserverdisconnected', () => onDisconnect(), { once: true });
      return gattTransport(server);
    },

    async disconnect(id) {
      devices.get(id)?.gatt?.disconnect();
    },
  };
}

function gattTransport(server: BluetoothRemoteGATTServer): BleTransport {
  const queue = serial();
  const chars = new Map<string, Promise<BluetoothRemoteGATTCharacteristic>>();
  const listeners = new Map<string, (e: Event) => void>();
  const char = (s: string, c: string) => {
    const key = `${s}/${c}`;
    let p = chars.get(key);
    if (!p) {
      p = server.getPrimaryService(s).then((svc) => svc.getCharacteristic(c));
      chars.set(key, p);
    }
    return p;
  };
  return {
    read: (s, c) => queue(async () => (await char(s, c)).readValue()),
    write: (s, c, v) => queue(async () => (await char(s, c)).writeValueWithResponse(v as DataView<ArrayBuffer>)),
    writeWithoutResponse: (s, c, v) => queue(async () => (await char(s, c)).writeValueWithoutResponse(v as DataView<ArrayBuffer>)),
    startNotifications: (s, c, cb) =>
      queue(async () => {
        const ch = await char(s, c);
        const listener = () => { if (ch.value) cb(ch.value); };
        listeners.set(`${s}/${c}`, listener);
        ch.addEventListener('characteristicvaluechanged', listener);
        await ch.startNotifications();
      }),
    stopNotifications: (s, c) =>
      queue(async () => {
        const ch = await char(s, c);
        const listener = listeners.get(`${s}/${c}`);
        if (listener) ch.removeEventListener('characteristicvaluechanged', listener);
        await ch.stopNotifications();
      }),
  };
}
