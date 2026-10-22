import { describe, expect, it } from 'vitest';
import type { BleTransport } from '../ble/transport';
import type { DeviceState } from './types';
import { CMD, GAP_DEVICE_NAME, QVAP_CONTROL, QvapDriver, qvap, type QvapKind } from './qvap';

type Responder = (written: Uint8Array) => number[][];

class FakeTransport implements BleTransport {
  writes: number[][] = [];
  inFlight = 0;
  maxInFlight = 0;
  private listener: ((value: DataView) => void) | undefined;

  constructor(
    private readonly respond: Responder,
    private readonly gapName = 'S&B VY123456',
  ) {}

  async read(_service: string, characteristic: string): Promise<DataView> {
    if (characteristic !== GAP_DEVICE_NAME) throw new Error('not readable');
    return new DataView(new TextEncoder().encode(this.gapName).buffer);
  }

  async write(_service: string, characteristic: string, value: DataView): Promise<void> {
    expect(characteristic).toBe(QVAP_CONTROL);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const written = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    this.writes.push([...written]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.inFlight--;
    for (const reply of this.respond(written)) this.notify(reply);
  }

  async writeWithoutResponse(service: string, characteristic: string, value: DataView): Promise<void> {
    await this.write(service, characteristic, value);
  }

  async startNotifications(
    _service: string,
    _characteristic: string,
    onValue: (value: DataView) => void,
  ): Promise<void> {
    this.listener = onValue;
  }

  async stopNotifications(): Promise<void> {
    this.listener = undefined;
  }

  notify(values: number[]): void {
    this.listener?.(new DataView(Uint8Array.from(values).buffer));
  }

  lastWrite(): number[] {
    return this.writes[this.writes.length - 1];
  }
}

function pad(values: number[], length = 20): number[] {
  return [...values, ...new Array<number>(Math.max(0, length - values.length)).fill(0)];
}

function ascii(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

// Venty, 182.5 °C measured, target 185 °C, boost +10, superboost +15,
// battery 76 %, 87 s to auto-off, boost mode, charging, °F on the display,
// charge limit on, boost visualization bit set, settings2 = permanent BT.
const STATUS = pad([
  0x01, 0x00, 0x21, 0x07, 0x3a, 0x07, 10, 15, 76, 87, 0, 2, 0, 1,
  0x01 | 0x02 | 0x20 | 0x40, 0x00, 0x01, 0x00,
]);
const FIRMWARE = pad([0x02, 0x01, ...ascii('V01.09'), 0, 0, 0, ...ascii('V00.05')]);
const USAGE = pad([0x04, 0x2c, 0x01, 0x00, 0x10, 0x00, 0x00]);
const IDENTITY = pad([0x05, 0, 0, 0, 0, 0, 0, 0, 0, ...ascii('654321'), ...ascii('VY'), 0, 2]);
const UI = [0x06, 0x00, 7, 0, 0, 1, 1];

function deviceResponder(status = STATUS, firmware = FIRMWARE): Responder {
  return (written) => {
    switch (written[0]) {
      case CMD.status:
        return [status];
      case CMD.firmware:
        return [firmware];
      case CMD.usage:
        return [USAGE];
      case CMD.identity:
        return [IDENTITY];
      case CMD.ui:
        return [UI];
      case CMD.advertising:
        return [pad([0x1d, 0x00])];
      default:
        return [];
    }
  };
}

async function connect(kind: QvapKind = 'venty', responder = deviceResponder()) {
  const transport = new FakeTransport(responder);
  const driver = new QvapDriver(kind, transport, { pollIntervalMs: 0, firmwareTimeoutMs: 200 });
  const state: Partial<DeviceState> & { settings: Record<string, boolean | number> } = { settings: {} };
  await driver.start((patch) => {
    const { settings, ...rest } = patch;
    Object.assign(state, rest);
    if (settings) Object.assign(state.settings, settings);
  });
  return { transport, driver, state };
}

describe('qvap module', () => {
  it('identifies VENTY and VEAZY by advertised name', () => {
    expect(qvap.identify('S&B VY123456')).toBe('venty');
    expect(qvap.identify('s&b vz000111')).toBe('veazy');
    expect(qvap.identify('S&B VOLCANO H')).toBeNull();
    expect(qvap.identify('STORZ&BICKEL')).toBeNull();
  });
});

describe('qvap decoding', () => {
  it('decodes the connect replies into state', async () => {
    const { state, transport, driver } = await connect();
    expect(transport.writes.map((w) => w[0])).toEqual([0x02, 0x1d, 0x01, 0x04, 0x05, 0x06]);
    expect(state).toMatchObject({
      model: 'VENTY',
      serial: 'VY654321',
      firmware: 'V01.09',
      firmwareBle: 'V00.05',
      currentTemp: 182.5,
      targetTemp: 185,
      boostOffset: 10,
      superBoostOffset: 15,
      battery: 76,
      charging: true,
      heaterOn: true,
      mode: 'boost',
      autoShutoffRemainingSec: 87,
      unit: 'F',
      operatingMinutes: 300,
      minTemp: 40,
      maxTemp: 210,
    });
    expect(state.settings).toEqual({
      chargeOptimization: false,
      chargeLimit: true,
      boostVisualization: true,
      fahrenheit: true,
      brightness: 7,
      vibration: true,
      permanentBoost: true,
    });
    expect(driver.settingDefs.map((d) => d.key)).not.toContain('permanentBluetooth');
    await driver.stop();
  });

  it('inverts boost visualization and reads permanent Bluetooth on a VEAZY', async () => {
    const { state, driver } = await connect('veazy');
    expect(state.model).toBe('VEAZY');
    expect(state.settings.boostVisualization).toBe(false);
    expect(state.settings.permanentBluetooth).toBe(true);
    expect(driver.settingDefs.map((d) => d.key)).toContain('permanentBluetooth');
    await driver.stop();
  });

  it('reports heater off and normal mode when byte 11 is 0', async () => {
    const off = [...STATUS];
    off[11] = 0;
    const { state, driver } = await connect('venty', deviceResponder(off));
    expect(state.heaterOn).toBe(false);
    expect(state.mode).toBe('normal');
    await driver.stop();
  });

  it('drops permanent boost on Venty firmware before x.08', async () => {
    const old = pad([0x02, 0x01, ...ascii('V01.07'), 0, 0, 0, ...ascii('V00.05')]);
    const { driver } = await connect('venty', deviceResponder(STATUS, old));
    expect(driver.settingDefs.map((d) => d.key)).not.toContain('permanentBoost');
    await driver.stop();
  });

  it('refuses to control a device sitting in its bootloader', async () => {
    const bootloader = pad([0x02, 0x00, ...ascii('V01.09'), 0, 0, 0, ...ascii('V00.05')]);
    const transport = new FakeTransport(deviceResponder(STATUS, bootloader));
    const driver = new QvapDriver('venty', transport, { pollIntervalMs: 0 });
    await expect(driver.start(() => {})).rejects.toThrow(/firmware update mode/);
    expect(transport.writes.map((w) => w[0])).toEqual([0x02]);
  });
});

describe('qvap writes', () => {
  it('setTargetTemp writes °C x10 little-endian with the target mask', async () => {
    const { transport, driver } = await connect();
    await driver.setTargetTemp(185);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x02, 0, 0, 0x3a, 0x07]));
    await driver.setTargetTemp(250);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x02, 0, 0, 0x34, 0x08]));
    await driver.stop();
  });

  it('setHeater writes byte 11 with the heater mask', async () => {
    const { transport, driver } = await connect();
    await driver.setHeater(true);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    await driver.setHeater(false);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x20]));
    await driver.stop();
  });

  it('setMode writes the heater mode code, and nothing while the heater is off', async () => {
    const { transport, driver } = await connect();
    await driver.setMode('superboost');
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]));
    await driver.setMode('normal');
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
    await driver.stop();

    const off = [...STATUS];
    off[11] = 0;
    const idle = await connect('venty', deviceResponder(off));
    const before = idle.transport.writes.length;
    await idle.driver.setMode('boost');
    expect(idle.transport.writes.length).toBe(before);
    await idle.driver.stop();
  });

  it('setBoostOffsets writes boost and superboost separately', async () => {
    const { transport, driver } = await connect();
    await driver.setBoostOffsets(12, 20);
    expect(transport.writes.slice(-2)).toEqual([
      pad([0x01, 0x04, 0, 0, 0, 0, 12]),
      pad([0x01, 0x08, 0, 0, 0, 0, 0, 20]),
    ]);
    await driver.stop();
  });

  it('a toggle setting is a masked write of settings byte 14', async () => {
    const { transport, driver } = await connect();
    await driver.setSetting('chargeOptimization', true);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x80, ...new Array(12).fill(0), 0x08, 0x08]));
    await driver.setSetting('chargeOptimization', false);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x80, ...new Array(12).fill(0), 0x00, 0x08]));
    await driver.stop();
  });

  it('permanent Bluetooth on a VEAZY is a masked write of settings2 byte 16', async () => {
    const { transport, driver } = await connect('veazy');
    await driver.setSetting('permanentBluetooth', true);
    expect(transport.lastWrite()).toEqual(pad([0x01, 0x80, ...new Array(14).fill(0), 0x01, 0x01]));
    await driver.stop();
  });

  it('brightness (range) is a 7-byte 0x06 write, clamped to 1-9, then re-read', async () => {
    const { transport, driver } = await connect();
    await driver.setSetting('brightness', 5);
    expect(transport.writes.slice(-2)).toEqual([
      [0x06, 0x01, 5, 0, 0, 0, 0],
      [0x06, 0x00, 0, 0, 0, 0, 0],
    ]);
    await driver.setSetting('brightness', 0);
    expect(transport.writes[transport.writes.length - 2]).toEqual([0x06, 0x01, 1, 0, 0, 0, 0]);
    await driver.stop();
  });

  it('find my device sends 0x0D 0x01', async () => {
    const { transport, driver } = await connect();
    await driver.findMyDevice();
    expect(transport.lastWrite()).toEqual(pad([0x0d, 0x01]));
    await driver.stop();
  });

  it('serializes concurrent operations', async () => {
    const { transport, driver } = await connect();
    await Promise.all([
      driver.setTargetTemp(190),
      driver.setHeater(true),
      driver.setSetting('vibration', false),
      driver.refresh(),
    ]);
    expect(transport.maxInFlight).toBe(1);
    await driver.stop();
  });

  it('keeps a just-written target against a stale poll reply', async () => {
    const { transport, driver, state } = await connect();
    await driver.setTargetTemp(200);
    // The fake device still answers with 185 °C, as a poll racing the write would.
    transport.notify(STATUS);
    expect(state.targetTemp).toBe(200);
    await driver.stop();
  });
});
