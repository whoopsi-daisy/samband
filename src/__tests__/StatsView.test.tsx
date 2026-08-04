import { render, screen, fireEvent } from '@testing-library/react';
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
    regions: {
      rows: [
        { county: 'Stockholms län', total: 291, share: 0.52, recent: 140, previous: 120, change: 0.1667 },
        { county: 'Kronobergs län', total: 269, share: 0.48, recent: 130, previous: 150, change: -0.1333 },
      ],
      unplaced: 875,
      placed: 560,
      trendFrom: '2025-08',
    },
    regionTypes: {
      types: ['Trafikolycka', 'Narkotikabrott'],
      cells: {
        // Trafik follows the population, narkotika does not: Kronoberg holds
        // more of it than Stockholm despite being the smaller county overall.
        // That contrast is what the control exists to surface.
        'Stockholms län': { Trafikolycka: [80, 40, 30], Narkotikabrott: [20, 10, 12] },
        'Kronobergs län': { Trafikolycka: [13, 6, 5], Narkotikabrott: [72, 35, 40] },
      },
      unplaced: { Trafikolycka: 4, Narkotikabrott: 9 },
      recentStart: '2025-08',
    },
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
      'Sverige den senaste tiden',
      'När det händer',
      'Vad och var',
      'Län för län',
      'Månad för månad',
      'År för år',
      'Om siffrorna',
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
    const recent = headings.findIndex((h) => h.textContent === 'Sverige den senaste tiden');
    const years = headings.findIndex((h) => h.textContent === 'År för år');
    expect(recent).toBeLessThan(years);
  });

  // The archive is dated by publication, not by occurrence, which is the one
  // thing on this page a reader cannot work out from the charts. The counting
  // that used to open this paragraph was inventory: three numbers to read past
  // before reaching the part that changes how the charts should be read.
  it('keeps the caveat about the archive and drops the inventory', () => {
    render(<StatsView stats={createStats()} />);

    expect(screen.getByText(/daterade när de publicerades/i)).toBeInTheDocument();
    expect(screen.getByText(/En notis är inte samma sak som ett brott/i)).toBeInTheDocument();
    expect(screen.queryByText(/importerade från Brottsplatskartan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/händelsetyper förekommer/i)).not.toBeInTheDocument();
  });

  // "Vanligaste platser" answers "is my own town in here". It cannot answer
  // "what does Sweden look like", because its rows are a mix of municipalities,
  // counties and districts with no shared denominator.
  describe('län för län', () => {
    it('names every county and how much of the record it holds', () => {
      render(<StatsView stats={createStats()} />);

      // Without "län": the column is headed with it, and repeating it on
      // twenty-one rows is a column of the same word.
      expect(screen.getByRole('rowheader', { name: /Stockholms/ })).toBeInTheDocument();
      expect(screen.getByRole('rowheader', { name: /Kronobergs/ })).toBeInTheDocument();
      expect(screen.getByText('52,0 %')).toBeInTheDocument();
    });

    it('shows which way each county has gone against the year before', () => {
      render(<StatsView stats={createStats()} />);

      expect(screen.getByText('+17 %')).toBeInTheDocument();
      expect(screen.getByText('−13 %')).toBeInTheDocument();
    });

    // Shares that do not say what they are shares of are the easiest number on
    // a page to quote wrongly.
    it('says what the shares are shares of', () => {
      render(<StatsView stats={createStats()} />);

      expect(screen.getByText(/560 notiser som går att placera/)).toBeInTheDocument();
      expect(screen.getByText(/875 till saknar en plats/)).toBeInTheDocument();
    });

    /*
     * The rows are filters now.
     *
     * They deliberately were not: the feed matched the place string on the
     * notice, and no notice is labelled "Västra Götalands län" unless an
     * officer wrote exactly that, so a clickable row would have returned a
     * fraction of what it had just counted. The county is a resolved, indexed
     * column on both tables now, so the row can mean what it looks like.
     */
    it('lets a county row filter the feed', () => {
      const onCountyClick = jest.fn();
      render(<StatsView stats={createStats()} onCountyClick={onCountyClick} />);

      const row = screen.getByRole('button', { name: /Visa händelser i Stockholms län/ });
      fireEvent.click(row);

      // The canonical name, not the shortened label the cell displays: that is
      // what the filter matches against.
      expect(onCountyClick).toHaveBeenCalledWith('Stockholms län');
    });

    /*
     * The control that makes the block worth having.
     *
     * Unfiltered, the map is close to a population map and says so in its own
     * note. Narrowed to one type it can show something the population does not
     * predict, which is the thing markers on the incident map cannot show.
     */
    it('narrows the map and the table to one type of notice', () => {
      render(<StatsView stats={createStats()} />);

      // Stockholm leads the whole record.
      expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Stockholms');

      fireEvent.change(screen.getByLabelText('Händelsetyp'), {
        target: { value: 'Narkotikabrott' },
      });

      // Under this type it does not, which is the finding.
      expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Kronobergs');
    });

    // Shares of the whole record would leave a filtered table summing to a few
    // per cent, with every county at the bottom of the colour scale.
    it('restates the shares against the selected type', () => {
      render(<StatsView stats={createStats()} />);

      fireEvent.change(screen.getByLabelText('Händelsetyp'), {
        target: { value: 'Narkotikabrott' },
      });

      // 72 + 20 placed, not the 560 of the whole record.
      expect(screen.getByText(/92 notiser om narkotikabrott/)).toBeInTheDocument();
      expect(screen.getByText(/9 till saknar en plats/)).toBeInTheDocument();
      expect(screen.queryByText(/560 notiser/)).not.toBeInTheDocument();
    });

    it('goes back to the whole record', () => {
      render(<StatsView stats={createStats()} />);
      const select = screen.getByLabelText('Händelsetyp');

      fireEvent.change(select, { target: { value: 'Narkotikabrott' } });
      fireEvent.change(select, { target: { value: '' } });

      expect(screen.getByText(/560 notiser som går att placera/)).toBeInTheDocument();
    });

    // A type with a handful of notices spread over twenty-one counties is four
    // shades of noise, so the cube leaves it out and the control must not
    // invent an entry for it.
    it('offers only the types the breakdown carries', () => {
      render(<StatsView stats={createStats()} />);

      const options = screen
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);
      expect(options).toEqual(['', 'Trafikolycka', 'Narkotikabrott']);
    });

    it('leaves the control out entirely when no type has enough behind it', () => {
      render(
        <StatsView
          stats={createStats({
            regionTypes: { types: [], cells: {}, unplaced: {}, recentStart: '2025-08' },
          })}
        />
      );

      expect(screen.queryByLabelText('Händelsetyp')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Län för län' })).toBeInTheDocument();
    });

    it('stays away with nothing to break down', () => {
      render(
        <StatsView
          stats={createStats({ regions: { rows: [], unplaced: 0, placed: 0, trendFrom: null } })}
        />
      );

      expect(screen.queryByRole('heading', { level: 2, name: 'Län för län' })).not.toBeInTheDocument();
    });

    it('drops the trend column when there is no earlier year to compare', () => {
      render(
        <StatsView
          stats={createStats({
            regions: {
              rows: [
                { county: 'Skåne län', total: 40, share: 0.7, recent: 40, previous: 0, change: null },
                { county: 'Hallands län', total: 17, share: 0.3, recent: 17, previous: 0, change: null },
              ],
              unplaced: 0,
              placed: 57,
              trendFrom: null,
            },
          })}
        />
      );

      expect(screen.queryByRole('columnheader', { name: /mot i fjol/i })).not.toBeInTheDocument();
    });
  });

  // How many notices are stored is not what anyone came for, and an exact
  // six-figure number invites being quoted as if it were a measurement.
  it('states the grand total as a floor, not a count', () => {
    render(<StatsView stats={createStats({ total: 337174 })} />);

    expect(screen.getByText(/300 000\+ stycken/)).toBeInTheDocument();
    expect(screen.queryByText(/337 174/)).not.toBeInTheDocument();
  });

  it('still counts exactly on a small database', () => {
    render(<StatsView stats={createStats({ total: 412 })} />);
    expect(screen.getByText(/412 stycken/)).toBeInTheDocument();
  });

  // The page used to announce that no archive had been imported, which is a
  // fact about the operator's database and means nothing to a reader.
  it('says nothing about what has or has not been imported', () => {
    render(<StatsView stats={createStats({ archiveEvents: 0, archiveCutoff: null })} />);

    expect(screen.queryByText(/arkiv/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/importerad/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/databas/i)).not.toBeInTheDocument();
  });

  it('renders without a busiest day or a yearly series', () => {
    render(<StatsView stats={createStats({ busiestDay: null, yearly: [] })} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Om siffrorna' })).toBeInTheDocument();
    expect(screen.queryByText(/störst helår/i)).not.toBeInTheDocument();
  });
});
