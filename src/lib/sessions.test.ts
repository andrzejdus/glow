import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceState } from './devices/types';
import { sessions } from './sessions.svelte';

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
    expect(s.spark.length).toBe(detail!.ts.filter((t) => t >= 0).length);
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
});
