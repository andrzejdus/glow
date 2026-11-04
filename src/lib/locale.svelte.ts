import { Capacitor, registerPlugin } from '@capacitor/core';
import { load, save } from './prefs';

// The phone's clock, calendar and temperature preferences (android/.../LocalePlugin.java). Intl in
// the WebView follows only the language and region, so Android's 24-hour switch and its regional
// preferences have to come from the native side; in a browser, the language's own defaults stand in.

export interface LocalePrefs {
  is24Hour: boolean;
  /** 0 for Sunday to 6 for Saturday, as Date.getDay() counts. */
  firstDayOfWeek: number;
  temperatureUnit: 'C' | 'F';
}

interface LocalePlugin {
  get(): Promise<LocalePrefs>;
}

// Regions whose everyday temperatures are in Fahrenheit (CLDR's unit preferences).
const FAHRENHEIT = new Set(['US', 'BS', 'BZ', 'KY', 'PR', 'PW']);

/**
 * What a language tag says: its usual clock, and the first weekday (Monday where unknown) and unit
 * chosen in it (-u-fw-, -u-mu-), else its region's. A phone language says little about where the
 * phone is (English (US) is common far from the US), so Settings › App can override both.
 */
export function localeDefaults(tag: string): LocalePrefs {
  let is24Hour = true;
  try {
    const cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle;
    is24Hour = cycle === 'h23' || cycle === 'h24';
  } catch {
    // An unusable tag keeps the 24-hour clock.
  }
  let firstDayOfWeek = 1;
  let temperatureUnit: 'C' | 'F' = 'C';
  try {
    const loc = new Intl.Locale(tag);
    // getWeekInfo() is the current name; older engines (Chrome before 130) have a weekInfo getter.
    const info = (loc as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (first) firstDayOfWeek = first % 7; // Intl counts Monday as 1 and Sunday as 7
    // A unit written into the tag (-u-mu-, as Android 14's regional preferences do) beats the region's.
    const chosen = /-u(?:-[a-z0-9]{2,8})*-mu-([a-z0-9]{3,8})/i.exec(tag)?.[1]?.toLowerCase();
    if (chosen === 'fahrenhe') temperatureUnit = 'F';
    else if (chosen === undefined && FAHRENHEIT.has(loc.maximize().region ?? '')) temperatureUnit = 'F';
  } catch {
    // Without Intl.Locale: Monday and Celsius.
  }
  return { is24Hour, firstDayOfWeek, temperatureUnit };
}

export type TempUnit = 'C' | 'F';
/** The unit chosen in Settings › App. Auto: the device's own, else the phone's. */
export type UnitChoice = 'auto' | TempUnit;

/**
 * The unit the app shows temperatures in: the user's choice, else the unit of the device's own
 * display (VENTY, VEAZY, VOLCANO report it; CRAFTY does not), else the phone's.
 */
export function resolveUnit(choice: UnitChoice, device: TempUnit | undefined, phone: TempUnit): TempUnit {
  return choice === 'auto' ? (device ?? phone) : choice;
}

/** The first day of the week chosen in Settings › App, as Date.getDay() counts. Auto: the phone's. */
export type WeekChoice = 'auto' | 0 | 1;
const WEEK_CHOICES: readonly WeekChoice[] = ['auto', 1, 0];

/** The day weeks start on: the user's choice, else the phone's. */
export function resolveWeekStart(choice: WeekChoice, phone: number): number {
  return choice === 'auto' ? phone : choice;
}

const native = Capacitor.isNativePlatform() ? registerPlugin<LocalePlugin>('Locale') : null;

class Locale {
  is24Hour = $state(true);
  firstDayOfWeek = $state(1);
  temperatureUnit = $state<TempUnit>('C');
  unitChoice = $state<UnitChoice>('auto');
  weekChoice = $state<WeekChoice>('auto');

  constructor() {
    this.apply(localeDefaults(typeof navigator === 'undefined' ? 'en' : navigator.language));
  }

  /** Reads the phone's settings; again whenever the app comes back, as they may have changed meanwhile. */
  start() {
    void this.load();
    void load<UnitChoice>('temperatureUnit', 'auto').then((c) => {
      if (c === 'C' || c === 'F') this.unitChoice = c;
    });
    void load<WeekChoice>('firstDayOfWeek', 'auto').then((c) => {
      if (WEEK_CHOICES.includes(c)) this.weekChoice = c;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.load();
    });
  }

  /** The unit to show temperatures in, given the device's own (undefined when it reports none). */
  unitFor(device: TempUnit | undefined): TempUnit {
    return resolveUnit(this.unitChoice, device, this.temperatureUnit);
  }

  setUnitChoice(choice: UnitChoice) {
    this.unitChoice = choice;
    void save('temperatureUnit', choice);
  }

  /** The day weeks start on, 0 for Sunday to 6 for Saturday. */
  get weekStart(): number {
    return resolveWeekStart(this.weekChoice, this.firstDayOfWeek);
  }

  setWeekChoice(choice: WeekChoice) {
    this.weekChoice = choice;
    void save('firstDayOfWeek', choice);
  }

  private async load() {
    if (!native) return;
    try {
      this.apply(await native.get());
    } catch {
      // Keep the language's defaults.
    }
  }

  private apply(p: LocalePrefs) {
    this.is24Hour = p.is24Hour;
    this.firstDayOfWeek = p.firstDayOfWeek;
    this.temperatureUnit = p.temperatureUnit;
  }
}

export const locale = new Locale();
