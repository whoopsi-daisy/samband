import { act, fireEvent, render, screen } from '@testing-library/react';
import RadioCheck from '@/components/RadioCheck';

/**
 * The radio check, which is the app's one easter egg.
 *
 * Held to three things it was getting wrong, all of which a reader would notice
 * before they noticed the joke: entering the sequence used to scroll the page out
 * from under them, the transmission reported nothing that was actually true, and
 * two of the keys are letters, so it had to stay out of the search field.
 */

const SEQUENCE = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

/** Enter the sequence on the document, as someone finding it would. */
function enter(keys: string[] = SEQUENCE, target: Element = document.body) {
  for (const key of keys) fireEvent.keyDown(target, { key });
}

/** Let every line of the transmission print. */
function printAll() {
  act(() => {
    jest.advanceTimersByTime(6_000);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  // jsdom has no matchMedia. The transmission asks it whether to print line by
  // line or all at once; "no preference" is the path with the timers in it.
  window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('finding it', () => {
  it('stays out of the way until the sequence is entered', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);
    expect(screen.queryByText(/radioprov/i)).not.toBeInTheDocument();
  });

  it('answers the sequence', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);
    enter();
    expect(screen.getByText(/radioprov/i)).toBeInTheDocument();
  });

  it('ignores it while someone is typing, because two of the keys are letters', () => {
    render(
      <>
        <input aria-label="sök" />
        <RadioCheck watching={1} coverageDays={1} />
      </>
    );
    enter(SEQUENCE, screen.getByLabelText('sök'));
    expect(screen.queryByText(/radioprov/i)).not.toBeInTheDocument();
  });

  /*
   * The sequence opens with two identical presses, so holding the arrow a beat
   * too long is the most likely way to get it wrong. It used to be unrecoverable:
   * a third ArrowUp left the matcher expecting a fourth, and the ArrowDown that
   * followed reset it to nothing.
   */
  it('re-enters itself from a mis-start rather than locking you out', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);
    enter(['ArrowUp', 'ArrowUp', 'ArrowUp', ...SEQUENCE.slice(2)]);
    expect(screen.getByText(/radioprov/i)).toBeInTheDocument();
  });

  it('recovers after a wrong key, with no pause needed', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);
    enter(['ArrowUp', 'ArrowDown', 'x', ...SEQUENCE]);
    expect(screen.getByText(/radioprov/i)).toBeInTheDocument();
  });
});

/*
 * Eight arrow presses on a scrollable document are eight scrolls. The reward for
 * finding the sequence was arriving at the bottom of the feed, having lost the
 * place you were reading.
 */
describe('the page while the sequence is being entered', () => {
  it('is not scrolled out from under the reader', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);

    const prevented: boolean[] = [];
    for (const key of SEQUENCE) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      // Dispatched by hand rather than through fireEvent, which does not report
      // back whether the default was prevented.
      act(() => {
        document.body.dispatchEvent(event);
      });
      if (key.startsWith('Arrow')) prevented.push(event.defaultPrevented);
    }

    // Every arrow but the first: an ordinary ArrowUp from someone reading with
    // the keyboard still scrolls, which is most of the people who press one.
    expect(prevented[0]).toBe(false);
    expect(prevented.slice(1).every(Boolean)).toBe(true);
  });

  it('leaves an arrow alone when it is not part of the sequence', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
      bubbles: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('what it transmits', () => {
  it('reports the size of the record and how far back it reaches', () => {
    render(<RadioCheck watching={338214} coverageDays={3650} />);
    enter();
    printAll();

    expect(screen.getByText(/338\s?214 notiser/)).toBeInTheDocument();
    expect(screen.getByText(/10 år bakåt/)).toBeInTheDocument();
  });

  it('says so plainly rather than reporting a zero', () => {
    render(<RadioCheck watching={0} coverageDays={0} />);
    enter();
    printAll();

    expect(screen.getByText(/väntar på första notisen/)).toBeInTheDocument();
    expect(screen.queryByText(/0 notiser/)).not.toBeInTheDocument();
  });

  it('measures a young deployment in days rather than in nought years', () => {
    render(<RadioCheck watching={40} coverageDays={4} />);
    enter();
    printAll();

    expect(screen.getByText(/4 dygn bakåt/)).toBeInTheDocument();
    expect(screen.queryByText(/0 år/)).not.toBeInTheDocument();
  });

  it('reads the clock when the channel opens, not when the page loaded', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);

    jest.setSystemTime(new Date('2026-08-06T14:07:00Z'));
    enter();
    printAll();

    const expected = new Date('2026-08-06T14:07:00Z').toLocaleTimeString('sv-SE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(new RegExp(`${expected} lokal tid`))).toBeInTheDocument();
  });
});

describe('getting rid of it', () => {
  /*
   * Someone who opened the app to find out whether their street is on fire must
   * not have to dismiss a novelty first.
   */
  it('closes itself', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);
    enter();
    expect(screen.getByText(/radioprov/i)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    expect(screen.queryByText(/radioprov/i)).not.toBeInTheDocument();
  });

  it('closes on Escape and on the acknowledgement', () => {
    render(<RadioCheck watching={1} coverageDays={1} />);

    enter();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText(/radioprov/i)).not.toBeInTheDocument();

    enter();
    fireEvent.click(screen.getByRole('button', { name: 'Kvittera' }));
    expect(screen.queryByText(/radioprov/i)).not.toBeInTheDocument();
  });
});
