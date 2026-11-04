import { describe, expect, it } from 'vitest';
import { localeDefaults } from './locale.svelte';

describe('localeDefaults', () => {
  it("takes the language's usual clock, first weekday and temperature unit", () => {
    expect(localeDefaults('en-US')).toEqual({ is24Hour: false, firstDayOfWeek: 0, temperatureUnit: 'F' });
    expect(localeDefaults('pl-PL')).toEqual({ is24Hour: true, firstDayOfWeek: 1, temperatureUnit: 'C' });
    expect(localeDefaults('en-GB')).toEqual({ is24Hour: true, firstDayOfWeek: 1, temperatureUnit: 'C' });
  });

  it('reads a region from the language alone', () => {
    expect(localeDefaults('en').temperatureUnit).toBe('F');
    expect(localeDefaults('pl').temperatureUnit).toBe('C');
  });

  it('keeps a 24-hour clock, Monday and Celsius for a tag it cannot use', () => {
    expect(localeDefaults('!!')).toEqual({ is24Hour: true, firstDayOfWeek: 1, temperatureUnit: 'C' });
  });
});
