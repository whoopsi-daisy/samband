'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  DatabaseHealth,
  FetchLogEntry,
  HourlyFetches,
  OperationalStats,
  SystemSnapshot,
} from '@/types';
import { useMounted } from '@/hooks/useMounted';
import {
  assessSystem,
  budgetTone,
  fetchAgeTone,
  successRateTone,
  uptimeTone,
  type Tone,
} from '@/lib/opsHealth';
import {
  formatAgo,
  formatBytes,
  formatDay,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatStamp,
  formatUptime,
} from '@/lib/opsFormat';
import ImportPanel from './ImportPanel';

interface OperationalDashboardProps {
  operationalStats: OperationalStats;
  fetchLogs: FetchLogEntry[];
  databaseHealth: DatabaseHealth;
  system: SystemSnapshot;
  fetchBudget: { used: number; limit: number };
  /** When the server built this payload. Everything on the page is that old. */
  generatedAt: string;
}

const REFRESH_MS = 30_000;

/**
 * One number, what it means, and whether it is a problem.
 *
 * The old page had four different grids of `.stat` tiles carrying four
 * different kinds of thing (health percentages, lifetime counters, import
 * state, table sizes) in identical boxes. A tile here always answers the same
 * question: is this figure all right, and what is it measured against.
 */
function Metric({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
}) {
  return (
    <div className={`ops-metric${tone === 'neutral' ? '' : ` ops-metric--${tone}`}`}>
      <span className="ops-metric-label">{label}</span>
      <span className="ops-metric-value">{value}</span>
      {note && <span className="ops-metric-note">{note}</span>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value${tone && tone !== 'neutral' ? ` info-value--${tone}` : ''}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Fetch outcomes by hour over the last day.
 *
 * The previous chart counted attempts, which on a working schedule is exactly
 * six every hour: twenty-four identical bars saying nothing. Splitting the
 * column by outcome makes an outage the one shape on the chart that is not a
 * full bar.
 */
function FetchTimeline({ hours }: { hours: HourlyFetches[] }) {
  const peak = Math.max(...hours.map((h) => h.ok + h.failed), 1);
  const totalFailed = hours.reduce((sum, h) => sum + h.failed, 0);

  return (
    <>
      <div className="ops-timeline" role="img" aria-label={ariaSummary(hours)}>
        {hours.map((hour, index) => {
          const total = hour.ok + hour.failed;
          return (
            <div key={index} className="ops-timeline-col">
              <div
                className="ops-timeline-track"
                title={`kl ${String(index).padStart(2, '0')}: ${hour.ok} lyckade, ${hour.failed} misslyckade`}
              >
                <div
                  className="ops-timeline-bar ops-timeline-bar--failed"
                  style={{ height: `${(hour.failed / peak) * 100}%` }}
                />
                <div
                  className="ops-timeline-bar ops-timeline-bar--ok"
                  style={{ height: `${(hour.ok / peak) * 100}%` }}
                />
              </div>
              <span className="ops-timeline-hour">
                {index % 6 === 0 ? String(index).padStart(2, '0') : ''}
              </span>
              <span className="sr-only">
                {`kl ${index}: ${total} hämtningar, varav ${hour.failed} misslyckade`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="ops-legend">
        <span className="ops-legend-key ops-legend-key--ok" aria-hidden="true" /> Lyckade
        <span className="ops-legend-key ops-legend-key--failed" aria-hidden="true" /> Misslyckade
        <span className="ops-legend-note">
          {totalFailed === 0 ? 'inga fel det senaste dygnet' : `${formatNumber(totalFailed)} fel`}
        </span>
      </p>
    </>
  );
}

function ariaSummary(hours: HourlyFetches[]): string {
  const ok = hours.reduce((sum, h) => sum + h.ok, 0);
  const failed = hours.reduce((sum, h) => sum + h.failed, 0);
  return `Hämtningar per timme det senaste dygnet: ${ok} lyckade, ${failed} misslyckade.`;
}

export default function OperationalDashboard({
  operationalStats,
  fetchLogs,
  databaseHealth,
  system,
  fetchBudget,
  generatedAt,
}: OperationalDashboardProps) {
  const router = useRouter();
  const mounted = useMounted();
  const [refreshing, setRefreshing] = useState(false);
  const [auto, setAuto] = useState(true);

  // Everything here is a server render, so the only way to keep it current is
  // to ask for a new one. Without this the page was a snapshot wearing a
  // timestamp that never moved: the numbers aged silently while the header
  // still claimed the moment the tab was opened.
  const refresh = useCallback(() => {
    setRefreshing(true);
    router.refresh();
  }, [router]);

  useEffect(() => {
    setRefreshing(false);
  }, [generatedAt]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [auto, refresh]);

  // A clock the header can count with, so "för 2 min sedan" ages in place
  // between refreshes instead of freezing until the next one lands.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const verdict = assessSystem(operationalStats);
  const ageTone = fetchAgeTone(operationalStats.minutesSinceLastSuccess);

  // Timezone- and clock-dependent strings differ between the server render and
  // the viewer's browser, so they only appear after mount.
  const local = <T,>(render: () => T, fallback: T): T => (mounted ? render() : fallback);

  return (
    <div className="ops-container">
      <header className="ops-header">
        {/* The page used to have no link off it at all. You arrived by typing
            the URL and left the same way. */}
        <Link className="ops-brand" href="/">
          <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="20" cy="20" r="13" strokeWidth="2.5" opacity="0.35" />
            <circle cx="20" cy="20" r="8" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="3.4" fill="currentColor" stroke="none" />
          </svg>
          <span>Sambandscentralen</span>
          <span className="ops-brand-sep">/</span>
          <span className="ops-brand-page">Systemstatus</span>
        </Link>

        <div className="ops-header-actions">
          <span className="ops-timestamp" aria-live="polite">
            {local(() => `Uppdaterad ${formatAgo(generatedAt, now)}`, ' ')}
          </span>
          <label className="ops-toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Uppdatera automatiskt
          </label>
          <button type="button" className="btn-ghost" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Uppdaterar…' : 'Uppdatera'}
          </button>
        </div>
      </header>

      <main>
        <section className={`ops-verdict ops-verdict--${verdict.tone}`}>
          <span className={`dot dot--${verdict.tone === 'neutral' ? 'warn' : verdict.tone}`} />
          <div>
            <h1 className="ops-verdict-title">{verdict.title}</h1>
            <p className="ops-verdict-detail">{verdict.detail}</p>
          </div>
        </section>

        <section className="ops-section">
          <h2 className="ops-section-title">Hämtning från polisen.se</h2>
          <div className="ops-metrics">
            <Metric
              label="Senaste lyckade hämtning"
              value={local(() => formatMinutes(operationalStats.minutesSinceLastSuccess), '–')}
              note="var tionde minut normalt"
              tone={ageTone}
            />
            <Metric
              label="Lyckade hämtningar, 24h"
              value={formatPercent(operationalStats.successRate24h)}
              note={`${formatNumber(operationalStats.successfulFetches24h)} av ${formatNumber(operationalStats.fetches24h)} försök`}
              tone={successRateTone(operationalStats.successRate24h)}
            />
            <Metric
              label="Drifttid, 24h"
              value={`${operationalStats.uptimeScore} %`}
              note={`${formatNumber(operationalStats.successfulFetches24h)} av 144 väntade`}
              tone={uptimeTone(operationalStats.uptimeScore)}
            />
            <Metric
              label="Hämtningsbudget, 24h"
              value={`${formatNumber(fetchBudget.used)} / ${formatNumber(fetchBudget.limit)}`}
              note="tak mot att en omvalidering blir en skrapning"
              tone={budgetTone(fetchBudget.used, fetchBudget.limit)}
            />
          </div>

          <div className="card-grid">
            <div className="card card--chart">
              <h3 className="card-title">Per timme, senaste dygnet</h3>
              <FetchTimeline hours={operationalStats.hourlyFetches} />
            </div>

            <div className="card">
              <h3 className="card-title">Takt</h3>
              <div className="info-list">
                <Row
                  label="Faktiskt intervall"
                  value={`${operationalStats.avgFetchInterval} min`}
                />
                <Row
                  label="Nya händelser per hämtning"
                  value={operationalStats.avgEventsPerFetch.toLocaleString('sv-SE')}
                />
                <Row
                  label="Nya händelser idag"
                  value={formatNumber(operationalStats.eventsAddedToday)}
                />
                <Row
                  label="Senaste misslyckade"
                  value={local(() => formatAgo(operationalStats.lastFailedFetch, now), '–')}
                  tone={operationalStats.lastFailedFetch ? 'warn' : 'neutral'}
                />
                <Row
                  label="Hämtningar, 7 dygn"
                  value={formatNumber(operationalStats.fetches7d)}
                />
                <Row
                  label="Sedan start"
                  value={`${formatNumber(operationalStats.totalFetches)} (${formatPercent(operationalStats.successRate)} lyckade)`}
                />
              </div>
            </div>
          </div>

          {/* One table, not a table plus a separate error list built from the
              same rows. The failures are the reason to look, so they are
              marked rather than filed somewhere else on the page. */}
          <div className="panel">
            <div className="ops-table-wrap">
              <table className="ops-table">
                <caption className="sr-only">
                  De {fetchLogs.length} senaste hämtningarna från polisen.se
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Tid</th>
                    <th scope="col">Utfall</th>
                    <th scope="col" className="ops-table-num">Hämtade</th>
                    <th scope="col" className="ops-table-num">Nya</th>
                    <th scope="col">Fel</th>
                  </tr>
                </thead>
                <tbody>
                  {fetchLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="ops-table-empty">
                        Inga hämtningar loggade ännu.
                      </td>
                    </tr>
                  )}
                  {fetchLogs.map((log) => (
                    <tr key={log.id} className={log.success ? undefined : 'ops-table-row--failed'}>
                      <td className="ops-table-time">
                        {local(() => formatStamp(log.fetchedAt), '–')}
                      </td>
                      <td>
                        <span className={`badge ${log.success ? 'badge--ok' : 'badge--alert'}`}>
                          {log.success ? 'OK' : log.errorType || 'FEL'}
                        </span>
                      </td>
                      <td className="ops-table-num">{formatNumber(log.eventsFetched)}</td>
                      <td className="ops-table-num">
                        {log.eventsNew > 0 ? `+${formatNumber(log.eventsNew)}` : '0'}
                      </td>
                      <td className="ops-table-message" title={log.errorMessage ?? undefined}>
                        {log.errorMessage ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ops-note">
              De {fetchLogs.length} senaste av {formatNumber(databaseHealth.totalFetchLogs)} loggade
              hämtningar. Loggen rensas efter 30 dygn.
            </p>
          </div>
        </section>

        <ImportPanel />

        <section className="ops-section">
          <h2 className="ops-section-title">Databas och lagring</h2>
          <div className="ops-metrics">
            <Metric
              label="Live-händelser"
              value={formatNumber(databaseHealth.totalEvents)}
              note="från polisen.se, ungefär en vecka djupt"
            />
            <Metric
              label="Arkivhändelser"
              value={formatNumber(system.archive.events)}
              note={
                system.archive.cutoff
                  ? `serveras före ${local(() => formatDay(system.archive.cutoff), '–')}`
                  : 'ingen import gjord'
              }
            />
            <Metric
              label="Databasfil"
              value={formatBytes(system.databaseBytes)}
              note={
                system.walBytes > 0
                  ? `plus ${formatBytes(system.walBytes)} WAL`
                  : 'ingen väntande WAL'
              }
            />
            <Metric
              label="Med koordinater"
              value={`${databaseHealth.eventsWithGpsPercent} %`}
              note={`${formatNumber(databaseHealth.eventsWithGps)} av live-raderna hamnar på kartan`}
            />
          </div>

          <div className="card-grid">
            <div className="card">
              <h3 className="card-title">Täckning</h3>
              <div className="info-list">
                <Row
                  label="Äldsta live-händelse"
                  value={local(() => formatDay(databaseHealth.oldestEvent), '–')}
                />
                <Row
                  label="Nyaste live-händelse"
                  value={local(
                    () =>
                      `${formatDay(databaseHealth.newestEvent)} (${formatMinutes(databaseHealth.dataFreshnessMinutes)} gammal)`,
                    '–'
                  )}
                />
                <Row
                  label="Brytpunkt mot arkivet"
                  value={
                    system.archive.cutoff
                      ? local(() => formatDay(system.archive.cutoff), '–')
                      : 'inget arkiv'
                  }
                />
                <Row
                  label="Uppdaterade i efterhand"
                  value={`${formatNumber(databaseHealth.updatedEvents)} (${databaseHealth.updatedEventsPercent} %)`}
                />
                <Row label="Platser / typer" value={`${databaseHealth.uniqueLocations} / ${databaseHealth.uniqueTypes}`} />
                <Row label="Rader i hämtningsloggen" value={formatNumber(databaseHealth.totalFetchLogs)} />
              </div>
            </div>

            {/* The answers to "is it the container or is it the code", which
                previously all needed a shell on the host. */}
            <div className="card">
              <h3 className="card-title">Miljö</h3>
              <div className="info-list">
                <Row
                  label="Tidszon"
                  value={system.timeZone}
                  tone={system.timeZoneCorrect ? 'ok' : 'alert'}
                />
                {!system.timeZoneCorrect && (
                  <p className="ops-hint ops-hint--alert">
                    Appen tolkar svenska klockslag ur notistexten. Allt utom Europe/Stockholm
                    förskjuter varje händelse med en till två timmar.
                  </p>
                )}
                <Row label="Datakatalog" value={<code>{system.dataDir}</code>} />
                <Row
                  label="Sökindex"
                  value={
                    system.searchTokenizer.matches
                      ? system.searchTokenizer.configured
                      : `${system.searchTokenizer.built} (byggs om till ${system.searchTokenizer.configured})`
                  }
                  tone={system.searchTokenizer.matches ? 'neutral' : 'warn'}
                />
                <Row label="Processen har levt" value={local(() => formatUptime(system.processUptimeSeconds), '–')} />
                <Row label="Node" value={system.nodeVersion} />
              </div>
            </div>
          </div>
        </section>

        {/* Trends over the events themselves are a reader's question, and the
            app already answers it. The dashboard used to carry its own copy of
            the daily and hourly charts, which is a second thing to keep right
            for no operational gain. */}
        <p className="ops-outro">
          Statistik över händelserna själva finns i appen under{' '}
          <Link href="/?vy=statistik">Statistik</Link>.
        </p>
      </main>
    </div>
  );
}
