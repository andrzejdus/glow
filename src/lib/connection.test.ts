import { describe, expect, it } from 'vitest';
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
