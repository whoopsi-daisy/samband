'use client';

import { memo } from 'react';
import { Statistics } from '@/types';
import { useMounted } from '@/hooks/useMounted';

interface StatsViewProps {
  stats: Statistics;
  onTypeClick?: (type: string) => void;
  onLocationClick?: (location: string) => void;
}

const WEEKDAY_NAMES = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const WEEKDAY_LONG = ['måndagar', 'tisdagar', 'onsdagar', 'torsdagar', 'fredagar', 'lördagar', 'söndagar'];

// Date only — these are coverage boundaries, not timestamps, so the time of
// day is noise. Rendered against the viewer's clock, so it only produces
// stable markup after mount (see the `mounted` gate below).
function formatDay(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('sv-SE');
}

function TopList({
  rows,
  onSelect,
}: {
  rows: { label: string; total: number }[];
  onSelect?: (label: string) => void;
}) {
  // Normalise against the largest row, not the grand total. Against the total,
  // the top entry of a long-tailed distribution fills ~10% of the track and
  // every bar reads as empty.
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <ul className="top-list">
      {rows.map((row, i) => {
        const pct = Math.round((row.total / max) * 100);
        return (
          <li key={row.label}>
            <button type="button" className="top-item" onClick={() => onSelect?.(row.label)}>
              <span className="top-rank">{i + 1}</span>
              <span className="top-name">{row.label}</span>
              <span className="top-track">
                <span className="top-bar" style={{ width: `${pct}%` }} />
              </span>
              <span className="top-count">{row.total.toLocaleString('sv-SE')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Which entry of a series is the tallest — the one sentence each chart exists
// to say. A phone has no hover, so without it the weekday and hour charts are
// shapes with no readable value anywhere on them.
function peakIndex(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function StatsView({ stats, onTypeClick, onLocationClick }: StatsViewProps) {
  const mounted = useMounted();
  const coverageDay = (iso: string) => (mounted ? formatDay(iso) : '—');
  const maxDaily = Math.max(...stats.daily.map((d) => d.count), 1);
  const maxWeekday = Math.max(...stats.weekdays, 1);
  const maxHourly = Math.max(...stats.hourly, 1);

  const peakWeekday = peakIndex(stats.weekdays);
  const peakHour = peakIndex(stats.hourly);
  const weekdayTotal = stats.weekdays.reduce((a, b) => a + b, 0);
  const hourlyTotal = stats.hourly.reduce((a, b) => a + b, 0);

  return (
    <section aria-label="Statistik">
      <div className="stats-grid">
        <div className="stat stat--primary">
          <span className="stat-value">{stats.total.toLocaleString('sv-SE')}</span>
          <span className="stat-label">Totalt antal händelser</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.last24h}</span>
          <span className="stat-label">Senaste 24h</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.last7d}</span>
          <span className="stat-label">Senaste 7 dagar</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.last30d}</span>
          <span className="stat-label">Senaste 30 dagar</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.avgPerDay.toLocaleString('sv-SE')}</span>
          <span className="stat-label">Per dag i snitt</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.uniqueLocations}</span>
          <span className="stat-label">Unika platser</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.uniqueTypes}</span>
          <span className="stat-label">Händelsetyper</span>
        </div>
        {/* "Med GPS-position" and "Uppdaterade" used to sit here. They measure
            how complete the stored data is, not anything about crime in
            Sweden, and they are on the operations dashboard at /stats where an
            operator can act on them. */}
      </div>

      {/* What the tiles above are computed over. Without this, a database
          holding years of imported history looks the same as one holding a
          week of live events. */}
      <p className="stats-coverage">
        {stats.oldestEvent && (
          <>
            Data från <strong>{coverageDay(stats.oldestEvent)}</strong> och framåt.{' '}
          </>
        )}
        {stats.archiveEvents > 0 ? (
          <>
            Inkluderar {stats.archiveEvents.toLocaleString('sv-SE')} importerade händelser från
            Brottsplatskartan{stats.archiveCutoff ? ` fram till ${coverageDay(stats.archiveCutoff)}` : ''},
            därefter polisens egen händelseström.
          </>
        ) : (
          <>Endast polisens egen händelseström — inget arkiv är importerat.</>
        )}
      </p>

      <div className="card">
        <h2 className="card-title">Antal händelser per dag, senaste veckan</h2>
        <div className="chart">
          {stats.daily.map((day) => (
            <div key={day.date} className="chart-col" title={`${day.date}: ${day.count} händelser`}>
              <span className="chart-value">{day.count}</span>
              <span className="chart-track">
                <span className="chart-bar" style={{ height: `${(day.count / maxDaily) * 100}%` }} />
              </span>
              <span className="chart-label">{day.day.substring(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2 className="card-title">Per veckodag, senaste 30 dagarna</h2>
          <div className="chart">
            {stats.weekdays.map((count, i) => (
              <div key={i} className="chart-col" title={`${WEEKDAY_NAMES[i]}: ${count} händelser`}>
                <span className="chart-track">
                  <span className="chart-bar" style={{ height: `${(count / maxWeekday) * 100}%` }} />
                </span>
                <span className="chart-label">{WEEKDAY_NAMES[i]}</span>
              </div>
            ))}
          </div>
          {weekdayTotal > 0 && (
            <p className="chart-caption">
              Flest händelser inträffar på <strong>{WEEKDAY_LONG[peakWeekday]}</strong> —{' '}
              {stats.weekdays[peakWeekday].toLocaleString('sv-SE')} av de{' '}
              {weekdayTotal.toLocaleString('sv-SE')} senaste 30 dagarnas händelser.
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="card-title">Per timme, senaste dygnet</h2>
          <div className="chart chart--dense">
            {stats.hourly.map((count, hour) => (
              <div
                key={hour}
                className="chart-col"
                title={`${String(hour).padStart(2, '0')}:00 — ${count} händelser`}
              >
                <span className="chart-track">
                  <span className="chart-bar" style={{ height: `${(count / maxHourly) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
          <div className="chart-axis">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
          {hourlyTotal > 0 && (
            <p className="chart-caption">
              Flest händelser mellan{' '}
              <strong>
                kl {String(peakHour).padStart(2, '0')} och {String((peakHour + 1) % 24).padStart(2, '0')}
              </strong>{' '}
              — {stats.hourly[peakHour].toLocaleString('sv-SE')} av dygnets{' '}
              {hourlyTotal.toLocaleString('sv-SE')}.
            </p>
          )}
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2 className="card-title">Vanligaste händelsetyper</h2>
          <TopList rows={stats.topTypes} onSelect={onTypeClick} />
          <p className="chart-caption">Tryck på en typ för att se bara de händelserna i listan.</p>
        </div>
        <div className="card">
          <h2 className="card-title">Vanligaste platser</h2>
          <TopList rows={stats.topLocations} onSelect={onLocationClick} />
          <p className="chart-caption">Tryck på en plats för att se bara de händelserna i listan.</p>
        </div>
      </div>
    </section>
  );
}

export default memo(StatsView);
