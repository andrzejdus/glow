import { describe, expect, it } from 'vitest';
import { usageTime } from './format';

describe('usageTime', () => {
  it('counts in minutes, with hours once there are 60 of them', () => {
    expect(usageTime(0)).toBe('0 min');
    expect(usageTime(0.2)).toBe('12 min');
    expect(usageTime(1)).toBe('1 h');
    expect(usageTime(2.4)).toBe('2 h 24 min');
  });
});
