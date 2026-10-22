export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

export function duration(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 360) / 10} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds)} s`;
}
