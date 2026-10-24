import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceState } from './devices/types';
import { estimate, fromHistory, heatUpOf, leftAt, ready, type HeatUp } from './ready.svelte';
import { sessions, type SessionDetail, type SessionSummary } from './sessions.svelte';

/** A heat-up from `from`° to `goal`°: 3° a second, then 0.6° a second over the last 15°. */
const tempAt = (t: number, from: number, goal: number, speed = 1) => {
  const fast = (goal - 15 - from) / 3 / speed;
  return t <= fast ? from + 3 * speed * t : Math.min(goal, goal - 15 + 0.6 * speed * (t - fast));
};
const readyAt = (from: number, goal: number, speed = 1) => (goal - 15 - from) / 3 / speed + 15 / 0.6 / speed + 4;

/** A past session as the recorder keeps it: 5 s samples, Ready ~4 s after reaching the goal. */
function past(id: number, from: number, goal: number, speed = 1): { s: SessionSummary; detail: SessionDetail } {
  const readySec = Math.round(readyAt(from, goal, speed));
  const detail: SessionDetail = { ts: [-4, -2], c: [from, from], g: [null, null], events: [{ t: readySec, k: 'ready' }] };
  for (let t = 0; t <= readySec + 60; t += 5) {
    detail.ts.push(t);
    detail.c.push(tempAt(t, from, goal, speed));
    detail.g.push(goal);
  }
  const s: SessionSummary = {
    id, end: id + (readySec + 60) * 1000, seen: id + (readySec + 60) * 1000, joined: false, readySec,
    target: goal, peak: goal, modes: { normal: readySec + 60 }, live: true, spark: [],
  };
  return { s, detail };
}

const state = (patch: Partial<DeviceState>): DeviceState => ({
  kind: 'crafty', model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: false,
  targetTemp: 180, boostOffset: 15, superBoostOffset: 15, settings: {}, ...patch,
});

const T0 = new Date(2026, 9, 24, 12, 0, 0).getTime();
/** The device's state at `sec` seconds into the test, as conn.apply passes it on. */
const at = (sec: number, patch: Partial<DeviceState>) => {
  vi.setSystemTime(T0 + sec * 1000);
  const d = state(patch);
  sessions.observe(d);
  ready.observe(d);
};
const leftNow = () => ready.left(Date.now());

async function seed(key: string, list: { s: SessionSummary; detail: SessionDetail }[]) {
  await sessions.bind(key, { list: list.map((x) => x.s), details: new Map(list.map((x) => [x.s.id, x.detail])) });
}

describe('heat-up curves', () => {
  const { s, detail } = past(1, 25, 180);
  const h = heatUpOf(s, detail)!;

  it('read the seconds left at any number of degrees below the goal', () => {
    // 155° to go at the start, Ready at 76 s.
    expect(s.readySec).toBe(76);
    expect(leftAt(h, 155)).toBeCloseTo(76, 0);
    // 15° below the goal at ~43 s: 25 s at 0.6° a second, then 4 s to the Ready flag.
    expect(leftAt(h, 15)).toBeGreaterThan(26);
    expect(leftAt(h, 15)).toBeLessThan(31);
    expect(leftAt(h, 0)).toBeGreaterThanOrEqual(0);
    expect(leftAt(h, 0)).toBeLessThan(6);
    // Further from the goal than it ever was.
    expect(leftAt(h, 170)).toBeNull();
  });

  it('take the median of earlier heat-ups, carried on at their first rate when the goal is further', () => {
    const curves = [past(1, 25, 180), past(2, 25, 180, 0.8), past(3, 25, 180, 1.2)].map((x) => heatUpOf(x.s, x.detail)!);
    expect(fromHistory(curves, 155)).toBeCloseTo(76, 0);
    // 30° more than any of them started with, at 3° a second: 10 s more.
    expect(fromHistory(curves, 185)).toBeCloseTo(86, 0);
    expect(fromHistory([], 100)).toBeNull();
  });

  it('scale the guess by how this heat-up keeps pace with them', () => {
    const curves: HeatUp[] = [heatUpOf(s, detail)!];
    const plain = fromHistory(curves, 95)!;
    // 60° climbed in 20 s, as before: no change.
    expect(estimate(curves, [{ t: 0, below: 155 }], { t: 20_000, below: 95 })).toBeCloseTo(plain, 0);
    // The same climb took 25 s: 25 % slower from here on too.
    expect(estimate(curves, [{ t: 0, below: 155 }], { t: 25_000, below: 95 })).toBeCloseTo(plain * 1.25, 0);
    // A second of climbing says little yet.
    expect(estimate(curves, [{ t: 0, below: 98 }], { t: 1000, below: 95 })).toBeCloseTo(plain, 0);
  });
});

describe('on two CRAFTY+ heat-ups to 190° (the user\'s, 0.1.48–0.1.50)', () => {
  // Recorded by the session log: seconds from heater on and the temperature, to just past Ready.
  const warm = { readySec: 90, ts: [0, 5, 10, 16, 22, 27, 32, 37, 42, 49, 54, 59, 65, 70, 76, 82, 87, 92],
    c: [47, 51, 61, 71, 81, 91, 101, 114, 123, 131, 143, 146, 157, 164, 170, 177, 183, 191] };
  const cold = { readySec: 116, ts: [0, 5, 10, 15, 20, 26, 31, 36, 41, 46, 52, 57, 62, 67, 72, 77, 82, 87, 92, 97, 102, 108, 113, 118],
    c: [25, 33, 43, 53, 63, 72, 81, 90, 98, 106, 114, 121, 128, 135, 141, 147, 153, 159, 165, 172, 175, 183, 187, 191] };
  const curve = (r: typeof warm) => heatUpOf(
    { readySec: r.readySec } as SessionSummary,
    { ts: r.ts, c: r.c, g: r.ts.map(() => 190), events: [] },
  )!;

  /** Each guess while heating, with the other heat-up as the only earlier one, as Ready.observe makes them. */
  const replay = (r: typeof warm, other: typeof warm) => {
    const trail: { t: number; below: number }[] = [];
    return r.ts.filter((t) => t <= r.readySec).map((t, i) => {
      const now = { t: t * 1000, below: 190 - r.c[i] };
      while (trail.length && trail[0].t <= now.t - 30_000) trail.shift();
      if (t >= 10) trail.push(now);
      return { t, guess: estimate([curve(other)], trail, now)!, real: r.readySec - t };
    });
  };

  it('stays within 20 s from the start and 7 s over the last 40 %', () => {
    for (const [r, other] of [[warm, cold], [cold, warm]]) {
      for (const { t, guess, real } of replay(r, other)) {
        expect(Math.abs(guess - real)).toBeLessThanOrEqual(t >= r.readySec * 0.6 ? 7 : 20);
      }
    }
  });
});

describe('Ready in', () => {
  afterEach(() => vi.useRealTimers());

  it('is known at heater on from earlier sessions and counts down with the heat-up', async () => {
    vi.useFakeTimers();
    await seed('ready-1', [past(T0 - 86_400_000, 25, 180), past(T0 - 2 * 86_400_000, 25, 180), past(T0 - 3 * 86_400_000, 25, 180, 0.9)]);
    at(0, { heaterOn: false, currentTemp: 25 });
    at(1, { heaterOn: true, currentTemp: 25 });
    // The earlier heat-ups load as the heater comes on.
    await vi.advanceTimersByTimeAsync(0);
    at(2, { heaterOn: true, currentTemp: 28 });
    expect(leftNow()).toBeGreaterThanOrEqual(73);
    expect(leftNow()).toBeLessThanOrEqual(76);
    // Heating just like before: the count follows the clock and never goes back up.
    let shown = leftNow()!;
    for (let sec = 3; sec <= 76; sec++) {
      // The device's own flag, which comes a few seconds after the goal.
      at(sec, { heaterOn: true, currentTemp: tempAt(sec - 1, 25, 180), tempReached: false });
      const now = leftNow()!;
      expect(now).toBeLessThanOrEqual(shown);
      expect(shown - now).toBeLessThanOrEqual(2);
      shown = now;
    }
    expect(shown).toBeLessThanOrEqual(3);
    at(80, { heaterOn: true, currentTemp: 180, tempReached: true });
    expect(leftNow()).toBeNull();
  });

  it('runs longer when this heat-up is slower than the earlier ones', async () => {
    vi.useFakeTimers();
    await seed('ready-2', [past(T0 - 86_400_000, 25, 180), past(T0 - 2 * 86_400_000, 25, 180)]);
    at(0, { heaterOn: true, currentTemp: 25 });
    await vi.advanceTimersByTimeAsync(0);
    // 30 % slower: Ready ~98 s after heater on instead of 76.
    for (let sec = 1; sec <= 40; sec++) at(sec, { heaterOn: true, currentTemp: tempAt(sec, 25, 180, 1 / 1.3) });
    const expected = readyAt(25, 180, 1 / 1.3) - 40;
    expect(leftNow()).toBeGreaterThan(expected - 6);
    expect(leftNow()).toBeLessThan(expected + 6);
  });

  it('stays at "Almost ready" once the count has run out, until Ready', async () => {
    vi.useFakeTimers();
    await seed('ready-5', [past(T0 - 86_400_000, 25, 180)]);
    at(0, { heaterOn: true, currentTemp: 25 });
    await vi.advanceTimersByTimeAsync(0);
    for (let sec = 1; sec <= 76; sec++) at(sec, { heaterOn: true, currentTemp: tempAt(sec, 25, 180), tempReached: false });
    // At the goal, but the device has not said Ready yet: the count has run out.
    at(85, { heaterOn: true, currentTemp: 180, tempReached: false });
    expect(leftNow()).toBe(0);
    // A few degrees down again would make a guess of a few seconds; the line stays as it is.
    at(86, { heaterOn: true, currentTemp: 176, tempReached: false });
    at(87, { heaterOn: true, currentTemp: 177, tempReached: false });
    expect(leftNow()).toBe(0);
    at(90, { heaterOn: true, currentTemp: 180, tempReached: true });
    expect(leftNow()).toBeNull();
  });

  it('jumps with a boost and says nothing without earlier sessions', async () => {
    vi.useFakeTimers();
    await seed('ready-3', [past(T0 - 86_400_000, 25, 180)]);
    at(0, { heaterOn: true, currentTemp: 25 });
    await vi.advanceTimersByTimeAsync(0);
    for (let sec = 1; sec <= 70; sec++) at(sec, { heaterOn: true, currentTemp: tempAt(sec, 25, 180) });
    at(71, { heaterOn: true, currentTemp: 180, tempReached: true });
    expect(leftNow()).toBeNull();
    // Booster: 15° more, the slow last stretch of the earlier heat-up again.
    at(80, { heaterOn: true, currentTemp: 180, mode: 'boost' });
    expect(leftNow()).toBeGreaterThan(20);
    at(90, { heaterOn: false, currentTemp: 186 });
    expect(leftNow()).toBeNull();

    await sessions.bind('ready-4', { list: [], details: new Map() });
    at(100, { heaterOn: true, currentTemp: 25 });
    await vi.advanceTimersByTimeAsync(0);
    at(101, { heaterOn: true, currentTemp: 28 });
    expect(leftNow()).toBeNull();
  });
});
