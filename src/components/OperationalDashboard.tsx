'use client';

import { useState, useEffect } from 'react';
import { OperationalStats, FetchLogEntry, DatabaseHealth, Statistics } from '@/types';
import { useMounted } from '@/hooks/useMounted';
import ImportPanel from './ImportPanel';

interface OperationalDashboardProps {
  operationalStats: OperationalStats;
  fetchLogs: FetchLogEntry[];
  databaseHealth: DatabaseHealth;
  eventStats: Statistics;
}

// Both helpers below depend on the viewer's clock and timezone, so they only
// produce stable markup after mount — see the `mounted` gate in the component.
function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return 'Aldrig';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just nu';
  if (diffMins < 60) return `${diffMins} min sedan`;
  if (diffHours < 24) return `${diffHours} tim sedan`;
  if (diffDays < 7) return `${diffDays} dagar sedan`;
  return date.toLocaleDateString('sv-SE');
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('sv-SE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Health = 'healthy' | 'warning' | 'error';

/** Domain health words -> the design system's three status modifiers. */
const TONE: Record<Health, 'ok' | 'warn' | 'alert'> = {
  healthy: 'ok',
  warning: 'warn',
  error: 'alert',
};

function StatusIndicator({ status }: { status: Health }) {
  return <span className={`dot dot--${TONE[status]}`} title={status} />;
}

export default function OperationalDashboard({
  operationalStats,
  fetchLogs,
  databaseHealth,
  eventStats,
}: OperationalDashboardProps) {
  const getSystemStatus = (): 'healthy' | 'warning' | 'error' => {
    if (operationalStats.successRate < 80 || operationalStats.uptimeScore < 50) return 'error';
    if (operationalStats.successRate < 95 || operationalStats.uptimeScore < 80) return 'warning';
    return 'healthy';
  };

  const getFreshnessStatus = (): 'healthy' | 'warning' | 'error' => {
    if (databaseHealth.dataFreshnessMinutes > 120) return 'error';
    if (databaseHealth.dataFreshnessMinutes > 60) return 'warning';
    return 'healthy';
  };

  const systemStatus = getSystemStatus();
  const freshnessStatus = getFreshnessStatus();

  const [updatedAt, setUpdatedAt] = useState<string>('');
  useEffect(() => {
    setUpdatedAt(new Date().toLocaleString('sv-SE'));
  }, []);

  // Clock- and timezone-dependent strings render as a placeholder on the server
  // and are filled in on mount, so hydration never sees two different values.
  const mounted = useMounted();
  const timeAgo = (value: string | null) => (mounted ? formatTimeAgo(value) : '—');
  const dateTime = (value: string) => (mounted ? formatDateTime(value) : '—');
  const dateOnly = (value: string | null) =>
    !value ? 'N/A' : mounted ? new Date(value).toLocaleDateString('sv-SE') : '—';

  const maxHourlyFetches = Math.max(...operationalStats.hourlyFetches, 1);
  const maxDailyEventCount = Math.max(...eventStats.daily.map(d => d.count), 1);
  const maxHourlyEventCount = Math.max(...eventStats.hourly, 1);

  return (
    <div className="ops-container">
      <header className="ops-header">
        <div className="ops-title">
          <StatusIndicator status={systemStatus} />
          <div>
            <h1>Systemstatus</h1>
            <p>Driftöversikt</p>
          </div>
        </div>
        <span className="ops-timestamp">{updatedAt && `Uppdaterad ${updatedAt}`}</span>
      </header>

      <main>
        {/* Systemhälsa */}
        <section className="ops-section">
          <h2 className="ops-section-title">Systemhälsa</h2>
          <div className="stats-grid">
            <div className={`stat stat--${TONE[systemStatus]}`}>
              <span className="stat-value">{operationalStats.uptimeScore}%</span>
              <span className="stat-label">Drifttid (24h)</span>
            </div>
            <div className={`stat stat--${operationalStats.successRate >= 95 ? 'ok' : operationalStats.successRate >= 80 ? 'warn' : 'alert'}`}>
              <span className="stat-value">{operationalStats.successRate}%</span>
              <span className="stat-label">Lyckade hämtningar</span>
            </div>
            <div className={`stat stat--${TONE[freshnessStatus]}`}>
              <span className="stat-value">{databaseHealth.dataFreshnessMinutes}m</span>
              <span className="stat-label">Datafärskhet</span>
            </div>
          </div>
        </section>

        {/* Hämtningsstatistik */}
        <section className="ops-section">
          <h2 className="ops-section-title">Hämtningar</h2>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-value">{operationalStats.totalFetches.toLocaleString()}</span>
              <span className="stat-label">Totalt</span>
            </div>
            <div className="stat">
              <span className="stat-value stat-value--ok">{operationalStats.successfulFetches.toLocaleString()}</span>
              <span className="stat-label">Lyckade</span>
            </div>
            <div className="stat">
              <span className="stat-value stat-value--alert">{operationalStats.failedFetches}</span>
              <span className="stat-label">Misslyckade</span>
            </div>
            <div className="stat">
              <span className="stat-value">{operationalStats.avgFetchInterval}m</span>
              <span className="stat-label">Snittintervall</span>
            </div>
          </div>

          <div className="card-grid">
            <div className="card">
              <h3 className="card-title">Hämtningar (24h)</h3>
              <div className="chart">
                {operationalStats.hourlyFetches.map((count, hour) => {
                  const height = (count / maxHourlyFetches) * 100;
                  return (
                    <div key={hour} className="chart-col">
                      <div className="chart-track">
                        <div
                          className="chart-bar"
                          style={{ height: `${height}%` }}
                          title={`${hour}:00 - ${count} hämtningar`}
                        />
                      </div>
                      {hour % 6 === 0 && <span className="chart-label">{hour}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Senaste aktivitet</h3>
              <div className="info-list">
                <div className="info-row">
                  <span className="info-label">Senast lyckad</span>
                  <span className="info-value info-value--ok">
                    {timeAgo(operationalStats.lastSuccessfulFetch)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Senast misslyckad</span>
                  <span className="info-value info-value--muted">
                    {timeAgo(operationalStats.lastFailedFetch)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Hämtningar idag</span>
                  <span className="info-value">{operationalStats.fetches24h}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Hämtningar (7d)</span>
                  <span className="info-value">{operationalStats.fetches7d}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Snitt händelser/hämtning</span>
                  <span className="info-value">{operationalStats.avgEventsPerFetch}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Nya händelser idag</span>
                  <span className="info-value">{operationalStats.eventsAddedToday}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Importstatus — live, se ImportPanel */}
        <ImportPanel />

        {/* Databashälsa */}
        <section className="ops-section">
          <h2 className="ops-section-title">Databas</h2>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-value">{databaseHealth.totalEvents.toLocaleString()}</span>
              <span className="stat-label">Totalt antal händelser</span>
            </div>
            <div className="stat">
              <span className="stat-value">{databaseHealth.uniqueLocations}</span>
              <span className="stat-label">Platser</span>
            </div>
            <div className="stat">
              <span className="stat-value">{databaseHealth.uniqueTypes}</span>
              <span className="stat-label">Händelsetyper</span>
            </div>
            <div className="stat">
              <span className="stat-value">{databaseHealth.eventsWithGpsPercent}%</span>
              <span className="stat-label">Med GPS</span>
            </div>
          </div>

          <div className="card-grid">
            <div className="card">
              <h3 className="card-title">Datatäckning</h3>
              <div className="info-list">
                <div className="info-row">
                  <span className="info-label">Äldsta händelse</span>
                  <span className="info-value">
                    {dateOnly(databaseHealth.oldestEvent)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Nyaste händelse</span>
                  <span className="info-value">
                    {dateOnly(databaseHealth.newestEvent)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Uppdaterade händelser</span>
                  <span className="info-value">
                    {databaseHealth.updatedEvents.toLocaleString()} ({databaseHealth.updatedEventsPercent}%)
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Hämtningsloggar</span>
                  <span className="info-value">{databaseHealth.totalFetchLogs.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Händelser per typ</h3>
              <ul className="top-list">
                {(() => {
                  const rows = databaseHealth.eventsByType.slice(0, 8);
                  const max = Math.max(...rows.map((r) => r.count), 1);
                  return rows.map((item, index) => (
                    <li key={item.type}>
                      <div className="top-item top-item--static">
                        <span className="top-rank">{index + 1}</span>
                        <span className="top-name">{item.type}</span>
                        <span className="top-track">
                          <span className="top-bar" style={{ width: `${(item.count / max) * 100}%` }} />
                        </span>
                        <span className="top-count">{item.count.toLocaleString('sv-SE')}</span>
                      </div>
                    </li>
                  ));
                })()}
              </ul>
            </div>
          </div>
        </section>

        {/* Händelsestatistik */}
        <section className="ops-section">
          <h2 className="ops-section-title">Händelsestatistik</h2>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-value">{eventStats.last24h}</span>
              <span className="stat-label">Senaste 24h</span>
            </div>
            <div className="stat">
              <span className="stat-value">{eventStats.last7d}</span>
              <span className="stat-label">Senaste 7d</span>
            </div>
            <div className="stat">
              <span className="stat-value">{eventStats.last30d}</span>
              <span className="stat-label">Senaste 30d</span>
            </div>
            <div className="stat">
              <span className="stat-value">{eventStats.avgPerDay}</span>
              <span className="stat-label">Snitt/dag</span>
            </div>
          </div>

          <div className="card-grid">
            <div className="card">
              <h3 className="card-title">Daglig trend (7d)</h3>
              <div className="chart">
                {eventStats.daily.map((day) => {
                  const height = (day.count / maxDailyEventCount) * 100;
                  return (
                    <div key={day.date} className="chart-col">
                      <div className="chart-track">
                        <div
                          className="chart-bar"
                          style={{ height: `${height}%` }}
                          title={`${day.date}: ${day.count} händelser`}
                        />
                      </div>
                      <span className="chart-value">{day.count}</span>
                      <span className="chart-label">{day.day}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">Fördelning per timme (24h)</h3>
              <div className="chart chart--sm">
                {eventStats.hourly.map((count, hour) => {
                  const height = (count / maxHourlyEventCount) * 100;
                  return (
                    <div key={hour} className="chart-col">
                      <div className="chart-track">
                        <div
                          className="chart-bar chart-bar--strong"
                          style={{ height: `${height}%` }}
                          title={`${hour}:00 - ${count} händelser`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="chart-axis">
                <span>00:00</span>
                <span>12:00</span>
                <span>23:00</span>
              </div>
            </div>
          </div>
        </section>

        {/* Senaste fel */}
        {operationalStats.recentErrors.length > 0 && (
          <section className="ops-section">
            <h2 className="ops-section-title">Senaste fel</h2>
            <div className="card">
              <div className="ops-error-list">
                {operationalStats.recentErrors.map((error, index) => (
                  <div key={index} className="ops-error-item">
                    <span className="ops-error-type">{error.error_type}</span>
                    <span className="ops-error-time">{dateTime(error.fetched_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Hämtningslogg */}
        <section className="ops-section">
          <h2 className="ops-section-title">Senaste hämtningslogg</h2>
          <div className="panel">
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Tid</th>
                    <th>Status</th>
                    <th>Hämtade</th>
                    <th>Nya</th>
                    <th>Anteckningar</th>
                  </tr>
                </thead>
                <tbody>
                  {fetchLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="ops-table-time">{dateTime(log.fetchedAt)}</td>
                      <td>
                        <span className={`badge ${log.success ? 'badge--neutral' : 'badge--alert'}`}>
                          {log.success ? 'OK' : 'FEL'}
                        </span>
                      </td>
                      <td>{log.eventsFetched}</td>
                      <td>
                        {log.eventsNew > 0 ? `+${log.eventsNew}` : '0'}
                      </td>
                      <td className="ops-note">{log.errorType || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="ops-footer">
        <p>Sambandscentralen Driftöversikt</p>
      </footer>
    </div>
  );
}
