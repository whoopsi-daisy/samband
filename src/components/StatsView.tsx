'use client';

import { memo } from 'react';
import { Statistics, getTypeStyle } from '@/types';
import { useMounted } from '@/hooks/useMounted';

interface StatsViewProps {
  stats: Statistics;
  onTypeClick?: (type: string) => void;
  onLocationClick?: (location: string) => void;
}

const WEEKDAY_NAMES = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const WEEKDAY_LONG = ['måndagar', 'tisdagar', 'onsdagar', 'torsdagar', 'fredagar', 'lördagar', 'söndagar'];

// Date only: these are coverage boundaries, not timestamps, so the time of
// day is noise. Rendered against the viewer's clock, so it only produces
// stable markup after mount (see the `mounted` gate below).
function formatDay(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '–' : date.toLocaleDateString('sv-SE');
}

function TopList({
  rows,
  onSelect,
  withEmoji = false,
}: {
  rows: { label: string; total: number }[];
  onSelect?: (label: string) => void;
  /** Incident types carry their emoji here too, so the same row of the same
      list reads the same way as it does in the feed and on the map. */
  withEmoji?: boolean;
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
              <span className="top-name">
                {withEmoji && (
                  <span className="badge-emoji" aria-hidden="true">
                    {getTypeStyle(row.label).emoji}
                  </span>
                )}
                <span className="top-name-text">{row.label}</span>
              </span>
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

// Which entry of a series is the tallest: the one sentence each chart exists
// to say. A phone has no hover, so without it the weekday and hour charts are
// shapes with no readable value anywhere on them.
function peakIndex(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function StatsView({ stats, onTypeClick, onLocationClick }: StatsViewProps) {
  const mounted = useMounted();
  const coverageDay = (iso: string) => (mounted ? formatDay(iso) : '–');
  const maxDaily = Math.max(...stats.daily.map((d) => d.count), 1);
  const maxYearly = Math.max(...stats.yearly.map((y) => y.count), 1);
  const maxMonthly = Math.max(...stats.monthly.map((m) => m.count), 1);

  // The running year is only a few months long, so its bar is short for a
  // reason that has nothing to do with how much happened, and comparing it
  // with the finished years beside it would be comparing two different things.
  // It is excluded from the peak and called out on its own instead.
  const thisYear = String(new Date().getFullYear());
  const completeYears = stats.yearly.filter((year) => year.year !== thisYear);
  const peakYear = completeYears.reduce<{ year: string; count: number } | null>(
    (best, year) => (!best || year.count > best.count ? year : best),
    null
  );
  const runningYear = stats.yearly.find((year) => year.year === thisYear) ?? null;
  const maxWeekday = Math.max(...stats.weekdays, 1);
  const maxHourly = Math.max(...stats.hourly, 1);

  const coveredYears = (stats.coverageDays / 365.25).toFixed(1).replace('.', ',');
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
        {stats.busiestDay && (
          <div className="stat">
            <span className="stat-value">{stats.busiestDay.count.toLocaleString('sv-SE')}</span>
            <span className="stat-label">Mest på ett dygn</span>
            <span className="stat-note">{coverageDay(stats.busiestDay.date)}</span>
          </div>
        )}
        {stats.coverageDays > 0 && (
          <div className="stat">
            <span className="stat-value">{coveredYears}</span>
            <span className="stat-label">År med data</span>
          </div>
        )}
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
          <>Endast polisens egen händelseström. Inget arkiv är importerat.</>
        )}
      </p>

      {/* The long view. Everything below the tiles used to look back a week or a
          month, which is the wrong shape for a database holding ten years: a
          reader could not see when the archive starts, whether the volume is
          rising or falling, or that anything happened before last Tuesday. */}
      {stats.yearly.length > 1 && (
        <div className="card">
          <h2 className="card-title">Antal händelser per år</h2>
          <div className="chart">
            {stats.yearly.map((year) => (
              <div
                key={year.year}
                className="chart-col"
                title={`${year.year}: ${year.count.toLocaleString('sv-SE')} händelser`}
              >
                <span className="chart-track">
                  <span className="chart-bar" style={{ height: `${(year.count / maxYearly) * 100}%` }} />
                </span>
                <span className="chart-label">{year.year.slice(2)}</span>
              </div>
            ))}
          </div>
          {peakYear && (
            <p className="chart-caption">
              Flest under ett helt år: <strong>{peakYear.year}</strong> med{' '}
              {peakYear.count.toLocaleString('sv-SE')} händelser.{' '}
              {runningYear
                ? `${thisYear} har hittills ${runningYear.count.toLocaleString('sv-SE')} och är inte färdigt.`
                : ''}
            </p>
          )}
        </div>
      )}

      {stats.monthly.some((month) => month.count > 0) && (
        <div className="card">
          <h2 className="card-title">Per månad, senaste två åren</h2>
          <div className="chart chart--sm">
            {stats.monthly.map((month) => (
              <div
                key={month.month}
                className="chart-col"
                title={`${month.label} ${month.year}: ${month.count.toLocaleString('sv-SE')} händelser`}
              >
                <span className="chart-track">
                  <span
                    className="chart-bar"
                    style={{ height: `${(month.count / maxMonthly) * 100}%` }}
                  />
                </span>
                {/* Only January carries a label, so the axis reads as years
                    rather than as twenty-four crushed month abbreviations. */}
                <span className="chart-label">{month.label === 'jan' ? month.year : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
              Flest händelser inträffar på <strong>{WEEKDAY_LONG[peakWeekday]}</strong>:{' '}
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
                title={`kl ${String(hour).padStart(2, '0')}, ${count} händelser`}
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
              med {stats.hourly[peakHour].toLocaleString('sv-SE')} av dygnets{' '}
              {hourlyTotal.toLocaleString('sv-SE')}.
            </p>
          )}
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2 className="card-title">Vanligaste händelsetyper</h2>
          <TopList rows={stats.topTypes} onSelect={onTypeClick} withEmoji />
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
