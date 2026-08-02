import type { OperationalStats } from '@/types';

// Whether the thing is working, in one sentence.
//
// The dashboard used to open with three coloured percentages and leave the
// reading to whoever was looking. That is fine when you already know what
// "Drifttid 100 % / Lyckade 98,2 % / Datafärskhet 63m" is supposed to look
// like, and useless at three in the morning when you do not. The rules below
// are the ones an operator would apply anyway, written down once.

export type Tone = 'ok' | 'warn' | 'alert' | 'neutral';

export interface Verdict {
  tone: Tone;
  title: string;
  detail: string;
}

// The app fetches at most once per 10 minutes. One missed slot is normal (the
// scheduler and the request path race, and polisen.se is occasionally slow);
// three in a row is not.
const SCHEDULE_MINUTES = 10;
const LATE_MINUTES = SCHEDULE_MINUTES * 2.5; // 25
const STALE_MINUTES = SCHEDULE_MINUTES * 6; // 60

/** Successful fetches in 24h against the 144 the schedule expects. */
const UPTIME_WARN = 80;
const UPTIME_ALERT = 50;

export function fetchAgeTone(minutes: number | null): Tone {
  if (minutes === null) return 'alert';
  if (minutes >= STALE_MINUTES) return 'alert';
  if (minutes >= LATE_MINUTES) return 'warn';
  return 'ok';
}

export function uptimeTone(score: number): Tone {
  if (score < UPTIME_ALERT) return 'alert';
  if (score < UPTIME_WARN) return 'warn';
  return 'ok';
}

export function successRateTone(rate: number): Tone {
  if (rate < 80) return 'alert';
  if (rate < 95) return 'warn';
  return 'ok';
}

/**
 * How much of the daily ceiling has gone.
 *
 * The schedule spends 144 of 1440, so this only leaves the floor if something
 * is calling the upstream far more often than it should.
 */
export function budgetTone(used: number, limit: number): Tone {
  const share = limit > 0 ? used / limit : 0;
  if (share >= 0.9) return 'alert';
  if (share >= 0.6) return 'warn';
  return 'ok';
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function assessSystem(stats: OperationalStats): Verdict {
  const { minutesSinceLastSuccess, failedFetches24h, uptimeScore, totalFetches } = stats;
  const lastError = stats.recentErrors[0];
  // The message is what an operator acts on; the bucket is what they scan.
  const errorNote = lastError
    ? `Senaste felet: ${lastError.message ?? lastError.errorType}.`
    : '';

  // A container that has just started has nothing to be wrong about yet.
  if (totalFetches === 0) {
    return {
      tone: 'neutral',
      title: 'Väntar på första hämtningen',
      detail:
        'Inget har hämtats från polisen.se ännu. Det sker vid nästa besök på sidan, ' +
        'eller inom tio minuter av sig självt.',
    };
  }

  if (minutesSinceLastSuccess === null) {
    return {
      tone: 'alert',
      title: 'Ingen hämtning har lyckats',
      detail: `Varje försök mot polisen.se har misslyckats. ${errorNote}`.trim(),
    };
  }

  if (minutesSinceLastSuccess >= STALE_MINUTES) {
    return {
      tone: 'alert',
      title: 'Feeden står stilla',
      detail:
        `Senaste lyckade hämtningen var för ${formatSpan(minutesSinceLastSuccess)} sedan, ` +
        `mot var tionde minut normalt. ${errorNote}`.trim(),
    };
  }

  if (minutesSinceLastSuccess >= LATE_MINUTES) {
    return {
      tone: 'warn',
      title: 'Hämtningarna ligger efter',
      detail:
        `Senaste lyckade hämtningen var för ${formatSpan(minutesSinceLastSuccess)} sedan. ` +
        'Ett överhoppat pass är normalt, flera i rad är det inte.',
    };
  }

  if (uptimeScore < UPTIME_WARN) {
    return {
      tone: uptimeTone(uptimeScore),
      title: 'Färre hämtningar än väntat',
      detail:
        `${stats.successfulFetches24h} av 144 väntade hämtningar lyckades det senaste dygnet. ` +
        'Feeden är aktuell just nu, men den har luckor bakåt.',
    };
  }

  // Recovered, but the failures are recent enough to be worth naming.
  if (failedFetches24h > 0) {
    return {
      tone: 'warn',
      title: 'Fungerar igen efter fel',
      detail:
        `${plural(failedFetches24h, 'hämtning har misslyckats', 'hämtningar har misslyckats')} ` +
        `det senaste dygnet. Den senaste lyckades. ${errorNote}`.trim(),
    };
  }

  return {
    tone: 'ok',
    title: 'Allt fungerar',
    detail:
      `Senaste hämtningen från polisen.se lyckades för ${formatSpan(minutesSinceLastSuccess)} sedan, ` +
      'och inga fel det senaste dygnet.',
  };
}

// A local, deliberately small span formatter: this module is imported by the
// health assessment only, and pulling in the full formatter would make the
// wording tests depend on byte and date formatting too.
function formatSpan(minutes: number): string {
  if (minutes < 1) return 'mindre än en minut';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 timme' : `${hours} timmar`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 dygn' : `${days} dygn`;
}
