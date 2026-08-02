import { render, screen } from '@testing-library/react';
import StatsView from '@/components/StatsView';
import { Statistics } from '@/types';

function createStats(overrides: Partial<Statistics> = {}): Statistics {
  const thisYear = new Date().getFullYear();
  return {
    total: 1435,
    totalStored: 1435,
    last24h: 41,
    last7d: 283,
    last30d: 286,
    avgPerDay: 0.4,
    topTypes: [
      { label: 'Trafikolycka', total: 93 },
      { label: 'Narkotikabrott', total: 92 },
    ],
    topLocations: [
      { label: 'Stockholm', total: 291 },
      { label: 'Ljungby', total: 269 },
    ],
    hourly: Array.from({ length: 24 }, (_, i) => (i === 2 ? 9 : 1)),
    weekdays: [40, 40, 44, 41, 40, 40, 41],
    daily: [
      { date: '2026-07-23', day: 'Tor', count: 41 },
      { date: '2026-07-24', day: 'Fre', count: 40 },
      { date: '2026-07-25', day: 'Lör', count: 40 },
      { date: '2026-07-26', day: 'Sön', count: 41 },
      { date: '2026-07-27', day: 'Mån', count: 40 },
      { date: '2026-07-28', day: 'Tis', count: 40 },
      { date: '2026-07-29', day: 'Ons', count: 27 },
    ],
    yearly: [
      { year: String(thisYear - 2), count: 90 },
      { year: String(thisYear - 1), count: 107 },
      { year: String(thisYear), count: 336 },
    ],
    monthGrid: [
      {
        year: thisYear - 2,
        months: [5, 4, 6, 8, 9, 12, 14, 11, 7, 6, 5, 3],
        total: 90,
        running: false,
      },
      {
        year: thisYear - 1,
        months: [6, 5, 7, 9, 11, 14, 16, 13, 9, 7, 6, 4],
        total: 107,
        running: false,
      },
      {
        year: thisYear,
        months: [30, 28, 34, 40, 44, 52, 58, 50, null, null, null, null],
        total: 336,
        running: true,
      },
    ],
    season: {
      average: [6, 5, 7, 9, 10, 13, 15, 12, 8, 7, 6, 4],
      years: 2,
      busiestMonth: 6,
      quietestMonth: 11,
    },
    yearToDate: {
      year: thisYear,
      count: 336,
      previousYear: thisYear - 1,
      previousCount: 80,
      throughDay: '08-02',
    },
    familyByYear: [
      {
        year: String(thisYear - 2),
        total: 90,
        shares: [
          { family: 'traffic', label: 'Trafik', count: 50, share: 50 / 90 },
          { family: 'theft', label: 'Stöld och inbrott', count: 40, share: 40 / 90 },
        ],
      },
      {
        year: String(thisYear - 1),
        total: 107,
        shares: [
          { family: 'traffic', label: 'Trafik', count: 40, share: 40 / 107 },
          { family: 'theft', label: 'Stöld och inbrott', count: 67, share: 67 / 107 },
        ],
      },
    ],
    busiestDay: { date: '2026-07-23', count: 41 },
    coverageDays: 3870,
    gpsPercent: 90,
    updatedPercent: 5,
    uniqueLocations: 7,
    uniqueTypes: 21,
    oldestEvent: '2016-01-03T00:00:00.000Z',
    archiveEvents: 1135,
    archiveCutoff: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('StatsView', () => {
  // The page was nine tiles and six charts in the order they were written,
  // with nothing saying what any of it was for or over what period.
  it('groups the page into named blocks, each with its own period', () => {
    render(<StatsView stats={createStats()} />);

    const blocks = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    // Ordered from the last day out to the whole record. The two long-view
    // blocks are where nearly all of the data is: a decade used to arrive as
    // two sparklines at the bottom of the archive block.
    expect(blocks).toEqual([
      'Den senaste tiden',
      'När det händer',
      'Vad och var',
      'Månad för månad',
      'År för år',
      'Hela arkivet',
    ]);
  });

  it('keeps the chart titles a level below the block headings', () => {
    render(<StatsView stats={createStats()} />);

    expect(screen.getByRole('heading', { level: 3, name: /per dygn, senaste veckan/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /per timme, senaste dygnet/i })).toBeInTheDocument();
  });

  // "Senaste 24h" was the only label on the page still written in English
  // shorthand, next to six others in Swedish.
  it('labels the periods in Swedish', () => {
    render(<StatsView stats={createStats()} />);

    expect(screen.getByText('Senaste dygnet')).toBeInTheDocument();
    expect(screen.getByText('Senaste veckan')).toBeInTheDocument();
    expect(screen.queryByText(/24h/i)).not.toBeInTheDocument();
  });

  // Today's bar only counts the hours that have passed. Left as a weekday it
  // reads as a fall in incidents rather than as an unfinished day.
  it('marks the running day as incomplete', () => {
    render(<StatsView stats={createStats()} />);

    expect(screen.getByText('I dag')).toBeInTheDocument();
    expect(document.querySelector('.chart-bar--partial')).toBeInTheDocument();
  });

  // Same reason, one scale up: a four-month year is not comparable with the
  // finished years beside it.
  it('keeps the running year out of the yearly peak', () => {
    const thisYear = new Date().getFullYear();
    render(<StatsView stats={createStats()} />);

    const caption = screen.getByText(/störst helår/i);
    expect(caption).toHaveTextContent(String(thisYear - 1));
    expect(caption).not.toHaveTextContent(new RegExp(`Störst helår: ${thisYear}`));
  });

  it('puts the decade of history last, after the recent view', () => {
    render(<StatsView stats={createStats()} />);

    const headings = screen.getAllByRole('heading', { level: 2 });
    const recent = headings.findIndex((h) => h.textContent === 'Den senaste tiden');
    const archive = headings.findIndex((h) => h.textContent === 'Hela arkivet');
    expect(recent).toBeLessThan(archive);
  });

  it('says where the numbers come from when an archive is loaded', () => {
    render(<StatsView stats={createStats()} />);
    expect(screen.getByText(/importerade från Brottsplatskartan/i)).toBeInTheDocument();
  });

  it('says so when there is no archive at all', () => {
    render(<StatsView stats={createStats({ archiveEvents: 0, archiveCutoff: null })} />);
    expect(screen.getByText(/Inget arkiv är importerat/i)).toBeInTheDocument();
  });

  it('renders without a busiest day or a yearly series', () => {
    render(<StatsView stats={createStats({ busiestDay: null, yearly: [] })} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Hela arkivet' })).toBeInTheDocument();
    expect(screen.queryByText(/störst helår/i)).not.toBeInTheDocument();
  });
});
