import { describe, expect, it } from 'vitest';
import type { BleTransport } from '../ble/transport';
import { CRAFTY_UUIDS as U, crafty, parseFirmware } from './crafty';
import type { DeviceState } from './types';

type Op = { type: 'read' | 'write' | 'notify' | 'stop'; chr: string; data?: number[] };

const le16 = (v: number) => [v & 0xff, v >> 8];
const text = (s: string) => [...new TextEncoder().encode(s)];

class FakeTransport implements BleTransport {
  ops: Op[] = [];
  handlers = new Map<string, (v: DataView) => void>();
  values = new Map<string, number[]>();
  inFlight = 0;
  maxInFlight = 0;

  constructor(values: Record<string, number[]>) {
    for (const [k, v] of Object.entries(values)) this.values.set(k, v);
  }

  private async gatt<T>(fn: () => T): Promise<T> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, 0));
    this.inFlight--;
    return fn();
  }

  read(_s: string, chr: string) {
    return this.gatt(() => {
      this.ops.push({ type: 'read', chr });
      const v = this.values.get(chr);
      if (!v) throw new Error(`unexpected read ${chr}`);
      return new DataView(Uint8Array.from(v).buffer);
    });
  }
  write(_s: string, chr: string, value: DataView) {
    return this.gatt(() => {
      const data = [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
      this.ops.push({ type: 'write', chr, data });
      this.values.set(chr, data);
    });
  }
  writeWithoutResponse(s: string, chr: string, value: DataView) {
    return this.write(s, chr, value);
  }
  startNotifications(_s: string, chr: string, onValue: (v: DataView) => void) {
    return this.gatt(() => {
      this.ops.push({ type: 'notify', chr });
      this.handlers.set(chr, onValue);
    });
  }
  stopNotifications(_s: string, chr: string) {
    return this.gatt(() => {
      this.ops.push({ type: 'stop', chr });
      this.handlers.delete(chr);
    });
  }
  push(chr: string, data: number[]) {
    this.handlers.get(chr)!(new DataView(Uint8Array.from(data).buffer));
  }
  writes() {
    return this.ops.filter((o) => o.type === 'write').map((o) => [o.chr, o.data]);
  }
}

function craftyPlus(overrides: Record<string, number[]> = {}) {
  return new FakeTransport({
    [U.targetTemp]: le16(1800),
    [U.serial]: text('CP123456XX'),
    [U.currentTemp]: le16(1754),
    [U.boostOffset]: le16(150),
    [U.firmware]: text('V03.08'),
    [U.status2]: le16(0b0001_0000_0000_0010), // permanent BLE on, charge LED off
    [U.useHours]: le16(42),
    [U.useMinutes]: le16(17),
    [U.firmwareBle]: [1, 2, 3],
    [U.ledBrightness]: le16(70),
    [U.autoShutoff]: le16(120),
    [U.autoShutoffRemaining]: le16(95),
    [U.battery]: le16(83),
    [U.status]: le16(1 << 4 | 1 << 5), // heater active, boost
    ...overrides,
  });
}

async function started(t: FakeTransport) {
  const driver = crafty.create('crafty', t);
  const state: Partial<DeviceState> = {};
  await driver.start((p) => {
    Object.assign(state, p, p.settings ? { settings: { ...state.settings, ...p.settings } } : {});
  });
  t.ops = [];
  return { driver, state };
}

describe('crafty module', () => {
  it('identifies by advertised name', () => {
    expect(crafty.identify('STORZ&BICKEL')).toBe('crafty');
    expect(crafty.identify('Storz&Bickel')).toBe('crafty');
    expect(crafty.identify('S&B VOLCANO H')).toBeNull();
    expect(crafty.services).toContain('00000001-4c45-4b43-4942-265a524f5453');
  });

  it('parses firmware generations', () => {
    expect(parseFirmware('V02.50')).toMatchObject({ legacy: true, plus: false });
    expect(parseFirmware('V02.51')).toMatchObject({ legacy: false, plus: false });
    expect(parseFirmware('V03.08')).toMatchObject({ legacy: false, plus: true });
  });
});

describe('crafty driver', () => {
  it('decodes the initial reads into state', async () => {
    const t = craftyPlus();
    const { driver, state } = await started(t);
    expect(state).toMatchObject({
      kind: 'crafty',
      model: 'CRAFTY+',
      serial: 'CP123456',
      firmware: 'V03.08',
      firmwareBle: 'V1.2.3',
      targetTemp: 180,
      currentTemp: 175,
      boostOffset: 15,
      superBoostOffset: 30,
      operatingMinutes: 42 * 60 + 17,
      battery: 83,
      autoShutoffSec: 120,
      autoShutoffRemainingSec: 95,
      heaterOn: true,
      mode: 'boost',
      minTemp: 40,
      maxTemp: 210,
      settings: {
        vibration: true,
        chargeIndicator: false,
        permanentBluetooth: true,
        ledBrightness: 70,
        autoShutoff: 120,
      },
    });
    expect(driver.capabilities).toMatchObject({ heaterToggle: true, findMy: true, boost: true });
    expect(t.maxInFlight).toBe(1);
  });

  it('updates live from notifications', async () => {
    const t = craftyPlus();
    const { state } = await started(t);
    t.push(U.currentTemp, le16(1999));
    t.push(U.battery, le16(55));
    t.push(U.status, le16(1 << 6));
    t.push(U.status2, le16(0b0101)); // vibration off, temp reached
    t.push(U.autoShutoffRemaining, le16(12));
    expect(state).toMatchObject({
      currentTemp: 200,
      battery: 55,
      heaterOn: false,
      mode: 'superboost',
      autoShutoffRemainingSec: 12,
      settings: { vibration: false, chargeIndicator: true, permanentBluetooth: false },
    });
  });

  it('treats a target above 210 as °F', async () => {
    const { state } = await started(craftyPlus({ [U.targetTemp]: le16(3740) }));
    expect(state.targetTemp).toBe(190);
  });

  it('writes the target, then the boost offset', async () => {
    const t = craftyPlus();
    const { driver } = await started(t);
    await driver.setTargetTemp(200);
    expect(t.writes()).toEqual([
      [U.targetTemp, [0xd0, 0x07]], // 2000
      [U.boostOffset, [0x64, 0x00]], // boost clamped to 10 so 200 + 10 ≤ 210
    ]);
  });

  it('switches the heater with two characteristics', async () => {
    const t = craftyPlus();
    const { driver, state } = await started(t);
    await driver.setHeater(false);
    await driver.setHeater(true);
    expect(t.writes()).toEqual([
      [U.heaterOff, [0, 0]],
      [U.heaterOn, [0, 0]],
    ]);
    expect(state.heaterOn).toBe(true);
  });

  it('writes the boost offset and refuses to switch mode', async () => {
    const t = craftyPlus();
    const { driver, state } = await started(t);
    await driver.setBoostOffsets!(20);
    expect(t.writes()).toEqual([[U.boostOffset, [0xc8, 0x00]]]);
    expect(state.boostOffset).toBe(20);
    await expect(driver.setMode('boost')).resolves.toBeUndefined();
    await expect(driver.setMode('normal')).rejects.toThrow();
  });

  it('read-modify-writes status register 2 for toggles', async () => {
    const t = craftyPlus();
    const { driver, state } = await started(t);
    await driver.setSetting('vibration', false);
    expect(t.writes()).toEqual([[U.status2, [0x03, 0x10]]]);
    expect(t.ops.at(-1)).toEqual({ type: 'read', chr: U.status2 });
    expect(state.settings?.vibration).toBe(false);
  });

  it('unlocks the auto shutoff with the security code', async () => {
    const t = craftyPlus();
    const { driver, state } = await started(t);
    await driver.setSetting('autoShutoff', 250);
    expect(t.writes()).toEqual([
      [U.securityCode, [0x2f, 0x03]], // 815
      [U.autoShutoff, [0xf0, 0x00]], // 240 s
    ]);
    expect(state.autoShutoffSec).toBe(240);
  });

  it('sets the find-device bit once', async () => {
    const t = craftyPlus();
    const { driver } = await started(t);
    const done = Promise.all([driver.findMyDevice!(), driver.setSetting('ledBrightness', 40)]);
    await done;
    expect(t.writes()).toEqual([
      [U.status2, [0x0a, 0x10]],
      [U.ledBrightness, [40, 0]],
    ]);
    expect(t.maxInFlight).toBe(1);
    t.ops = [];
    await driver.findMyDevice!();
    expect(t.writes()).toEqual([]);
  });

  it('limits legacy firmware the way the official app does', async () => {
    const t = new FakeTransport({
      [U.targetTemp]: le16(1800),
      [U.serial]: text('CY000001'),
      [U.currentTemp]: le16(300),
      [U.boostOffset]: le16(100),
      [U.firmware]: text('V02.37'),
      [U.status2]: le16(0),
      [U.useHours]: le16(5),
      [U.ledBrightness]: le16(100),
      [U.battery]: le16(50),
      [U.status]: le16(0),
    });
    const { driver, state } = await started(t);
    expect(state.model).toBe('CRAFTY');
    expect(state.operatingMinutes).toBe(300);
    expect(state.firmwareBle).toBeUndefined();
    expect(driver.capabilities.heaterToggle).toBe(false);
    expect(driver.settingDefs.map((d) => d.key)).not.toContain('autoShutoff');
    await expect(driver.setHeater(true)).rejects.toThrow();
  });

  it('refreshes and stops', async () => {
    const t = craftyPlus();
    const { driver, state } = await started(t);
    t.values.set(U.useMinutes, le16(18));
    await driver.refresh!();
    expect(state.operatingMinutes).toBe(42 * 60 + 18);
    await driver.stop();
    expect(t.handlers.size).toBe(0);
  });
});
