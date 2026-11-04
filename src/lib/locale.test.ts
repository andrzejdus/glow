import { describe, expect, it } from 'vitest';
import { localeDefaults, resolveUnit } from './locale.svelte';

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

describe('resolveUnit', () => {
  it("takes the choice in Settings over the device's unit and the phone's", () => {
    expect(resolveUnit('F', 'C', 'C')).toBe('F');
    expect(resolveUnit('C', 'F', 'F')).toBe('C');
    expect(resolveUnit('F', undefined, 'C')).toBe('F');
  });

  it("on Auto, takes the device's unit over the phone's", () => {
    expect(resolveUnit('auto', 'F', 'C')).toBe('F');
    expect(resolveUnit('auto', 'C', 'F')).toBe('C');
  });

  it("on Auto, takes the phone's unit when the device reports none (CRAFTY)", () => {
    expect(resolveUnit('auto', undefined, 'F')).toBe('F');
    expect(resolveUnit('auto', undefined, 'C')).toBe('C');
  });
});
