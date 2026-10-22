import { describe, expect, it } from 'vitest';
import { bytes, type BleTransport } from '../ble/transport';
import type { DeviceState } from './types';
import { VOLCANO_CHAR as CH, volcano, volcanoWorkflows } from './volcano';

type Op = { op: 'read' | 'write' | 'notify' | 'unnotify'; char: string; value?: number[] };

const ascii = (s: string) => bytes(...Array.from(s, (c) => c.charCodeAt(0)));

class FakeTransport implements BleTransport {
  ops: Op[] = [];
  values = new Map<string, DataView>();
  listeners = new Map<string, (v: DataView) => void>();
  inFlight = 0;
  maxInFlight = 0;

  private async track<T>(fn: () => T): Promise<T> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, 1));
    this.inFlight--;
    return fn();
  }

  read(_s: string, c: string) {
    return this.track(() => {
      this.ops.push({ op: 'read', char: c });
      return this.values.get(c) ?? bytes(0, 0, 0, 0);
    });
  }
  write(_s: string, c: string, v: DataView) {
    return this.track(() => {
      this.ops.push({ op: 'write', char: c, value: Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) });
    });
  }
  writeWithoutResponse(s: string, c: string, v: DataView) {
    return this.write(s, c, v);
  }
  startNotifications(_s: string, c: string, cb: (v: DataView) => void) {
    return this.track(() => {
      this.ops.push({ op: 'notify', char: c });
      this.listeners.set(c, cb);
    });
  }
  stopNotifications(_s: string, c: string) {
    return this.track(() => {
      this.ops.push({ op: 'unnotify', char: c });
      this.listeners.delete(c);
    });
  }
  push(c: string, v: DataView) {
    this.listeners.get(c)?.(v);
  }
  writes() {
    return this.ops.filter((o) => o.op === 'write');
  }
}

async function connected() {
  const t = new FakeTransport();
  t.values.set(CH.register1, bytes(0x20, 0x22, 0, 0)); // heater + pump + auto-shutoff active
  t.values.set(CH.register2, bytes(0x00, 0x00, 0, 0)); // °C, display on cooling on
  t.values.set(CH.register3, bytes(0x00, 0x04, 0, 0)); // vibration off
  t.values.set(CH.targetTemp, bytes(0x3a, 0x07, 0, 0)); // 1850
  t.values.set(CH.currentTemp, bytes(0x0b, 0x07, 0, 0)); // 1803
  t.values.set(CH.serial, ascii('ABC12345XYZ'));
  t.values.set(CH.firmware, ascii('V01.04.01.00'));
  t.values.set(CH.firmwareBle, ascii('V01.10\0'));
  t.values.set(CH.autoShutoffRemaining, bytes(0x2c, 0x01)); // 300 s
  t.values.set(CH.autoShutoffTime, bytes(0x08, 0x07)); // 1800 s
  t.values.set(CH.ledBrightness, bytes(70, 0));
  t.values.set(CH.hours, bytes(12, 0));
  t.values.set(CH.minutes, bytes(34, 0));
  const driver = volcano.create('volcano', t);
  let state = {} as DeviceState;
  await driver.start((p) => (state = { ...state, ...p }));
  return { t, driver, state: () => state };
}

describe('volcano module', () => {
  it('identifies by name', () => {
    expect(volcano.identify('S&B VOLCANO H')).toBe('volcano');
    expect(volcano.identify('s&b volcano')).toBe('volcano');
    expect(volcano.identify('S&B VY 1234')).toBeNull();
  });
});

describe('volcano driver', () => {
  it('decodes the initial state', async () => {
    const { t, state } = await connected();
    expect(state()).toMatchObject({
      kind: 'volcano',
      model: 'VOLCANO HYBRID',
      minTemp: 40,
      maxTemp: 230,
      targetTemp: 185,
      currentTemp: 180,
      heaterOn: true,
      pumpOn: true,
      serial: 'ABC12345',
      firmware: 'V01.04.0',
      firmwareBle: 'V01.10',
      operatingMinutes: 12 * 60 + 34,
      autoShutoffSec: 1800,
      autoShutoffRemainingSec: 300,
      unit: 'C',
      settings: { vibration: false, displayOnCooling: true, fahrenheit: false, ledBrightness: 70, autoShutoff: 30 },
    });
    expect(t.maxInFlight).toBe(1);
  });

  it('applies notifications', async () => {
    const { t, state } = await connected();
    t.push(CH.currentTemp, bytes(0x52, 0x07)); // 1874 → 187
    expect(state().currentTemp).toBe(187);
    t.push(CH.currentTemp, bytes(0xff, 0xff)); // no reading
    expect(state().currentTemp).toBe(187);
    t.push(CH.register1, bytes(0x00, 0x00, 0, 0));
    expect(state()).toMatchObject({ heaterOn: false, pumpOn: false, autoShutoffRemainingSec: undefined });
    t.push(CH.register2, bytes(0x00, 0x12, 0, 0));
    expect(state().unit).toBe('F');
    expect(state().settings).toMatchObject({ fahrenheit: true, displayOnCooling: false });
    t.push(CH.minutes, bytes(35, 0));
    expect(state().operatingMinutes).toBe(12 * 60 + 35);
  });

  it('writes the exact command bytes', async () => {
    const { t, driver } = await connected();
    t.ops = [];
    await driver.setTargetTemp(185);
    await driver.setHeater(true);
    await driver.setHeater(false);
    await driver.setPump!(true);
    await driver.setPump!(false);
    await driver.setSetting('vibration', true);
    await driver.setSetting('vibration', false);
    await driver.setSetting('displayOnCooling', false);
    await driver.setSetting('fahrenheit', true);
    await driver.setSetting('ledBrightness', 40);
    await driver.setSetting('autoShutoff', 60);
    expect(t.writes()).toEqual([
      { op: 'write', char: CH.targetTemp, value: [0x3a, 0x07, 0x00, 0x00] },
      { op: 'write', char: CH.heaterOn, value: [0x00] },
      { op: 'write', char: CH.heaterOff, value: [0x00] },
      { op: 'write', char: CH.pumpOn, value: [0x00] },
      { op: 'write', char: CH.pumpOff, value: [0x00] },
      { op: 'write', char: CH.register3, value: [0x00, 0x04, 0x00, 0x00] },
      { op: 'write', char: CH.register3, value: [0x00, 0x04, 0x01, 0x00] },
      { op: 'write', char: CH.register2, value: [0x00, 0x10, 0x01, 0x00] },
      { op: 'write', char: CH.register2, value: [0x00, 0x02, 0x01, 0x00] },
      { op: 'write', char: CH.ledBrightness, value: [40, 0x00] },
      { op: 'write', char: CH.autoShutoffTime, value: [0x10, 0x0e] },
    ]);
  });

  it('clamps the target temperature', async () => {
    const { t, driver } = await connected();
    t.ops = [];
    await driver.setTargetTemp(250);
    expect(t.writes()[0].value).toEqual([0xfc, 0x08, 0x00, 0x00]); // 2300
  });

  it('serializes concurrent operations', async () => {
    const { t, driver } = await connected();
    t.maxInFlight = 0;
    await Promise.all([driver.setTargetTemp(200), driver.setHeater(true), driver.setPump!(true), driver.refresh!()]);
    expect(t.maxInFlight).toBe(1);
  });

  it('unsubscribes on stop', async () => {
    const { t, driver } = await connected();
    await driver.stop();
    expect(t.listeners.size).toBe(0);
  });
});

describe('volcano workflows', () => {
  it('matches the official Flow 1', () => {
    const flow1 = volcanoWorkflows.find((w) => w.id === 'flow1')!;
    expect(flow1.steps.slice(0, 3)).toEqual([
      { kind: 'heat', celsius: 182 },
      { kind: 'hold', seconds: 10 },
      { kind: 'pump', seconds: 10 },
    ]);
    expect(flow1.steps).toHaveLength(12);
  });

  it('Balloon heats 170–220 °C in 5 °C steps with 5 s of pump each', () => {
    const balloon = volcanoWorkflows.find((w) => w.id === 'balloon')!;
    const heats = balloon.steps.filter((s) => s.kind === 'heat').map((s) => (s.kind === 'heat' ? s.celsius : 0));
    expect(heats).toEqual([170, 175, 180, 185, 190, 195, 200, 205, 210, 215, 220]);
    expect(balloon.steps.filter((s) => s.kind === 'hold')).toHaveLength(0);
    expect(balloon.steps.filter((s) => s.kind === 'pump').every((s) => s.seconds === 5)).toBe(true);
  });
});
