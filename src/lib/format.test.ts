import { describe, expect, it } from 'vitest';
import { duration, usageTime } from './format';

describe('usageTime', () => {
  it('counts in minutes, with hours once there are 60 of them', () => {
    expect(usageTime(0)).toBe('0 min');
    expect(usageTime(0.2)).toBe('12 min');
    expect(usageTime(1)).toBe('1 h');
    expect(usageTime(2.4)).toBe('2 h 24 min');
  });
});

describe('duration', () => {
  it('shows half minutes as they are, not rounded to the next minute', () => {
    expect(duration(210)).toBe('3.5 min');
    expect(duration(270)).toBe('4.5 min');
    expect(duration(120)).toBe('2 min');
    expect(duration(300)).toBe('5 min');
    expect(duration(30)).toBe('30 s');
    expect(duration(5400)).toBe('1.5 h');
  });
});
