import { describe, expect, it, vi } from 'vitest';
import { locale } from './locale.svelte';
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
    expect(bars[7].label).toBe(new Date().toLocaleString(undefined, { month: 'short' }));
    expect(usage.months(8, Date.now(), { locales: 'pl' })[7].label).toBe(new Date().toLocaleString('pl', { month: 'short' }));
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

describe('usage weeks', () => {
  // One hour of use every day, read at noon, from October 1 to Wednesday, November 4.
  const noon = (day: number) => new Date(2026, 9, day, 12).getTime(); // day 32 is November 1
  const snaps = Array.from({ length: 35 }, (_, i) => ({ t: noon(i + 1), m: 60 * (i + 1) }));
  const now = noon(35);
  const reading = { kind: 'crafty' as const, model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal' as const,
    heaterOn: false, operatingMinutes: 60 * 35, settings: {} };

  it("start on the phone's first day of the week, from the same stored history", async () => {
    await usage.bind('weeks', snaps);
    usage.observe(reading, now);
    const monday = usage.bars('week', 3, now, { locales: 'en', firstDayOfWeek: 1 });
    const sunday = usage.bars('week', 3, now, { locales: 'en', firstDayOfWeek: 0 });
    expect(monday.map((b) => b.label)).toEqual(['Oct 19', 'Oct 26', 'Nov 2']);
    expect(sunday.map((b) => b.label)).toEqual(['Oct 18', 'Oct 25', 'Nov 1']);
    // Readings come at noon, so a week counts from the noon before it began.
    expect(monday.map((b) => b.hours)).toEqual([7, 7, 3]);
    expect(sunday.map((b) => b.hours)).toEqual([7, 7, 4]);
  });

  it('start on the day chosen in Settings, else the phone\'s', async () => {
    await usage.bind('weeks-chosen', snaps);
    usage.observe(reading, now);
    const labels = () => usage.bars('week', 1, now, { locales: 'en' }).map((b) => b.label);
    locale.firstDayOfWeek = 0;
    locale.setWeekChoice('auto');
    expect(labels()).toEqual(['Nov 1']);
    locale.setWeekChoice(1);
    expect(labels()).toEqual(['Nov 2']);
    locale.firstDayOfWeek = 1;
    locale.setWeekChoice(0);
    expect(labels()).toEqual(['Nov 1']);
    locale.setWeekChoice('auto');
    expect(labels()).toEqual(['Nov 2']);
  });

  it('puts today in the current week when today is the first day', async () => {
    await usage.bind('weeks-wednesday', snaps);
    usage.observe(reading, now);
    const wednesday = usage.bars('week', 1, now, { firstDayOfWeek: 3 });
    expect(wednesday[0].hours).toBe(1);
  });
});
