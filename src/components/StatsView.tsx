'use client';

import { memo, ReactNode } from 'react';
import {
  Statistics,
  TYPE_FAMILIES,
  TypeFamilyKey,
  MonthGridRow,
  SeasonProfile,
  FamilyYear,
  YearToDate,
  getTypeStyle,
} from '@/types';
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

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTH_NAMES = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

/**
 * Ten years of monthly totals as a grid, one row per year.
 *
 * Drawn as a single strip of bars, a decade is a hairline per month and can
 * only be read for trend. Stacked into rows of twelve, the same numbers read
 * down the columns as well, which is where the seasons are, and a gap in the
 * record becomes a hole rather than two years that look adjacent.
 *
 * It is a real table. The colour is the fast read; the numbers underneath it
 * are the actual answer, and a screen reader gets those rather than a picture.
 */
function MonthHeatmap({ rows, season }: { rows: MonthGridRow[]; season: SeasonProfile }) {
  // The month in progress. Derived from the data rather than from the clock,
  // so the server and the browser cannot disagree about which cell it is: in
  // the running year it is simply the last month with a number in it.
  const runningRow = rows.findIndex((row) => row.running);
  const partialMonth =
    runningRow === -1 ? -1 : rows[runningRow].months.findLastIndex((m) => m !== null);

  const isPartial = (rowIndex: number, month: number) =>
    rowIndex === runningRow && month === partialMonth;

  // The scale ignores the month in progress. On the second of August it holds
  // two days, so it is always the smallest cell in the record, and anchoring
  // the ramp on it squeezed every real month into the top half of the scale.
  const observed = rows.flatMap((row, rowIndex) =>
    row.months.filter((m, month): m is number => m !== null && !isPartial(rowIndex, month))
  );
  if (observed.length === 0) return null;

  const low = Math.min(...observed);
  const high = Math.max(...observed);

  // Binned across the range actually observed, not from zero. Monthly volume
  // over a decade varies by maybe half, so a scale anchored at zero would put
  // every cell in the same shade and show nothing.
  const level = (count: number): number => {
    if (high === low) return 2;
    return Math.min(4, Math.floor(((count - low) / (high - low)) * 4) + 1);
  };

  // The season row is drawn as bars rather than as more heat cells. Sharing
  // the ramp but not the scale would invite reading a pale average cell
  // against a dark year cell and concluding the average year is quieter than
  // every real one; sharing the scale instead would flatten the season to two
  // shades and say nothing. A different mark is the only honest option.
  const seasonHigh = season.average.length > 0 ? Math.max(...season.average) : 1;

  return (
    <div className="heat-wrap">
      <table className="heat">
        <caption className="sr-only">
          Antal händelser per månad och år, från {rows[0].year} till {rows[rows.length - 1].year}.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="heat-corner">
              <span className="sr-only">År</span>
            </th>
            {MONTH_ABBR.map((month, index) => (
              <th key={month} scope="col" className="heat-month">
                <abbr title={MONTH_NAMES[index]}>{month}</abbr>
              </th>
            ))}
            <th scope="col" className="heat-total-head">
              Totalt
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.year}>
              <th scope="row" className="heat-year">
                {row.year}
              </th>
              {row.months.map((count, month) => {
                if (count === null) {
                  return (
                    <td key={month} className="heat-cell heat-cell--none">
                      <span className="sr-only">
                        {MONTH_NAMES[month]} {row.year}: utanför arkivet
                      </span>
                    </td>
                  );
                }
                // The month in progress is hatched. Shaded like the rest it
                // would read as a collapse every first of the month.
                const partial = isPartial(rowIndex, month);
                return (
                  <td
                    key={month}
                    className={`heat-cell heat-cell--${level(count)}${partial ? ' heat-cell--partial' : ''}`}
                    title={
                      partial
                        ? `${MONTH_NAMES[month]} ${row.year}: ${sv(count)} hittills, månaden pågår`
                        : `${MONTH_NAMES[month]} ${row.year}: ${sv(count)} händelser`
                    }
                  >
                    <span className="sr-only">
                      {MONTH_NAMES[month]} {row.year}: {sv(count)}
                      {partial ? ' hittills, månaden pågår' : ''}
                    </span>
                  </td>
                );
              })}
              <td className="heat-total">{sv(row.total)}</td>
            </tr>
          ))}
        </tbody>
        {/* The average year, along the bottom of the years it is drawn from.
            Reading a column of the grid gives the same answer, but only if you
            can hold ten cells in your head at once. */}
        {season.years >= 2 && (
          <tfoot>
            <tr>
              <th scope="row" className="heat-year heat-year--season">
                Snitt
              </th>
              {season.average.map((count, month) => (
                <td
                  key={month}
                  className="heat-season"
                  title={`${MONTH_NAMES[month]}: ${sv(count)} i snitt`}
                >
                  <span
                    className="heat-spark"
                    style={{ height: `${(count / seasonHigh) * 100}%` }}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {MONTH_NAMES[month]} i snitt: {sv(count)}
                  </span>
                </td>
              ))}
              <td className="heat-total heat-total--season">{season.years} år</td>
            </tr>
          </tfoot>
        )}
      </table>

      <p className="heat-legend">
        <span>{sv(low)}</span>
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={`heat-key heat-cell--${step}`} aria-hidden="true" />
        ))}
        <span>{sv(high)} per månad</span>
      </p>
    </div>
  );
}

/**
 * One horizontal bar per year, split by type family.
 *
 * Volume alone cannot say whether a decade changed character. The families
 * hold their order across every year, so a segment that widens or narrows is
 * following the same thing down the chart; ranked per year they would swap
 * places underneath the reader and the drift would be unreadable.
 */
function FamilyMix({ years }: { years: FamilyYear[] }) {
  // Enough to name every segment wide enough to notice. Cut shorter, the
  // reader is left with coloured bands at the end of each bar and no way to
  // find out what they are.
  const legend = years[years.length - 1].shares.slice(0, 10);

  return (
    <>
      <ul className="mix">
        {years.map((year) => (
          <li key={year.year} className="mix-row">
            <span className="mix-year">{year.year}</span>
            <span className="mix-track">
              {year.shares.map((share) => (
                <span
                  key={share.family}
                  className="mix-seg"
                  style={{
                    width: `${share.share * 100}%`,
                    background: TYPE_FAMILIES[share.family as TypeFamilyKey].color,
                  }}
                  title={`${year.year}, ${share.label}: ${sv(share.count)} (${Math.round(share.share * 100)} %)`}
                />
              ))}
            </span>
            <span className="mix-total">{sv(year.total)}</span>
          </li>
        ))}
      </ul>
      <ul className="mix-legend">
        {legend.map((share) => (
          <li key={share.family}>
            <span
              className="mix-key"
              style={{ background: TYPE_FAMILIES[share.family as TypeFamilyKey].color }}
              aria-hidden="true"
            />
            {share.label}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * This year against the same stretch of last year.
 *
 * Stated as a change rather than as two numbers to subtract, and always with
 * the date both sides are cut at: without that it reads as a full-year
 * comparison, which in March would be wrong by a factor of four.
 */
function YearOnYear({ ytd }: { ytd: YearToDate }) {
  const change = (ytd.count - ytd.previousCount) / ytd.previousCount;
  const percent = Math.round(Math.abs(change) * 100);
  // Under two percent on counts this size is noise, not a direction, and an
  // arrow drawn on noise is a claim the data does not support.
  const tone = percent < 2 ? 'flat' : change > 0 ? 'up' : 'down';
  const [month, day] = ytd.throughDay.split('-');

  return (
    <div className="yoy">
      <div className="yoy-side">
        <span className="yoy-value">{sv(ytd.count)}</span>
        <span className="yoy-label">
          {ytd.year} till {Number(day)}/{Number(month)}
        </span>
      </div>
      <div className={`yoy-change yoy-change--${tone}`}>
        <span className="yoy-arrow" aria-hidden="true">
          {tone === 'flat' ? '≈' : tone === 'up' ? '↑' : '↓'}
        </span>
        <span className="yoy-percent">
          {tone === 'flat' ? 'oförändrat' : `${change > 0 ? '+' : '−'}${percent} %`}
        </span>
      </div>
      <div className="yoy-side yoy-side--past">
        <span className="yoy-value">{sv(ytd.previousCount)}</span>
        <span className="yoy-label">{ytd.previousYear} samma period</span>
      </div>
    </div>
  );
}

function StatsView({ stats, onTypeClick, onLocationClick }: StatsViewProps) {
  const mounted = useMounted();
  const coverageDay = (iso: string) => (mounted ? formatDay(iso) : '–');

  const maxDaily = Math.max(...stats.daily.map((d) => d.count), 1);
  const maxWeekday = Math.max(...stats.weekdays, 1);
  const maxHourly = Math.max(...stats.hourly, 1);
  const maxYearly = Math.max(...stats.yearly.map((y) => y.count), 1);

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

      {/* The long view, which is where nearly all of the data is. It used to
          be one block at the bottom carrying two sparklines: 300,000 rows over
          a decade reduced to a footnote under three blocks about the last
          month. */}
      <Block
        title="Månad för månad"
        lede={
          stats.oldestEvent
            ? `Varje månad sedan ${coverageDay(stats.oldestEvent)}. Läs neråt för trenden, i sidled för året.`
            : 'Varje månad som finns lagrad.'
        }
      >
        {stats.monthGrid.length > 0 ? (
          <div className="card">
            <MonthHeatmap rows={stats.monthGrid} season={stats.season} />
            {stats.season.years >= 2 && stats.season.busiestMonth !== null && (
              <p className="chart-caption">
                Över {stats.season.years} hela år är{' '}
                <strong>{MONTH_NAMES[stats.season.busiestMonth]}</strong> den tyngsta månaden med{' '}
                {sv(stats.season.average[stats.season.busiestMonth])} händelser i snitt, och{' '}
                <strong>{MONTH_NAMES[stats.season.quietestMonth ?? 0]}</strong> den lugnaste med{' '}
                {sv(stats.season.average[stats.season.quietestMonth ?? 0])}.
              </p>
            )}
          </div>
        ) : (
          <p className="stats-coverage">Ingen månad är komplett ännu.</p>
        )}
      </Block>

      <Block
        title="År för år"
        lede="Om det blir fler eller färre över tid, och om det som händer är samma sorts händelser."
      >
        {stats.yearToDate && (
          <div className="card">
            <h3 className="card-title">I år mot i fjol</h3>
            {/* A running year is always short next to finished ones, so the
                year chart cannot answer this. Both sides are cut at the same
                day of the year instead. */}
            <YearOnYear ytd={stats.yearToDate} />
          </div>
        )}

        {stats.yearly.length > 1 && (
          <div className="card">
            <h3 className="card-title">Händelser per år</h3>
            <div className="chart">
              {stats.yearly.map((year) => (
                <div
                  key={year.year}
                  className="chart-col"
                  title={`${year.year}: ${sv(year.count)} händelser`}
                >
                  {/* Ten bars have room for their own numbers on a desktop.
                      A phone does not, and hides them: see chart-value--wide. */}
                  <span className="chart-value chart-value--wide">{sv(year.count)}</span>
                  <span className="chart-track">
                    <span
                      className={`chart-bar${year.year === thisYear ? ' chart-bar--partial' : ''}`}
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
                {runningYear ? ` ${thisYear} är inte slut och räknas inte med.` : ''}
              </p>
            )}
          </div>
        )}

        {stats.familyByYear.length > 1 && (
          <div className="card">
            <h3 className="card-title">Vad händelserna handlar om, år för år</h3>
            <FamilyMix years={stats.familyByYear} />
            <p className="chart-caption">
              Andel av varje års händelser. Staplarna är lika breda, så det är
              sammansättningen som jämförs och inte mängden.
            </p>
          </div>
        )}
      </Block>

      <Block
        title="Hela arkivet"
        lede="Vad databasen innehåller, och varifrån det kommer."
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

        <p className="stats-coverage">
          {stats.archiveEvents > 0 ? (
            <>
              {sv(stats.archiveEvents)} av händelserna är importerade från Brottsplatskartan
              {stats.archiveCutoff ? ` fram till ${coverageDay(stats.archiveCutoff)}` : ''}, resten
              kommer från polisens egen händelseström. {sv(stats.uniqueLocations)} platser och{' '}
              {sv(stats.uniqueTypes)} händelsetyper förekommer.{' '}
              {/* The two sources timestamp differently, and on a page that now
                  reads a decade it is worth saying so once. */}
              De importerade händelserna är daterade när de publicerades, inte när de inträffade,
              vilket kan flytta enstaka händelser till dygnet efter.
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
