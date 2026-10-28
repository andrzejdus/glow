import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceState } from './devices/types';
import { heatUpSec, readyAtOnce, sessions, type SessionSummary } from './sessions.svelte';

const state = (patch: Partial<DeviceState>): DeviceState => ({
  kind: 'crafty', model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: false,
  targetTemp: 180, boostOffset: 10, settings: {}, ...patch,
});

/** Feeds the device's state at a given second of the test. */
const at = (sec: number, patch: Partial<DeviceState>) => {
  vi.setSystemTime(new Date(2026, 9, 24, 12, 0, sec));
  sessions.observe(state(patch));
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
