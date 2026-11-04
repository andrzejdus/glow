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

/**
 * What a language tag alone says: its usual clock. The first weekday stays Monday and the unit
 * Celsius: a phone language (often English (US)) says little about where the phone is, so only
 * the phone's own regional preferences (LocalePlugin) change those.
 */
export function localeDefaults(tag: string): LocalePrefs {
  let is24Hour = true;
  try {
    const cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle;
    is24Hour = cycle === 'h23' || cycle === 'h24';
  } catch {
    // An unusable tag keeps the 24-hour clock.
  }
  return { is24Hour, firstDayOfWeek: 1, temperatureUnit: 'C' };
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

const native = Capacitor.isNativePlatform() ? registerPlugin<LocalePlugin>('Locale') : null;

class Locale {
  is24Hour = $state(true);
  firstDayOfWeek = $state(1);
  temperatureUnit = $state<TempUnit>('C');
  unitChoice = $state<UnitChoice>('auto');

  constructor() {
    this.apply(localeDefaults(typeof navigator === 'undefined' ? 'en' : navigator.language));
  }

  /** Reads the phone's settings; again whenever the app comes back, as they may have changed meanwhile. */
  start() {
    void this.load();
    void load<UnitChoice>('temperatureUnit', 'auto').then((c) => {
      if (c === 'C' || c === 'F') this.unitChoice = c;
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
