import { describe, expect, it } from 'vitest';
import { localeDefaults, resolveUnit, resolveWeekStart } from './locale.svelte';

describe('localeDefaults', () => {
  it("takes the language's usual clock, first weekday and temperature unit", () => {
    expect(localeDefaults('en-US')).toEqual({ is24Hour: false, firstDayOfWeek: 0, temperatureUnit: 'F' });
    expect(localeDefaults('pl-PL')).toEqual({ is24Hour: true, firstDayOfWeek: 1, temperatureUnit: 'C' });
    expect(localeDefaults('en-GB')).toEqual({ is24Hour: true, firstDayOfWeek: 1, temperatureUnit: 'C' });
    expect(localeDefaults('ar-EG').firstDayOfWeek).toBe(6);
  });

  it('reads a region from the language alone', () => {
    expect(localeDefaults('en').temperatureUnit).toBe('F');
    expect(localeDefaults('pl').temperatureUnit).toBe('C');
  });

  it("takes a first weekday and unit chosen in the tag over the region's", () => {
    expect(localeDefaults('en-US-u-fw-mon-mu-celsius')).toMatchObject({ firstDayOfWeek: 1, temperatureUnit: 'C' });
    expect(localeDefaults('pl-PL-u-fw-sun-mu-fahrenhe')).toMatchObject({ firstDayOfWeek: 0, temperatureUnit: 'F' });
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

describe('resolveWeekStart', () => {
  it("takes the choice in Settings over the phone's first day", () => {
    expect(resolveWeekStart(1, 0)).toBe(1);
    expect(resolveWeekStart(0, 1)).toBe(0);
  });

  it("on Auto, takes the phone's first day", () => {
    expect(resolveWeekStart('auto', 0)).toBe(0);
    expect(resolveWeekStart('auto', 1)).toBe(1);
  });
});
