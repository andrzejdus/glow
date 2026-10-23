import { describe, expect, it } from 'vitest';
import { ble } from './ble/adapter';
import { conn } from './connection.svelte';
import type { DeviceDriver, DeviceState } from './devices/types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('fast taps on the target temperature', () => {
  it('send only the newest value and never jump back to a stale device report', async () => {
    const writes: number[] = [];
    let emit: (p: Partial<DeviceState>) => void = () => {};
    const slow: DeviceDriver = {
      kind: 'crafty',
      capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
      settingDefs: [],
      async start(onChange) {
        emit = onChange;
        onChange({ targetTemp: 180, currentTemp: 150, heaterOn: true });
      },
      async stop() {},
      async setTargetTemp(c) {
        writes.push(c);
        await wait(120); // a slow GATT write
      },
      async setHeater() {},
      async setMode() {},
      async setSetting() {},
    };
    const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
    await internals.attach({ id: 'x', name: 'STORZ&BICKEL', kind: 'crafty' }, slow, internals.generation);

    const seen: number[] = [];
    for (let i = 1; i <= 10; i++) {
      conn.setTarget(180 + i);
      emit({ targetTemp: 180 }); // the device still reports the old value
      seen.push(conn.device!.targetTemp!);
      await wait(60);
    }
    await wait(600);
    emit({ targetTemp: 190 });

    expect(seen).toEqual([181, 182, 183, 184, 185, 186, 187, 188, 189, 190]);
    expect(conn.device!.targetTemp).toBe(190);
    expect(writes.at(-1)).toBe(190);
    expect(writes.length).toBeLessThanOrEqual(4);
  });
});

describe('demo mode', () => {
  it('leaves the remembered device alone, so Connect goes to the real one afterwards', async () => {
    const real = { id: 'AA:BB', name: 'STORZ&BICKEL', kind: 'crafty' as const };
    conn.last = real;
    await conn.startDemo('venty');
    expect(conn.demo).toBe(true);
    expect(conn.last).toEqual(real);
    await conn.disconnect();
    expect(conn.target).toBeNull();
    expect(conn.last).toEqual(real);
  });
});

describe('searching for the remembered device', () => {
  it('does not show it as found while the direct connect is still waiting for it', async () => {
    const phases: string[] = [];
    const adapter = ble as unknown as Record<string, unknown>;
    const saved = { init: adapter.init, connect: adapter.connect, scan: adapter.scan, stopScan: adapter.stopScan };
    adapter.init = async () => {};
    adapter.connect = async () => {
      phases.push(conn.phase);
      await wait(50);
      throw new Error('out of range');
    };
    adapter.scan = async () => {
      phases.push(conn.phase);
    };
    adapter.stopScan = async () => {};
    try {
      conn.last = { id: 'AA:BB', name: 'STORZ&BICKEL', kind: 'crafty' };
      await conn.search();
      expect(phases).toEqual(['searching', 'searching']);
      expect(conn.phase).toBe('idle');
    } finally {
      Object.assign(adapter, saved);
    }
  });
});

describe('while the device reconnects', () => {
  it('refuses commands instead of showing a change the device never got', async () => {
    const calls: string[] = [];
    const driver: DeviceDriver = {
      kind: 'crafty',
      capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
      settingDefs: [],
      async start(onChange) {
        onChange({ targetTemp: 180, currentTemp: 150, heaterOn: false });
      },
      async stop() {},
      async setTargetTemp() { calls.push('target'); },
      async setHeater() { calls.push('heater'); },
      async setMode() {},
      async setSetting() {},
    };
    const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
    await internals.attach({ id: 'y', name: 'STORZ&BICKEL', kind: 'crafty' }, driver, internals.generation);
    conn.phase = 'reconnecting';
    conn.setHeater(true);
    conn.setTarget(190, true);
    await wait(50);
    expect(calls).toEqual([]);
    expect(conn.device).toMatchObject({ heaterOn: false, targetTemp: 180 });
    expect(conn.toast).toMatch(/Waiting for the device/);
    conn.phase = 'connected';
    conn.setHeater(true);
    await wait(50);
    expect(calls).toEqual(['heater']);
  });
});

describe('auto-off countdown', () => {
  it('counts down by itself between device reports and takes each new report', async () => {
    let emit: (p: Partial<DeviceState>) => void = () => {};
    const driver: DeviceDriver = {
      kind: 'crafty',
      capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
      settingDefs: [],
      async start(onChange) {
        emit = onChange;
        onChange({ heaterOn: true, autoShutoffRemainingSec: 120 });
      },
      async stop() {},
      async setTargetTemp() {},
      async setHeater() {},
      async setMode() {},
      async setSetting() {},
    };
    const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
    await internals.attach({ id: 'z', name: 'STORZ&BICKEL', kind: 'crafty' }, driver, internals.generation);
    const t0 = conn.autoOffAt;
    expect(conn.autoOffLeft(t0)).toBe(120);
    expect(conn.autoOffLeft(t0 + 3500)).toBe(117);
    expect(conn.autoOffLeft(t0 + 500_000)).toBe(0);
    emit({ autoShutoffRemainingSec: 110 });
    expect(conn.autoOffLeft(conn.autoOffAt + 1000)).toBe(109);
  });
});
