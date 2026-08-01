import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EventCard from '@/components/EventCard';
import { FormattedEvent } from '@/types';

function createEvent(overrides: Partial<FormattedEvent> = {}): FormattedEvent {
  return {
    id: 4711,
    datetime: '2026-07-16T08:53:00.000Z',
    name: '16 juli 08:53, Trafikolycka, Ljungby',
    summary: 'En personbil har kört av vägen.',
    url: '/aktuellt/handelser/2026/juli/16/4711/',
    type: 'Trafikolycka',
    location: 'Kronobergs län',
    place: 'Ljungby',
    gps: '56.83,13.94',
    color: '#3b82f6',
    emoji: '🚗',
    date: {
      day: '16',
      month: 'Jul',
      time: '08:53',
      relative: '2 timmar sedan',
      iso: '2026-07-16T08:53:00.000Z',
    },
    wasUpdated: false,
    updated: '',
    ...overrides,
  };
}

function mockDetails(paragraphs: string[]) {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ success: true, details: { content: paragraphs.join('\n\n') } }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.restoreAllMocks();
  // A default, so a card that fetches on mount always has something to settle
  // on. Without it a rejected mock leaks from one test into the next.
  mockDetails(['Hela texten.']);
});

describe('EventCard', () => {
  // polisen.se files a large share of the feed under a county and names the
  // municipality only in the notice's title. A row showing the county alone
  // cannot tell a reader whether something happened in their town.
  it('leads with the municipality and keeps the county within reach', () => {
    render(<EventCard event={createEvent()} />);

    // On the row: the municipality, which is the half that answers "is this
    // near me". The county rides in the tooltip rather than taking room on a
    // line the type and the time now share.
    const place = screen.getByText('Ljungby');
    expect(place).toHaveClass('event-place');
    expect(place).toHaveAttribute('title', 'Ljungby, Kronobergs län');
  });

  // Under "Igår" or "Tisdag 28 jul" every row would otherwise read "1 dag
  // sedan": a restatement of the heading it sits beneath, in place of the one
  // thing that heading cannot say.
  it('counts up from now only under today, and shows the clock otherwise', () => {
    // The relative string is recomputed against the real clock, so match its
    // shape rather than a value that goes stale the day this is run.
    const { container, rerender } = render(<EventCard event={createEvent()} isToday />);
    const time = () => container.querySelector('.event-time')!;

    expect(time().textContent).toMatch(/sedan$|^Just nu$/);

    rerender(<EventCard event={createEvent()} isToday={false} />);
    expect(time().textContent).toBe('08:53');
  });

  // Whichever it is not showing stays reachable.
  it('keeps the other reading of the time in the tooltip', () => {
    const { container, rerender } = render(<EventCard event={createEvent()} isToday={false} />);
    const time = () => container.querySelector('.event-time')!;

    expect(time().getAttribute('title')).toMatch(/sedan$|^Just nu$/);

    rerender(<EventCard event={createEvent()} isToday />);
    expect(time().getAttribute('title')).toBe('16 jul, 08:53');
  });

  it('shows the location once when there is nothing more specific to add', () => {
    render(<EventCard event={createEvent({ location: 'Stockholm', place: '' })} />);

    expect(screen.getByText('Stockholm')).toBeInTheDocument();
    expect(document.querySelector('.event-location-area')).toBeNull();
  });

  it('names the region it opens, so "expanded" refers to something', async () => {
    mockDetails(['Ett stycke.']);
    render(<EventCard event={createEvent()} />);

    const toggle = screen.getByRole('button', { expanded: false });
    // Nothing to point at while the detail is unmounted.
    expect(toggle).not.toHaveAttribute('aria-controls');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    await waitFor(() => expect(document.getElementById(controls!)).toBeInTheDocument());
  });

  // The body used to be capped at four paragraphs upstream, and the paragraphs
  // that did arrive were rendered without separation.
  it('renders every paragraph of the notice as its own paragraph', async () => {
    mockDetails(['Första stycket.', 'Andra stycket.', 'Tredje.', 'Fjärde.', 'Femte.', 'Sjätte.']);
    render(<EventCard event={createEvent()} />);

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    await waitFor(() => {
      expect(document.querySelectorAll('.event-detail-text')).toHaveLength(6);
    });
    expect(screen.getByText('Sjätte.')).toBeInTheDocument();
  });

  // polisen.se's summary is the opening of the notice, so the fetched text
  // almost always restates the teaser sitting a few pixels above it.
  it('drops the summary when the full text opens with it', async () => {
    const event = createEvent();
    mockDetails([`${event.summary} Föraren fördes till sjukhus.`, 'Utredning pågår.']);
    render(<EventCard event={event} />);

    expect(screen.getByText(event.summary)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    await waitFor(() => expect(screen.getByText('Utredning pågår.')).toBeInTheDocument());
    expect(screen.queryByText(event.summary)).not.toBeInTheDocument();
  });

  // The summary above is already the substance of the notice, so a failed
  // detail fetch is a footnote rather than an error banner.
  it('says the text could not be fetched without raising an alert', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    render(<EventCard event={createEvent()} />);

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    await waitFor(() => expect(screen.getByText(/kunde inte hämtas/i)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens already expanded when it is the deep-linked incident', async () => {
    mockDetails(['Hela texten.']);
    render(<EventCard event={createEvent()} isHighlighted />);

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Hela texten.')).toBeInTheDocument());
  });

  it('offers the map only when the incident has coordinates', async () => {
    const { rerender } = render(<EventCard event={createEvent()} isHighlighted onShowMap={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Hela texten.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /visa på karta/i })).toBeInTheDocument();

    rerender(<EventCard event={createEvent({ gps: '' })} isHighlighted onShowMap={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /visa på karta/i })).not.toBeInTheDocument();
  });

  // The archive reaches back to 2016. Counted in days that row would read
  // "3 214 dagar sedan", which is not a date anyone can picture.
  it('does not count a decade-old incident in days', async () => {
    const longAgo = new Date(Date.now() - 3214 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <EventCard
        event={createEvent({
          datetime: longAgo,
          date: { ...createEvent().date, iso: longAgo, relative: '8 år sedan' },
        })}
      />
    );

    await waitFor(() => expect(screen.getByText(/år sedan/)).toBeInTheDocument());
    expect(screen.queryByText(/\d{3,} dagar sedan/)).not.toBeInTheDocument();
  });
});

// A referrer would tell polisen.se which incident a reader came from and what
// they had filtered on, which is nobody's business but the reader's.
describe('external links', () => {
  it('sends no referrer to polisen.se', () => {
    render(<EventCard event={createEvent()} isHighlighted />);

    const link = screen.getByRole('link', { name: /läs hos polisen/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('https://polisen.se'));
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
