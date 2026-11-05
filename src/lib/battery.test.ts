import { describe, expect, it } from 'vitest';
import { BatteryMeans, batteryPeak, batteryValues, energyOf, energySplit, HOLD_MAX_MS, niceScale, phaseAt, seriesOf } from './battery';
import type { BatterySamples, SessionDetail } from './sessions.svelte';

const detail = (battery?: BatterySamples): SessionDetail => ({ ts: [0, 5], c: [100, 110], g: [180, 180], events: [], battery });

describe('battery on the session chart', () => {
  it('offers only the values a session has readings of', () => {
    // CRAFTY+: everything.
    const crafty: BatterySamples = { ts: [0, 5, 10], p: [80, 80, 79], v: [3200, 3150, 3100], i: [-6800, -6900, -7000], t: [280, 282, 285] };
    expect(seriesOf(detail(crafty))).toEqual(['temp', 'battery', 'voltage', 'current', 'power', 'batteryTemp']);
    // VENTY / VEAZY: the percentage only.
    expect(seriesOf(detail({ ts: [0, 5], p: [60, 59] }))).toEqual(['temp', 'battery']);
    // VOLCANO, or a session recorded before Glow kept the battery: the temperature alone, so no chips.
    expect(seriesOf(detail())).toEqual(['temp']);
    expect(seriesOf(null)).toEqual(['temp']);
    // Firmware without the battery temperature: a column of nulls is not offered.
    expect(seriesOf(detail({ ...crafty, t: [null, null, null] }))).not.toContain('batteryTemp');
  });

  it('shows current and power as drawn from the battery, in A and W', () => {
    const b: BatterySamples = { ts: [0, 5, 10], p: [80, 80, 80], v: [3100, null, 4180], i: [-7100, -2000, 483], t: [279, 280, null] };
    expect(batteryValues(b, 'current')).toEqual([7.1, 2, -0.483]);
    expect(batteryValues(b, 'power')![0]).toBeCloseTo(22.01, 2);
    expect(batteryValues(b, 'power')![1]).toBeNull();
    expect(batteryValues(b, 'voltage')).toEqual([3.1, null, 4.18]);
    expect(batteryValues(b, 'batteryTemp')).toEqual([27.9, 28, null]);
  });

  it('picks round steps for the right-hand scale', () => {
    expect(niceScale(0, 7.1, 5)).toEqual({ from: 0, step: 2 });
    expect(niceScale(3.04, 3.7, 5)).toEqual({ from: 3, step: 0.2 });
    expect(niceScale(29, 39.4, 5)).toEqual({ from: 27.5, step: 2.5 });
    expect(niceScale(60, 78, 5)).toEqual({ from: 60, step: 5 });
  });
});

describe('energy', () => {
  it('adds up voltage × current between readings, drained only', () => {
    // 3 V × 6 A = 18 W for 10 s, then 18 → 0 W over 10 s.
    const b: BatterySamples = { ts: [0, 5, 10, 20], p: [80, 80, 80, 80], v: [3000, 3000, 3000, 3000], i: [-6000, -6000, -6000, 0] };
    const e = energyOf(b)!;
    expect(e.wh).toBeCloseTo((18 * 10 + 9 * 10) / 3600, 6);
    expect(e.mah).toBeCloseTo((6000 * 10 + 3000 * 10) / 3600, 6);
    expect(e.spans).toHaveLength(3);
    // Charging (positive current) adds nothing.
    expect(energyOf({ ...b, i: [500, 500, 500, 500] })!.wh).toBe(0);
  });

  it('does not add up across a gap or a missing reading', () => {
    const b: BatterySamples = { ts: [0, 5, 100, 105, 110], p: [], v: [3000, 3000, 3000, null, 3000], i: [-6000, -6000, -6000, -6000, -6000] };
    const e = energyOf(b)!;
    // Only 0–5 s: 5…100 is a gap (the connection was lost), 100–110 lacks a voltage at 105.
    expect(e.wh).toBeCloseTo((18 * 5) / 3600, 6);
    expect(e.spans).toEqual([{ from: 0, to: 5, wh: e.wh }]);
  });

  it('has none without voltage and current', () => {
    expect(energyOf(undefined)).toBeNull();
    expect(energyOf({ ts: [0, 5], p: [60, 59] })).toBeNull();
    expect(energyOf({ ts: [0, 60], p: [60, 59], v: [3000, 3000], i: [-1000, -1000] })).toBeNull();
  });
});

describe('energy split', () => {
  // 10 W (2.5 V × 4 A) throughout: every second is worth the same.
  const flat = (ts: number[]): BatterySamples => ({ ts, p: ts.map(() => 70), v: ts.map(() => 2500), i: ts.map(() => -4000) });
  const events = [{ t: 0, k: 'ready' as const }, { t: 60, k: 'mode' as const, v: 'boost' as const }, { t: 80, k: 'mode' as const, v: 'normal' as const }];

  it('tells the phases apart', () => {
    expect(phaseAt(10, 30, 100, [])).toBe('heatup');
    expect(phaseAt(40, 30, 100, [])).toBe('holding');
    expect(phaseAt(70, 30, 100, events)).toBe('boost');
    expect(phaseAt(90, 30, 100, events)).toBe('holding');
    expect(phaseAt(100, 30, 100, events)).toBe('after');
    // Ready never came: it was heating up all along, unless boosting.
    expect(phaseAt(90, null, null, [])).toBe('heatup');
    expect(phaseAt(10, null, null, [{ t: 0, k: 'mode', v: 'superboost' }])).toBe('superboost');
  });

  it('splits the energy by phase, sharing out a stretch that crosses a change by time', () => {
    // Readings every 7 s, so the changes (ready 30, boost 60–80, off 100) fall inside stretches.
    const ts = Array.from({ length: 21 }, (_, k) => k * 7); // 0…140
    const e = energyOf(flat(ts))!;
    const split = energySplit(e, 30, 100, events);
    expect(split.map((p) => p.phase)).toEqual(['heatup', 'holding', 'boost', 'after']);
    const wh = (sec: number) => (10 * sec) / 3600;
    expect(split[0].wh).toBeCloseTo(wh(30), 6);
    expect(split[1].wh).toBeCloseTo(wh(30 + 20), 6);
    expect(split[2].wh).toBeCloseTo(wh(20), 6);
    expect(split[3].wh).toBeCloseTo(wh(40), 6);
    expect(split.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 9);
  });

  it('leaves out a gap and the phases that took nothing', () => {
    // Lost from 20 to 90 s: neither the gap nor a phase inside it counts.
    const split = energySplit(energyOf(flat([0, 5, 10, 15, 20, 90, 95]))!, 30, 100, events);
    expect(split.map((p) => p.phase)).toEqual(['heatup', 'holding']);
    expect(split[0].wh).toBeCloseTo((10 * 20) / 3600, 6);
  });
});

describe('battery means', () => {
  it('weights each reading by how long it stood, and multiplies voltage and current before averaging', () => {
    const m = new BatteryMeans();
    // 3.1 V × 8 A for 1 s, then 3.55 V × 0 A for 4 s: 4.96 W on average, not 3.46 V × 1.6 A = 5.5 W.
    m.add(0, 3100, -8000);
    m.add(1000, 3550, 0);
    m.add(3000, 3550, 0); // the same reading again changes nothing
    const a = m.take(5000)!;
    expect(a.v).toBeCloseTo(3460, 6);
    expect(a.i).toBeCloseTo(-1600, 6);
    expect(a.w).toBeCloseTo((-3100 * 8000) / 1000 / 5, 6);
    expect(a.lo).toEqual({ i: -8000, w: -24800 });
    // The last reading carries on into the next stretch, and is its lowest so far.
    m.add(7000, 3100, -8000);
    const b = m.take(10_000)!;
    expect(b.i).toBeCloseTo((0 * 2 + -8000 * 3) / 5, 6);
    expect(b.lo.i).toBe(-8000);
  });

  it('has no mean without readings or without time, and keeps the lowest for the next one', () => {
    const m = new BatteryMeans();
    expect(m.take(0)).toBeNull();
    m.add(0, undefined, undefined); // a VENTY: no voltage or current
    expect(m.take(5000)).toBeNull();
    m.add(5000, 3100, -8000);
    expect(m.take(5000)).toBeNull(); // the first sample of a session
    m.add(6000, 3600, -500);
    expect(m.take(10_000)).toMatchObject({ v: 3100 * 0.2 + 3600 * 0.8, i: -8000 * 0.2 + -500 * 0.8, lo: { i: -8000 } });
  });

  it('does not stretch a reading over a gap or past a reset', () => {
    const m = new BatteryMeans();
    m.add(0, 3000, -6000);
    m.add(2000, 3000, -2000);
    // Nothing heard for longer than HOLD_MAX_MS: the -2000 counts for no part of it.
    m.add(2000 + HOLD_MAX_MS + 1, 3000, 0);
    const a = m.take(2000 + HOLD_MAX_MS + 1001)!;
    expect(a.i).toBeCloseTo((-6000 * 2000 + 0 * 1000) / 3000, 6);
    m.reset();
    expect(m.take(60_000)).toBeNull();
  });
});

describe('energy from the means', () => {
  it('takes a mean as the power of the stretch before it, and old single readings by the trapezoid rule', () => {
    // 0–5 s a mean of 10 W, 5–10 s a mean of 20 W, then the cool-down's single readings.
    const b: BatterySamples = {
      ts: [0, 5, 10, 40], p: [80, 80, 80, 80],
      v: [3500, 3300, 3200, 3600], i: [0, -3030, -6250, 0], w: [null, -10_000, -20_000, null],
    };
    const e = energyOf(b)!;
    expect(e.spans.map((s) => s.wh * 3600)).toEqual([expect.closeTo(50, 6), expect.closeTo(100, 6), expect.closeTo(((3.2 * 6.25) / 2) * 30, 6)]);
    expect(e.mah).toBeCloseTo((3030 * 5 + 6250 * 5 + (6250 / 2) * 30) / 3600, 6);
    // The power drawn is the mean where there is one.
    expect(batteryValues(b, 'power').slice(1, 3)).toEqual([10, 20]);
  });

  it('shows the peak of the readings, which the means smooth out', () => {
    const b: BatterySamples = { ts: [0, 5], p: [80, 80], v: [3500, 3300], i: [0, -4000], w: [null, -13_000], min: { i: -8069, w: -25_000 } };
    expect(batteryPeak(b, 'current')).toBeCloseTo(8.069, 6);
    expect(batteryPeak(b, 'power')).toBeCloseTo(25, 6);
    // A session recorded before the means: the peak of what it kept.
    expect(batteryPeak({ ts: [0, 5], p: [80, 80], v: [3100, 3500], i: [-7100, 0] }, 'current')).toBeCloseTo(7.1, 6);
    expect(batteryPeak(undefined, 'power')).toBeNull();
  });
});
