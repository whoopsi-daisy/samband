import { assessSystem, budgetTone, fetchAgeTone, successRateTone, uptimeTone } from '@/lib/opsHealth';
import type { OperationalStats } from '@/types';

const stats = (overrides: Partial<OperationalStats> = {}): OperationalStats => ({
  totalFetches: 1000,
  successfulFetches: 998,
  failedFetches: 2,
  fetches24h: 144,
  successfulFetches24h: 144,
  failedFetches24h: 0,
  fetches7d: 1008,
  successRate: 99.8,
  successRate24h: 100,
  avgFetchInterval: 10,
  lastSuccessfulFetch: new Date().toISOString(),
  lastFailedFetch: null,
  minutesSinceLastSuccess: 3,
  recentErrors: [],
  hourlyFetches: Array.from({ length: 24 }, () => ({ ok: 6, failed: 0 })),
  avgEventsPerFetch: 0.4,
  eventsAddedToday: 38,
  uptimeScore: 100,
  ...overrides,
});

describe('the verdict at the top of the page', () => {
  it('says so plainly when nothing is wrong', () => {
    const verdict = assessSystem(stats());
    expect(verdict.tone).toBe('ok');
    expect(verdict.title).toBe('Allt fungerar');
    expect(verdict.detail).toContain('3 min');
  });

  // A container that started a minute ago has nothing to be wrong about, and
  // reporting an empty log as an outage would send someone looking for one.
  it('does not call a fresh container broken', () => {
    const verdict = assessSystem(
      stats({ totalFetches: 0, minutesSinceLastSuccess: null, uptimeScore: 0, fetches24h: 0 })
    );
    expect(verdict.tone).toBe('neutral');
    expect(verdict.title).toBe('Väntar på första hämtningen');
  });

  it('is an alert when nothing has ever succeeded', () => {
    const verdict = assessSystem(
      stats({
        minutesSinceLastSuccess: null,
        successfulFetches24h: 0,
        failedFetches24h: 40,
        uptimeScore: 0,
        recentErrors: [{ fetchedAt: '', errorType: 'DNS-fel', message: 'getaddrinfo ENOTFOUND' }],
      })
    );
    expect(verdict.tone).toBe('alert');
    expect(verdict.title).toBe('Ingen hämtning har lyckats');
    // The message, not the bucket: "DNS-fel" ten times over is the same screen
    // whatever actually happened.
    expect(verdict.detail).toContain('getaddrinfo ENOTFOUND');
  });

  // The schedule is one fetch per 10 minutes. One missed pass is ordinary.
  it('tolerates a single missed pass', () => {
    expect(assessSystem(stats({ minutesSinceLastSuccess: 18 })).tone).toBe('ok');
  });

  it('warns once the feed is more than two passes behind', () => {
    const verdict = assessSystem(stats({ minutesSinceLastSuccess: 30 }));
    expect(verdict.tone).toBe('warn');
    expect(verdict.title).toBe('Hämtningarna ligger efter');
  });

  it('escalates when the feed has stood still for an hour', () => {
    const verdict = assessSystem(stats({ minutesSinceLastSuccess: 75 }));
    expect(verdict.tone).toBe('alert');
    expect(verdict.title).toBe('Feeden står stilla');
    expect(verdict.detail).toContain('1 timme');
  });

  it('names failures that have already been recovered from', () => {
    const verdict = assessSystem(
      stats({
        failedFetches24h: 4,
        successRate24h: 97,
        recentErrors: [{ fetchedAt: '', errorType: 'Serverfel', message: 'HTTP 503' }],
      })
    );
    expect(verdict.tone).toBe('warn');
    expect(verdict.detail).toContain('4 hämtningar har misslyckats');
  });

  // "1 hämtningar" is the kind of thing that makes a page look unmaintained.
  it('counts one failure in the singular', () => {
    const verdict = assessSystem(stats({ failedFetches24h: 1, successRate24h: 99.3 }));
    expect(verdict.detail).toContain('1 hämtning har misslyckats');
    expect(verdict.detail).not.toContain('1 hämtningar');
  });

  // Fetching on schedule and failing every time is not uptime, which is what
  // the old score counted.
  it('reports gaps in the schedule even while the latest fetch worked', () => {
    const verdict = assessSystem(
      stats({ uptimeScore: 62, successfulFetches24h: 90, fetches24h: 90, failedFetches24h: 0 })
    );
    expect(verdict.tone).toBe('warn');
    expect(verdict.title).toBe('Färre hämtningar än väntat');
    expect(verdict.detail).toContain('90 av 144');
  });
});

describe('the per-tile thresholds', () => {
  it('grades the age of the last successful fetch against the 10-minute schedule', () => {
    expect(fetchAgeTone(3)).toBe('ok');
    expect(fetchAgeTone(24)).toBe('ok');
    expect(fetchAgeTone(25)).toBe('warn');
    expect(fetchAgeTone(60)).toBe('alert');
    expect(fetchAgeTone(null)).toBe('alert');
  });

  it('grades uptime and success rate', () => {
    expect(uptimeTone(100)).toBe('ok');
    expect(uptimeTone(79)).toBe('warn');
    expect(uptimeTone(49)).toBe('alert');
    expect(successRateTone(99)).toBe('ok');
    expect(successRateTone(90)).toBe('warn');
    expect(successRateTone(10)).toBe('alert');
  });

  // The 10-minute schedule spends 144 of 1440. Anything near the ceiling means
  // something is calling the upstream far more often than it should.
  it('leaves the fetch budget alone at the schedule it was sized for', () => {
    expect(budgetTone(144, 1440)).toBe('ok');
    expect(budgetTone(900, 1440)).toBe('warn');
    expect(budgetTone(1400, 1440)).toBe('alert');
  });
});
