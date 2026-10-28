import { describe, expect, it, vi } from 'vitest';
import { ble } from './ble/adapter';
import { conn } from './connection.svelte';
import { sessions } from './sessions.svelte';
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

  it('holds still while the device keeps reporting the same time, as a CRAFTY+ does while heating up', async () => {
    let emit: (p: Partial<DeviceState>) => void = () => {};
    const driver: DeviceDriver = {
      kind: 'crafty',
      capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
      settingDefs: [],
      async start(onChange) {
        emit = onChange;
        onChange({ heaterOn: true, autoShutoffRemainingSec: 0 });
      },
      async stop() {},
      async setTargetTemp() {},
      async setHeater() {},
      async setMode() {},
      async setSetting() {},
    };
    const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
    await internals.attach({ id: 'h', name: 'STORZ&BICKEL', kind: 'crafty' }, driver, internals.generation);
    emit({ autoShutoffRemainingSec: 210 });
    emit({ autoShutoffRemainingSec: 210 });
    expect(conn.autoOffLeft(conn.autoOffAt + 3500)).toBe(210);
    emit({ autoShutoffRemainingSec: 205 }); // ready: the timer runs
    expect(conn.autoOffLeft(conn.autoOffAt + 2000)).toBe(203);
  });

  it('counts a recorded CRAFTY+ session down without ticking back up', async () => {
    // 0071 (time left) and 0093 (status: 0x0415 heating, 0x0515 ready, 0x0400 off) as a CRAFTY+
    // V03.24 sent them, ms after the first one: holding 210 s while heating up, counting from Ready,
    // back to 210 when a draw cooled it below the target, then 0 at heater off.
    const session: [number, 'left' | 'status', number][] = [
      [0, 'left', 210],
      [2396, 'left', 210],
      [4992, 'left', 210],
      [7400, 'left', 210],
      [10001, 'left', 209],
      [11013, 'status', 1301],
      [12396, 'left', 207],
      [14999, 'left', 204],
      [17399, 'left', 202],
      [20002, 'left', 199],
      [22395, 'left', 196],
      [25009, 'left', 194],
      [27401, 'left', 191],
      [30011, 'left', 189],
      [32406, 'left', 186],
      [34998, 'left', 184],
      [37399, 'left', 181],
      [40006, 'left', 178],
      [42403, 'left', 176],
      [44999, 'left', 173],
      [47412, 'left', 171],
      [50009, 'left', 168],
      [52405, 'left', 165],
      [54998, 'left', 163],
      [57401, 'left', 160],
      [60000, 'left', 158],
      [62398, 'left', 155],
      [64999, 'left', 152],
      [67397, 'left', 150],
      [68405, 'status', 1045],
      [69996, 'left', 210],
      [72398, 'left', 210],
      [74999, 'left', 210],
      [76007, 'status', 1301],
      [77398, 'left', 207],
      [79998, 'left', 205],
      [82395, 'left', 202],
      [85010, 'left', 200],
      [87411, 'left', 197],
      [90001, 'left', 194],
      [92401, 'left', 192],
      [95006, 'left', 0],
      [96006, 'status', 1024],
    ];
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 86_400_000); // past any hold an earlier test left
      let emit: (p: Partial<DeviceState>) => void = () => {};
      const driver: DeviceDriver = {
        kind: 'crafty',
        capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
        settingDefs: [],
        async start(onChange) {
          emit = onChange;
          // Off, with the time left from the session before still on record.
          onChange({ heaterOn: false, autoShutoffSec: 210, autoShutoffRemainingSec: 157 });
        },
        async stop() {},
        async setTargetTemp() {},
        async setHeater() {},
        async setMode() {},
        async setSetting() {},
      };
      const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
      await internals.attach({ id: 's', name: 'STORZ&BICKEL', kind: 'crafty' }, driver, internals.generation);
      const t0 = Date.now();
      emit({ heaterOn: true }); // the heater comes on 2 s before the first report
      // What the dashboard shows: null for "–" (heater off, or 0 left).
      const shown = () => (conn.device!.heaterOn && conn.autoOffLeft(tick) ? conn.autoOffLeft(tick)! : null);
      let tick = t0;
      const seen: { at: number; left: number | null; restart: number }[] = [];
      const events = session.map(([at, kind, v]) => [at + 2000, kind, v] as const);
      // The dashboard's clock ticks once a second, out of step with the reports.
      for (let at = 0, i = 0; at <= events.at(-1)![0] + 2000; at += 100) {
        vi.setSystemTime(t0 + at);
        while (i < events.length && events[i][0] <= at) {
          const [, kind, v] = events[i++];
          if (kind === 'left') emit({ autoShutoffRemainingSec: v });
          else emit({ heaterOn: (v & 0x10) !== 0, tempReached: (v & 0x100) !== 0 });
          seen.push({ at, left: shown(), restart: conn.autoOffRestartAt });
        }
        if (at % 200 === 100) tick = t0 + at;
        seen.push({ at, left: shown(), restart: conn.autoOffRestartAt });
      }
      const ups = seen.filter((s, k) => k > 0 && s.left !== null && seen[k - 1].left !== null && s.left > seen[k - 1].left! && s.restart === seen[k - 1].restart);
      expect(ups).toEqual([]);
      // Nor skips a second, at Ready or while counting: each one stays up for a while.
      const changes = seen.filter((s, k) => k > 0 && s.left !== seen[k - 1].left);
      const skips = changes.filter((s, k) => k > 0 && s.left !== null && changes[k - 1].left !== null && s.restart === changes[k - 1].restart && (changes[k - 1].left! - s.left > 1 || s.at - changes[k - 1].at < 500));
      expect(skips).toEqual([]);
      // Never the last session's time, and nothing below 3:30 before the device counts.
      expect(seen.find((s) => s.left !== null)?.left).toBe(210);
      // One restart, at the draw, and "–" (null) straight after the 0 at heater off.
      expect(new Set(seen.map((s) => s.restart)).size).toBe(2);
      expect(seen.at(-1)!.left).toBeNull();
      expect(seen.filter((s) => s.left === 0)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notes when the device restarts its timer while heating, but not when the heater comes on', async () => {
    let emit: (p: Partial<DeviceState>) => void = () => {};
    const driver: DeviceDriver = {
      kind: 'crafty',
      capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
      settingDefs: [],
      async start(onChange) {
        emit = onChange;
        onChange({ heaterOn: false, autoShutoffRemainingSec: 0 });
      },
      async stop() {},
      async setTargetTemp() {},
      async setHeater() {},
      async setMode() {},
      async setSetting() {},
    };
    const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
    await internals.attach({ id: 'r', name: 'STORZ&BICKEL', kind: 'crafty' }, driver, internals.generation);
    (conn as unknown as { holds: Map<string, number> }).holds.clear(); // commands sent by earlier tests
    const before = conn.autoOffRestartAt;
    emit({ heaterOn: true, autoShutoffRemainingSec: 210 });
    emit({ autoShutoffRemainingSec: 172 });
    expect(conn.autoOffRestartAt).toBe(before);
    emit({ autoShutoffRemainingSec: 210 }); // a draw
    expect(conn.autoOffRestartAt).not.toBe(before);
  });

  it('does not count back up when reports arrive late', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2 * 86_400_000);
      let emit: (p: Partial<DeviceState>) => void = () => {};
      const driver: DeviceDriver = {
        kind: 'crafty',
        capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
        settingDefs: [],
        async start(onChange) {
          emit = onChange;
          onChange({ heaterOn: true, autoShutoffSec: 120, autoShutoffRemainingSec: 114 });
        },
        async stop() {},
        async setTargetTemp() {},
        async setHeater() {},
        async setMode() {},
        async setSetting() {},
      };
      const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
      await internals.attach({ id: 'l', name: 'STORZ&BICKEL', kind: 'crafty' }, driver, internals.generation);
      emit({ autoShutoffRemainingSec: 112 });
      const t0 = Date.now();
      vi.setSystemTime(t0 + 12_000); // then nothing for 12 s, and two reports from 7 s ago at once
      const before = conn.autoOffLeft(Date.now())!;
      emit({ autoShutoffRemainingSec: 109 });
      emit({ autoShutoffRemainingSec: 107 });
      expect(conn.autoOffLeft(Date.now())).toBeLessThanOrEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a cold start while the device heats', () => {
  it('feeds the session log only once the device has reported its heater', async () => {
    const observed: boolean[] = [];
    const spy = vi.spyOn(sessions, 'observe').mockImplementation((d) => void observed.push(d.heaterOn));
    const driver: DeviceDriver = {
      kind: 'venty',
      capabilities: { pump: false, battery: true, boost: true, superBoost: true, findMy: true, heaterToggle: true },
      settingDefs: [],
      async start(onChange) {
        // What a VENTY reports before its first status: model, serial, firmware.
        onChange({ kind: 'venty', model: 'VENTY', minTemp: 40, maxTemp: 210 });
        onChange({ serial: 'VY000000', firmware: 'V01.11' });
        onChange({ heaterOn: true, battery: 80 });
      },
      async stop() {},
      async setTargetTemp() {},
      async setHeater() {},
      async setMode() {},
      async setSetting() {},
    };
    const internals = conn as unknown as { attach: (...a: unknown[]) => Promise<void>; generation: number };
    await internals.attach({ id: 'v', name: 'S&B VY000000', kind: 'venty' }, driver, internals.generation);
    spy.mockRestore();
    expect(observed).toEqual([true]);
  });
});
