import { describe, expect, it } from 'vitest';
import { batteryValues, energyOf, niceScale, seriesOf } from './battery';
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
