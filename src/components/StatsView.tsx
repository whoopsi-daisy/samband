'use client';

import { memo, ReactNode } from 'react';
import { Statistics, getTypeStyle } from '@/types';
import { useMounted } from '@/hooks/useMounted';

interface StatsViewProps {
  stats: Statistics;
  onTypeClick?: (type: string) => void;
  onLocationClick?: (location: string) => void;
}

const WEEKDAY_NAMES = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

// Date only: these are coverage boundaries, not timestamps, so the time of
// day is noise. Rendered against the viewer's clock, so it only produces
// stable markup after mount (see the `mounted` gate below).
function formatDay(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '–' : date.toLocaleDateString('sv-SE');
}

const sv = (value: number) => value.toLocaleString('sv-SE');

/**
 * One question the page answers, with the charts that answer it.
 *
 * The page used to be a wall: nine tiles, then six charts, in no order beyond
 * the one they were written in, so a reader had to work out for themselves what
 * any of it was for. Each block now says what it is looking at and over what
 * period, and they run from the last day out to the whole archive.
 */
function Block({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <section className="stats-block">
      <div className="stats-block-head">
        <h2>{title}</h2>
        <p>{lede}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * How far back the data reaches, in a unit that suits the distance.
 *
 * This was always years to one decimal, which reads "0,0 års historik" beside
 * "140 händelser totalt" on any install where the archive has not been imported
 * yet: a tile claiming there is no history next to one counting it. The feed's
 * own relative times already step through their units for the same reason.
 */
function coverageSpan(days: number): { value: string; label: string } {
  const whole = Math.max(0, Math.round(days));
  // "1 dygns historik" and "5 dygns historik": the genitive does not inflect.
  if (whole < 60) return { value: sv(whole), label: 'Dygns historik' };
  const months = Math.round(days / 30.44);
  if (months < 24) return { value: sv(months), label: 'Månaders historik' };
  return { value: (days / 365.25).toFixed(1).replace('.', ','), label: 'Års historik' };
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  );
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
              <span className="top-count">{sv(row.total)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function peakIndex(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function StatsView({ stats, onTypeClick, onLocationClick }: StatsViewProps) {
  const mounted = useMounted();
  const coverageDay = (iso: string) => (mounted ? formatDay(iso) : '–');

  const maxDaily = Math.max(...stats.daily.map((d) => d.count), 1);
  const maxWeekday = Math.max(...stats.weekdays, 1);
  const maxHourly = Math.max(...stats.hourly, 1);
  const maxYearly = Math.max(...stats.yearly.map((y) => y.count), 1);
  const maxMonthly = Math.max(...stats.monthly.map((m) => m.count), 1);

  const peakHour = peakIndex(stats.hourly);
  const hourlyTotal = stats.hourly.reduce((a, b) => a + b, 0);

  // The running year is only a few months long, so its bar is short for a
  // reason that has nothing to do with how much happened. Comparing it with the
  // finished years beside it would be comparing two different things, so it is
  // kept out of the peak and noted on its own.
  const thisYear = String(new Date().getFullYear());
  const peakYear = stats.yearly
    .filter((year) => year.year !== thisYear)
    .reduce<{ year: string; count: number } | null>(
      (best, year) => (!best || year.count > best.count ? year : best),
      null
    );
  const runningYear = stats.yearly.find((year) => year.year === thisYear) ?? null;
  const coverage = coverageSpan(stats.coverageDays);

  return (
    <>
      <Block
        title="Den senaste tiden"
        lede="Hur mycket som kommer in just nu, och hur det senaste dygnet står sig mot veckan före."
      >
        <div className="stats-grid stats-grid--three">
          <Stat value={sv(stats.last24h)} label="Senaste dygnet" />
          <Stat value={sv(stats.last7d)} label="Senaste veckan" />
          <Stat value={sv(stats.last30d)} label="Senaste 30 dygnen" />
        </div>

        <div className="card">
          <h3 className="card-title">Per dygn, senaste veckan</h3>
          <div className="chart">
            {stats.daily.map((day, i) => {
              // The last bar is today, which is only as long as the day has
              // been. Left as a weekday it reads as a drop in incidents.
              const today = i === stats.daily.length - 1;
              return (
                <div key={day.date} className="chart-col" title={`${day.date}: ${day.count} händelser`}>
                  <span className="chart-value">{day.count}</span>
                  <span className="chart-track">
                    <span
                      className={`chart-bar${today ? ' chart-bar--partial' : ''}`}
                      style={{ height: `${(day.count / maxDaily) * 100}%` }}
                    />
                  </span>
                  <span className="chart-label">{today ? 'I dag' : day.day}</span>
                </div>
              );
            })}
          </div>
          <p className="chart-caption">Dagens stapel räknar bara timmarna som gått hittills.</p>
        </div>
      </Block>

      <Block
        title="När det händer"
        lede="Samma händelser lagda på veckan och på dygnet, för att se när polisen har som mest att göra."
      >
        <div className="card-grid">
          <div className="card">
            <h3 className="card-title">Per veckodag, senaste 30 dygnen</h3>
            <div className="chart">
              {stats.weekdays.map((count, i) => (
                <div key={i} className="chart-col" title={`${WEEKDAY_NAMES[i]}: ${count} händelser`}>
                  {/* Seven bars have room for their own numbers, which says
                      more than a sentence underneath restating the tallest. */}
                  <span className="chart-value">{count}</span>
                  <span className="chart-track">
                    <span className="chart-bar" style={{ height: `${(count / maxWeekday) * 100}%` }} />
                  </span>
                  <span className="chart-label">{WEEKDAY_NAMES[i]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Per timme, senaste dygnet</h3>
            <div className="chart chart--dense">
              {stats.hourly.map((count, hour) => (
                <div
                  key={hour}
                  className="chart-col"
                  title={`kl ${String(hour).padStart(2, '0')}: ${count} händelser`}
                >
                  <span className="chart-track">
                    <span className="chart-bar" style={{ height: `${(count / maxHourly) * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>
            <div className="chart-axis">
              <span>kl 00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
            {/* Twenty-four bars have no room for numbers and a phone has no
                hover, so this line is the only place the values are readable. */}
            {hourlyTotal > 0 && (
              <p className="chart-caption">
                Mest mellan{' '}
                <strong>
                  kl {String(peakHour).padStart(2, '0')} och{' '}
                  {String((peakHour + 1) % 24).padStart(2, '0')}
                </strong>
                , {sv(stats.hourly[peakHour])} av dygnets {sv(hourlyTotal)}.
              </p>
            )}
          </div>
        </div>
      </Block>

      <Block
        title="Vad och var"
        lede="De vanligaste händelsetyperna och platserna. Tryck på en rad för att filtrera flödet på den."
      >
        <div className="card-grid">
          <div className="card">
            <h3 className="card-title">Vanligaste händelsetyper</h3>
            <TopList rows={stats.topTypes} onSelect={onTypeClick} withEmoji />
          </div>
          <div className="card">
            <h3 className="card-title">Vanligaste platser</h3>
            <TopList rows={stats.topLocations} onSelect={onLocationClick} />
          </div>
        </div>
      </Block>

      {/* Last, and framed as what the database holds rather than as analysis.
          The year and month charts cover a decade of imported history, which
          says something about the archive and very little about this week. */}
      <Block
        title="Hela arkivet"
        lede={
          stats.oldestEvent
            ? `Allt som är lagrat, från ${coverageDay(stats.oldestEvent)} och framåt.`
            : 'Allt som är lagrat.'
        }
      >
        <div className="stats-grid stats-grid--four">
          <Stat value={sv(stats.total)} label="Händelser totalt" />
          <Stat value={coverage.value} label={coverage.label} />
          <Stat value={sv(stats.avgPerDay)} label="Snitt per dygn" />
          {stats.busiestDay ? (
            <Stat
              value={sv(stats.busiestDay.count)}
              label="Flest på ett dygn"
              note={coverageDay(stats.busiestDay.date)}
            />
          ) : (
            <Stat value={sv(stats.uniqueLocations)} label="Unika platser" />
          )}
        </div>

        {stats.monthly.some((month) => month.count > 0) && (
          <div className="card">
            <h3 className="card-title">Per månad, senaste 24 månaderna</h3>
            <div className="chart chart--sm">
              {stats.monthly.map((month) => (
                <div
                  key={month.month}
                  className="chart-col"
                  title={`${month.label} ${month.year}: ${sv(month.count)} händelser`}
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

        {stats.yearly.length > 1 && (
          <div className="card">
            <h3 className="card-title">Per år</h3>
            <div className="chart chart--sm">
              {stats.yearly.map((year) => (
                <div
                  key={year.year}
                  className="chart-col"
                  title={`${year.year}: ${sv(year.count)} händelser`}
                >
                  <span className="chart-track">
                    <span
                      className="chart-bar"
                      style={{ height: `${(year.count / maxYearly) * 100}%` }}
                    />
                  </span>
                  <span className="chart-label">{year.year.slice(2)}</span>
                </div>
              ))}
            </div>
            {peakYear && (
              <p className="chart-caption">
                Störst helår: <strong>{peakYear.year}</strong> med {sv(peakYear.count)} händelser.
                {runningYear ? ` ${thisYear} har hittills ${sv(runningYear.count)}.` : ''}
              </p>
            )}
          </div>
        )}

        <p className="stats-coverage">
          {stats.archiveEvents > 0 ? (
            <>
              {sv(stats.archiveEvents)} av händelserna är importerade från Brottsplatskartan
              {stats.archiveCutoff ? ` fram till ${coverageDay(stats.archiveCutoff)}` : ''}, resten
              kommer från polisens egen händelseström. {sv(stats.uniqueLocations)} platser och{' '}
              {sv(stats.uniqueTypes)} händelsetyper förekommer.
            </>
          ) : (
            <>
              Endast polisens egen händelseström. Inget arkiv är importerat.{' '}
              {sv(stats.uniqueLocations)} platser och {sv(stats.uniqueTypes)} händelsetyper
              förekommer.
            </>
          )}
        </p>
      </Block>
    </>
  );
}

export default memo(StatsView);
