import { describe, expect, it } from 'vitest';
import { clockTime, duration, usageTime } from './format';

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

describe('clockTime', () => {
  const t = new Date(2026, 10, 4, 21, 5, 9).getTime();
  // Intl puts a narrow no-break space before AM/PM.
  const plain = (s: string) => s.replace(/\s/g, ' ');

  it("follows the phone's 24-hour switch, not the language's usual clock", () => {
    expect(clockTime(t, true, false, 'en-US')).toBe('21:05');
    expect(plain(clockTime(t, false, false, 'en-US'))).toBe('09:05 PM');
    expect(plain(clockTime(t, false, false, 'pl-PL'))).toMatch(/^09:05 /);
    expect(clockTime(t, true, false, 'pl-PL')).toBe('21:05');
  });

  it('adds seconds when asked', () => {
    expect(clockTime(t, true, true, 'en-US')).toBe('21:05:09');
  });
});
