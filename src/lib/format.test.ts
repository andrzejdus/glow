import { describe, expect, it } from 'vitest';
import { clockTime, decimal, duration, usageTime } from './format';

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
    expect(duration(210, 'en')).toBe('3.5 min');
    expect(duration(270, 'en')).toBe('4.5 min');
    expect(duration(120, 'en')).toBe('2 min');
    expect(duration(300, 'en')).toBe('5 min');
    expect(duration(30, 'en')).toBe('30 s');
    expect(duration(5400, 'en')).toBe('1.5 h');
  });

  it("uses the phone's decimal separator", () => {
    expect(duration(210, 'pl')).toBe('3,5 min');
    expect(duration(5400, 'de')).toBe('1,5 h');
  });
});

describe('decimal', () => {
  it('keeps a fixed number of decimals with the language separator', () => {
    expect(decimal(3.7, 2, 2, 'en')).toBe('3.70');
    expect(decimal(3.7, 2, 2, 'pl')).toBe('3,70');
    expect(decimal(12.345, 1, 1, 'de')).toBe('12,3');
  });

  it('drops a trailing zero when fewer decimals are allowed', () => {
    expect(decimal(2, 0, 1, 'en')).toBe('2');
    expect(decimal(2.25, 0, 1, 'pl')).toBe('2,3');
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
