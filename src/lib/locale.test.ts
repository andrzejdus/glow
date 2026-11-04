import { describe, expect, it } from 'vitest';
import { localeDefaults } from './locale.svelte';

describe('localeDefaults', () => {
  it("takes the language's usual clock", () => {
    expect(localeDefaults('en-US').is24Hour).toBe(false);
    expect(localeDefaults('pl-PL').is24Hour).toBe(true);
    expect(localeDefaults('en-GB').is24Hour).toBe(true);
  });

  it('keeps Monday and Celsius whatever the language: English (US) is used far from the US', () => {
    expect(localeDefaults('en-US')).toMatchObject({ firstDayOfWeek: 1, temperatureUnit: 'C' });
    expect(localeDefaults('en')).toMatchObject({ firstDayOfWeek: 1, temperatureUnit: 'C' });
  });

  it('keeps a 24-hour clock, Monday and Celsius for a tag it cannot use', () => {
    expect(localeDefaults('!!')).toEqual({ is24Hour: true, firstDayOfWeek: 1, temperatureUnit: 'C' });
  });
});
