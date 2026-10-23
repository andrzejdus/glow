import { describe, expect, it, vi } from 'vitest';
import { demoHistory, usage } from './usage.svelte';

describe('usage months', () => {
  it('splits the lifetime counter into calendar months, current month last', async () => {
    const minutes = 142 * 60 + 18;
    await usage.bind('test-device', demoHistory(minutes));
    usage.observe({ kind: 'venty', model: 'VENTY', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: false,
      operatingMinutes: minutes, settings: {} });
    const bars = usage.months(8);
    expect(bars).toHaveLength(8);
    expect(bars[7].current).toBe(true);
    expect(bars[7].label).toBe(new Date().toLocaleString('en', { month: 'short' }));
    expect(bars[7].hours).toBeCloseTo(4.2, 5);
    expect(bars[6].hours).toBeCloseTo(8.8, 5);
    expect(bars[0].hours).toBeCloseTo(6.1, 5);
  });
});

describe('usage counting', () => {
  const state = (minutes: number, heaterOn: boolean) => ({
    kind: 'crafty' as const, model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal' as const, heaterOn,
    operatingMinutes: minutes, settings: {},
  });

  it("keeps the hour's first reading, so a month started mid-hour is not shortened", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 1, 2));
    await usage.bind('first-reading', []);
    usage.observe(state(874 * 60 + 41, false));
    vi.setSystemTime(new Date(2026, 9, 23, 1, 18));
    usage.observe(state(874 * 60 + 44, false));
    vi.setSystemTime(new Date(2026, 9, 23, 1, 40));
    usage.observe(state(874 * 60 + 46, false));
    const now = new Date(2026, 9, 23, 1, 41).getTime();
    expect(usage.months(8, now)[7].hours! * 60).toBeCloseTo(5, 5);
    vi.useRealTimers();
  });

  it('counts live seconds from when the heater came on, never a full minute ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 2, 0));
    await usage.bind('live-seconds', []);
    usage.observe(state(100, false));
    vi.setSystemTime(new Date(2026, 9, 23, 2, 10)); // ten minutes later the heater comes on
    usage.observe(state(100, true));
    expect(usage.lifetimeSec(Date.now())).toBe(6000); // no jump
    expect(usage.lifetimeSec(Date.now() + 20_000)).toBe(6020);
    expect(usage.lifetimeSec(Date.now() + 300_000)).toBe(6059); // capped below the next device minute
    vi.useRealTimers();
  });
});
