import { describe, expect, it } from 'vitest';
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
