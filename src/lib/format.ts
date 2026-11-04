export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A time of day in the phone's language, on the clock the phone is set to: Intl alone cannot see
 * Android's 24-hour switch, only what is usual for the language.
 */
export function clockTime(t: number, is24Hour: boolean, seconds = false, locales?: Intl.LocalesArgument): string {
  return new Date(t).toLocaleTimeString(locales, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: is24Hour ? 'h23' : 'h12',
  });
}

export function toUnit(celsius: number, unit: 'C' | 'F' = 'C'): number {
  return Math.round(unit === 'F' ? (celsius * 9) / 5 + 32 : celsius);
}

/** A temperature difference (boost offsets). */
export function deltaToUnit(celsius: number, unit: 'C' | 'F' = 'C'): number {
  return Math.round(unit === 'F' ? (celsius * 9) / 5 : celsius);
}

export function splitHours(seconds: number) {
  const s = Math.floor(seconds);
  return {
    h: Math.floor(s / 3600),
    m: String(Math.floor((s % 3600) / 60)).padStart(2, '0'),
    s: String(s % 60).padStart(2, '0'),
  };
}

/** Usage time counted in minutes: "12 min", "2 h 24 min". */
export function usageTime(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * A number with the phone's decimal separator ("3,5" in Polish), between `min` and `max` decimals.
 * The formatters are kept, as some of these numbers change every second.
 */
export function decimal(value: number, min: number, max = min, locales?: string): string {
  const key = `${locales ?? ''}|${min}|${max}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locales, { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

export function duration(seconds: number, locales?: string): string {
  if (seconds >= 3600) return `${decimal(seconds / 3600, 0, 1, locales)} h`;
  // One decimal, so the CRAFTY's 30 s steps show as they are: 210 s is 3.5 min, not 4.
  if (seconds >= 60) return `${decimal(seconds / 60, 0, 1, locales)} min`;
  return `${Math.round(seconds)} s`;
}
