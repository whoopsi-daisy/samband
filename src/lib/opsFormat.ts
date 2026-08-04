// Formatting shared by the operations dashboard.
//
// It lives outside the component so the wording can be asserted directly. Two
// of these were wrong on the page for a long time in ways a test would have
// caught: "1 dagar sedan", and thousands separators that came out as "1,009"
// beside "1 009" because toLocaleString() was called with no locale and picked
// up whatever the server's default was.

/** Swedish grouping, always. Never the runtime's idea of a default. */
export function formatNumber(value: number): string {
  return value.toLocaleString('sv-SE');
}

export function formatPercent(value: number): string {
  // A rate of 99.95 rounds to 100 and reads as "nothing wrong", so anything
  // short of a clean 100 keeps a decimal.
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} %`;
}

/**
 * A span of minutes as an operator would say it.
 *
 * Singular is a real case here, not a nicety: the page read "1 dagar sedan".
 */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return 'aldrig';
  if (minutes < 1) return 'nyss';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} tim` : `${hours} tim ${rest} min`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayWord = days === 1 ? '1 dygn' : `${days} dygn`;
  return restHours === 0 ? dayWord : `${dayWord} ${restHours} tim`;
}

/** "för 3 min sedan", or "aldrig" when there is nothing to date from. */
export function formatAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'aldrig';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just nu';
  return `för ${formatMinutes(minutes)} sedan`;
}

/** Uptime of the process, which is coarser than a fetch interval. */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return formatMinutes(Math.floor(seconds / 60));
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  // Bytes and kilobytes are counts; anything larger is an estimate, and a
  // decimal is the difference between "412 MB" and "411,7 MB" mattering.
  const digits = power <= 1 ? 0 : 1;
  return `${value.toLocaleString('sv-SE', { maximumFractionDigits: digits })} ${units[power]}`;
}

/** A stored date, without a time nobody reads. */
export function formatDay(iso: string | null): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('sv-SE');
}

/** Day and time, for a log line. */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('sv-SE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
