import { Capacitor, registerPlugin } from '@capacitor/core';

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

/** What a language tag alone says: its usual clock, first weekday (Monday where unknown) and unit. */
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
    if (FAHRENHEIT.has(loc.maximize().region ?? '')) temperatureUnit = 'F';
  } catch {
    // Without Intl.Locale: Monday and Celsius.
  }
  return { is24Hour, firstDayOfWeek, temperatureUnit };
}

const native = Capacitor.isNativePlatform() ? registerPlugin<LocalePlugin>('Locale') : null;

class Locale {
  is24Hour = $state(true);
  firstDayOfWeek = $state(1);
  temperatureUnit = $state<'C' | 'F'>('C');

  constructor() {
    this.apply(localeDefaults(typeof navigator === 'undefined' ? 'en' : navigator.language));
  }

  /** Reads the phone's settings; again whenever the app comes back, as they may have changed meanwhile. */
  start() {
    void this.load();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.load();
    });
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
