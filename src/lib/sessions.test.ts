import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceState } from './devices/types';
import { batteryPeak, energyOf } from './battery';
import { sessionStore } from './sessionStore';
import { addBattery, heatUpSec, readyAtOnce, sessions, type BatterySamples, type SessionSummary } from './sessions.svelte';

const state = (patch: Partial<DeviceState>): DeviceState => ({
  kind: 'crafty', model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: false,
  targetTemp: 180, boostOffset: 10, settings: {}, ...patch,
});

/** Feeds the device's state at a given second of the test; with `read`, a fresh voltage and current reading. */
const at = (sec: number, patch: Partial<DeviceState>, read = false) => {
  vi.setSystemTime(new Date(2026, 9, 24, 12, 0, sec));
  sessions.observe(state(patch), Date.now(), read);
};

describe('session log', () => {
  afterEach(() => vi.useRealTimers());

  it('records a session from heater on to off, with Ready, a boost and the settled target', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-1');
    at(0, { heaterOn: false, currentTemp: 30 });
    at(1, { heaterOn: true, currentTemp: 30, battery: 80 });
    at(40, { heaterOn: true, currentTemp: 179.6, tempReached: true, battery: 79 });
    at(60, { heaterOn: true, currentTemp: 181, tempReached: true, mode: 'boost' });
    at(61, { heaterOn: true, currentTemp: 181, mode: 'boost', targetTemp: 185 });
    at(62, { heaterOn: true, currentTemp: 181, mode: 'boost', targetTemp: 190 });
    at(70, { heaterOn: true, currentTemp: 199.5, mode: 'boost', targetTemp: 190, battery: 76 });
    at(100, { heaterOn: false, currentTemp: 190, battery: 75 });

    expect(sessions.active).toBeNull();
    const [s] = sessions.list;
    expect(s.end! - s.id).toBe(99_000);
    expect(s.joined).toBe(false);
    expect(s.app).toBe(__APP_VERSION__);
    expect(s.readySec).toBe(39);
    expect(s.target).toBe(180);
    expect(s.peak).toBe(199.5);
    expect(s.batteryStart).toBe(80);
    expect(s.batteryEnd).toBe(75);
    expect(s.modes.boost).toBeCloseTo(40, 0);

    const detail = await sessions.detail(s.id);
    // One target event where the steps settled, not one per step.
    expect(detail!.events.map((e) => e.k)).toEqual(['ready', 'mode', 'target']);
    expect(detail!.events[2]).toEqual({ t: 61, k: 'target', v: 190 });
    expect(detail!.ts.length).toBeGreaterThan(2);
    // The reading a second before the heater came on starts the chart, but not the timeline's line.
    expect(detail!.ts[0]).toBe(-1);
    expect(detail!.g[0]).toBeNull();
    // The timeline's points include it, marked as before the heater-on part.
    expect(s.spark.length).toBe(detail!.ts.length);
    expect(s.sparkOn).toEqual([1, detail!.ts.length - 1]);
  });

  it('saves a running session every 15 s, not only at its events', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-save');
    const saved = vi.spyOn(sessionStore, 'saveDetail');
    at(0, { heaterOn: false, currentTemp: 30 });
    at(1, { heaterOn: true, currentTemp: 30 });
    saved.mockClear();
    // A minute of steady heating, a report every second and the app's timers running.
    for (let sec = 2; sec <= 61; sec++) {
      at(sec, { heaterOn: true, currentTemp: 30 + sec * 2 });
      vi.advanceTimersByTime(1000);
    }
    expect(saved.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(saved.mock.calls.length).toBeLessThanOrEqual(5);
    saved.mockRestore();
    at(62, { heaterOn: false, currentTemp: 150 });
  });

  it('keeps the 10 s before the start and the cool-down after the end, to 50° or for 2 minutes', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-4');
    for (let sec = 0; sec <= 20; sec++) at(sec, { heaterOn: false, currentTemp: 30 + sec / 10 });
    at(21, { heaterOn: true, currentTemp: 32 });
    at(60, { heaterOn: true, currentTemp: 180 });
    at(61, { heaterOn: false, currentTemp: 180 });
    expect(sessions.cooling?.id).toBe(sessions.list[0].id);
    // Cooling 2.5° a second: 50° about 52 s after the end.
    for (let sec = 62; sec <= 200; sec++) at(sec, { heaterOn: false, currentTemp: Math.max(24, 180 - (sec - 61) * 2.5) });
    expect(sessions.cooling).toBeNull();
    const detail = (await sessions.detail(sessions.list[0].id))!;
    const before = detail.ts.filter((t) => t < 0);
    expect(Math.min(...before)).toBeGreaterThanOrEqual(-12);
    expect(before.length).toBeGreaterThanOrEqual(4);
    const after = detail.ts.filter((t) => t > 40);
    expect(detail.c[detail.c.length - 1]).toBeLessThanOrEqual(50);
    expect(after[after.length - 1]).toBeLessThanOrEqual(40 + 60);
    expect(detail.g.slice(-3)).toEqual([null, null, null]);
    // The timeline's points take in the cool-down once it is over.
    const s = sessions.list[0];
    expect(s.spark[s.spark.length - 1]).toBeLessThanOrEqual(50);
    expect(s.sparkOn![1]).toBeLessThan(s.spark.length - 1);
  });

  it('stops the cool-down after 2 minutes when it stays warm', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-5');
    at(0, { heaterOn: false, currentTemp: 30 });
    at(1, { heaterOn: true, currentTemp: 30 });
    at(30, { heaterOn: false, currentTemp: 180 });
    for (let sec = 31; sec <= 200; sec++) at(sec, { heaterOn: false, currentTemp: 150 });
    expect(sessions.cooling).toBeNull();
    const detail = (await sessions.detail(sessions.list[0].id))!;
    expect(detail.ts[detail.ts.length - 1]).toBeLessThanOrEqual(29 + 120);
    expect(detail.ts[detail.ts.length - 1]).toBeGreaterThan(29 + 110);
  });

  it('marks a session that was already heating when Glow connected', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-2');
    at(0, { heaterOn: true, currentTemp: 150 });
    expect(sessions.active?.joined).toBe(true);
  });

  it('carries on after a short drop, and ends it at the last sighting if the heater went off meanwhile', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-3');
    at(0, { heaterOn: false });
    at(1, { heaterOn: true, currentTemp: 100 });
    at(30, { heaterOn: true, currentTemp: 150 });
    sessions.lost();
    at(90, { heaterOn: true, currentTemp: 170 });
    await vi.waitFor(() => expect(sessions.active).not.toBeNull());
    expect(sessions.list).toHaveLength(1);
    at(120, { heaterOn: true, currentTemp: 175 });
    sessions.lost();
    // Back an hour later, heater off: it ended when Glow last saw it.
    vi.setSystemTime(new Date(2026, 9, 24, 13, 0, 0));
    sessions.observe(state({ heaterOn: false }));
    expect(sessions.active).toBeNull();
    expect(sessions.list).toHaveLength(1);
    expect(sessions.list[0].end! - sessions.list[0].id).toBe(119_000);
    const detail = await sessions.detail(sessions.list[0].id);
    expect(detail!.events.map((e) => e.k)).toEqual(['lost', 'back', 'lost']);
  });

  it('hands over to the background recorder unmarked, and marks a gap it did not see', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-6');
    at(0, { heaterOn: false });
    at(1, { heaterOn: true, currentTemp: 100 });
    at(30, { heaterOn: true, currentTemp: 150 });
    sessions.suspend();
    at(33, { heaterOn: true, currentTemp: 155 });
    await sessions.settled();
    expect(sessions.active?.id).toBe(sessions.list[0].id);
    at(40, { heaterOn: true, currentTemp: 160 });
    sessions.suspend();
    // The recorder came a minute late.
    at(100, { heaterOn: true, currentTemp: 170 });
    await sessions.settled();
    expect(sessions.list).toHaveLength(1);
    const detail = await sessions.detail(sessions.list[0].id);
    expect(detail!.events).toEqual([{ t: 39, k: 'lost' }, { t: 99, k: 'back' }]);
  });

  it('keeps each 2 s battery reading with the heater on and one every 30 s in the cool-down, with the capacity', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-7');
    const crafty = (sec: number) => ({
      battery: 80 - Math.floor(sec / 20), batteryVoltage: 3600 - sec * 2, batteryCurrent: sec < 60 ? -6000 : 0,
      batteryTemp: 28 + Math.floor(sec / 5) / 8, batteryCapacity: 2000 - Math.floor(sec / 2),
    });
    at(0, { heaterOn: false, currentTemp: 30, ...crafty(0) });
    // The temperature every second, voltage and current read every 2 s.
    for (let sec = 1; sec <= 60; sec++) at(sec, { heaterOn: true, currentTemp: Math.min(190, 30 + sec * 4), ...crafty(sec) }, sec % 2 === 0);
    for (let sec = 61; sec <= 190; sec++) at(sec, { heaterOn: false, currentTemp: 150, ...crafty(sec) });
    expect(sessions.cooling).toBeNull();
    const s = sessions.list[0];
    expect(s.capStart).toBe(2000);
    // To the end of the cool-down: COOL_MS (2 minutes) after heater off at 61 s.
    expect(s.capEnd).toBe(2000 - Math.floor(180 / 2));
    const b = (await sessions.detail(s.id))!.battery!;
    // Seconds from heater on at 1 s: the readings at 2, 4 … 60 s.
    const on = b.ts.filter((t) => t <= 60);
    expect(on).toEqual(Array.from({ length: 30 }, (_, k) => 1 + k * 2));
    // After heater off, one every 30 s.
    expect(b.ts.filter((t) => t > 60)).toEqual([90, 120, 150, 180]);
    for (const list of [b.p, b.v, b.i, b.t]) expect(list).toHaveLength(b.ts.length);
    // Each reading as it was, not a mean; the battery % and temperature as they stood then.
    expect(b.v!.slice(0, 3)).toEqual([3596, 3592, 3588]);
    expect(b.i![0]).toBe(-6000);
    expect(b.t!.slice(0, 3)).toEqual([280, 280, 281]);
    expect(b.p[0]).toBe(80);
    expect(b.w).toBeUndefined();
    expect(b.min).toBeUndefined();
  });

  it('keeps nothing from reports without a reading, and starts afresh on the next heat-up', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-10');
    const crafty = (heaterOn: boolean, i: number) => ({ heaterOn, currentTemp: 180, battery: 80, batteryVoltage: i ? 3100 : 3550, batteryCurrent: i });
    at(0, crafty(false, 0));
    // On at 1 s with a reading; -8 A read every 2 s; 0 A at 12 s, off at 13 s. The temperature
    // reports in between say nothing new about the battery.
    at(1, crafty(true, 0), true);
    for (let sec = 2; sec <= 11; sec++) at(sec, crafty(true, -8000), sec % 2 === 0);
    at(12, crafty(true, 0), true);
    at(13, crafty(false, 0));
    for (let sec = 14; sec <= 50; sec++) at(sec, { ...crafty(false, 0), currentTemp: 180 - sec });
    const b = (await sessions.detail(sessions.list[0].id))!.battery!;
    // The readings, then the cool-down 30 s after heater off; nothing at the 5 s samples or at off.
    expect(b.ts).toEqual([0, 1, 3, 5, 7, 9, 11, 42]);
    expect(b.i).toEqual([0, -8000, -8000, -8000, -8000, -8000, 0, 0]);
    expect(batteryPeak(b, 'power')).toBeCloseTo(24.8, 6);
    // 3.1 V × 8 A from 1 to 9 s, and on the way up and down in the two seconds around them.
    expect(energyOf(b)!.wh * 3600).toBeCloseTo(24.8 / 2 + 24.8 * 8 + 24.8, 6);

    // Back on: nothing held over from the last heat-up.
    at(60, crafty(true, -5000), true);
    at(62, crafty(true, -5000));
    at(66, crafty(true, -5000), true);
    expect(sessions.activeDetail!.battery!.ts).toEqual([0, 6]);
  });

  it('carries on a session from 0.1.77–0.1.79 with single readings after its 5 s means', () => {
    const old: BatterySamples = { ts: [0, 5], p: [80, 80], v: [3500, 3300], i: [0, -4000], w: [null, -13_000], min: { i: -8069, w: -25_000 } };
    const b = addBattery(old, 7, state({ heaterOn: true, battery: 79, batteryVoltage: 3100, batteryCurrent: -8000 }))!;
    expect(b.ts).toEqual([0, 5, 7]);
    expect(b.w).toEqual([null, -13_000, null]);
    expect(b.min).toEqual(old.min);
    // The mean covers 0–5 s, the trapezoid rule 5–7 s.
    expect(energyOf(b)!.wh * 3600).toBeCloseTo(13 * 5 + ((13.2 + 24.8) / 2) * 2, 6);
    expect(batteryPeak(b, 'current')).toBeCloseTo(8.069, 6);
  });

  it('adds up a pulsing heater current from 2 s readings far closer than from 5 s ones', async () => {
    // Made up, like a CRAFTY+ (seen in a 0.1.76 session's 5 s readings): -8 A at ~3.1 V for the first
    // 60 s, then holding, the current switching between 0 and -8 A (3.55 V) at unknown times: here
    // every 0.5–4 s at random. Glow reads voltage and current every 2 s, the temperature comes every
    // second; the 5 s readings it kept before are taken from the same current.
    vi.useFakeTimers();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const errors = { old: [] as number[], now: [] as number[] };
    for (let run = 0; run < 20; run++) {
      const edges: number[] = [];
      for (let t = 60 + rnd() * 2; t < 400; t += 0.5 + rnd() * 3.5) edges.push(t);
      const on = (sec: number) => sec < 60 || edges.filter((e) => e <= sec).length % 2 === 0;
      const amps = (sec: number) => (on(sec) ? -8000 : 0);
      const volts = (sec: number) => (on(sec) ? 3100 : 3550);
      const end = 211; // heater on 1…211 s
      let truth = 0;
      for (let t = 1; t < end; t += 0.001) truth += (-volts(t) * amps(t)) / 1e6 * 0.001;
      await sessions.bind(`pulse-${run}`);
      let read = { v: volts(0), i: 0 };
      at(0, { heaterOn: false, currentTemp: 30, battery: 80, batteryVoltage: read.v, batteryCurrent: read.i });
      for (let sec = 1; sec <= end; sec++) {
        if (sec % 2 === 0) read = { v: volts(sec), i: amps(sec) };
        at(sec, { heaterOn: sec < end, currentTemp: 180, battery: 80, batteryVoltage: read.v, batteryCurrent: read.i }, sec % 2 === 0);
      }
      const b = (await sessions.detail(sessions.list[0].id))!.battery!;
      // Seconds from heater on at 1 s; up to heater off, without the cool-down.
      const heating = (x: BatterySamples) => ({ ...x, ts: x.ts.filter((t) => t <= end - 1) });
      const five = Array.from({ length: Math.floor((end - 1) / 5) + 1 }, (_, k) => k * 5);
      const old: BatterySamples = { ts: five, p: five.map(() => 80), v: five.map((t) => volts(t + 1)), i: five.map((t) => amps(t + 1)) };
      const wh = (x: BatterySamples) => energyOf(heating(x))!.wh * 3600;
      errors.old.push(Math.abs(wh(old) - truth) / truth);
      errors.now.push(Math.abs(wh(b) - truth) / truth);
      // Every reading is there: the peak is the heater's full draw.
      expect(batteryPeak(b, 'current')).toBe(8);
    }
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    // About 9 % off on average from 5 s readings here (up to 30 % in one run), under 4 % from each 2 s one.
    expect(mean(errors.now)).toBeLessThan(0.05);
    expect(mean(errors.now)).toBeLessThan(mean(errors.old) / 2);
  });

  it('keeps only the percentage on a VENTY, and nothing on a VOLCANO', async () => {
    vi.useFakeTimers();
    await sessions.bind('log-8');
    at(0, { kind: 'venty', heaterOn: false, battery: 60 });
    for (let sec = 1; sec <= 20; sec++) at(sec, { kind: 'venty', heaterOn: true, battery: 60 });
    at(21, { kind: 'venty', heaterOn: false, battery: 59 });
    const b = (await sessions.detail(sessions.list[0].id))!.battery!;
    expect(b.p.every((p) => p === 60 || p === 59)).toBe(true);
    expect(b.v ?? b.i ?? b.t).toBeUndefined();

    await sessions.bind('log-9');
    at(0, { kind: 'volcano', heaterOn: false, currentTemp: 30 });
    for (let sec = 1; sec <= 20; sec++) at(sec, { kind: 'volcano', heaterOn: true, currentTemp: 100 });
    expect(sessions.activeDetail?.battery).toBeUndefined();
  });
});

describe('ready time', () => {
  const base: SessionSummary = { id: 1, end: 2, seen: 2, joined: false, readySec: 19, target: 199, peak: null, modes: {}, live: false, spark: [] };

  it('counts a heat-up only when Glow saw it from the start and it took time', () => {
    expect(heatUpSec(base)).toBe(19);
    expect(heatUpSec({ ...base, joined: true })).toBeNull();
    expect(heatUpSec({ ...base, readySec: null })).toBeNull();
    // VENTY switched off and back on while still hot: Ready at the first reading.
    expect(heatUpSec({ ...base, readySec: 0 })).toBeNull();
  });

  it('calls a session Ready at heater on "ready at once"', () => {
    expect(readyAtOnce({ ...base, readySec: 0 })).toBe(true);
    expect(readyAtOnce({ ...base, readySec: 0, joined: true })).toBe(false);
    expect(readyAtOnce(base)).toBe(false);
  });
});
