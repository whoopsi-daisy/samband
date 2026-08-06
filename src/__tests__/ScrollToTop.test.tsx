import { act, render, screen, fireEvent } from '@testing-library/react';
import ScrollToTop from '@/components/ScrollToTop';

/**
 * Whether the control is showing used to be answered by a `scroll` listener that
 * called setState on every scroll event — hundreds of times per flick, to answer
 * a question with two possible answers, on the one code path that must stay
 * clear. It is an IntersectionObserver over a strip at the top of the page now,
 * which answers twice: on the way down and on the way back up.
 */

type Callback = (entries: IntersectionObserverEntry[]) => void;

let observed: Element[] = [];
let fire: Callback | null = null;
let disconnected = 0;

class FakeObserver {
  constructor(private callback: Callback) {
    fire = (entries) => this.callback(entries);
  }
  observe(element: Element) {
    observed.push(element);
  }
  disconnect() {
    disconnected++;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

/** Report the sentinel as on or off screen, as the browser would. */
function cross(isIntersecting: boolean) {
  act(() => {
    fire?.([{ isIntersecting } as IntersectionObserverEntry]);
  });
}

const button = () => screen.getByRole('button', { name: 'Scrolla till toppen' });

beforeEach(() => {
  observed = [];
  fire = null;
  disconnected = 0;
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
});

afterEach(() => {
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  jest.restoreAllMocks();
});

describe('when it is showing', () => {
  it('is hidden at the top of the page', () => {
    render(<ScrollToTop />);
    expect(button().className).not.toContain('visible');
  });

  it('appears once the reader has passed the mark, and goes again on the way back', () => {
    render(<ScrollToTop />);

    cross(false);
    expect(button().className).toContain('visible');

    cross(true);
    expect(button().className).not.toContain('visible');
  });

  it('adds no scroll listener to do it', () => {
    const add = jest.spyOn(window, 'addEventListener');
    render(<ScrollToTop />);
    expect(add.mock.calls.map(([type]) => type)).not.toContain('scroll');
  });

  it('watches a strip as tall as the distance it is waiting for', () => {
    const { container } = render(<ScrollToTop />);
    const sentinel = container.querySelector('.scroll-top-sentinel') as HTMLElement;

    expect(observed).toEqual([sentinel]);
    expect(sentinel.style.height).toBe('300px');
    // Decoration for the observer's benefit, not something to read or reach.
    expect(sentinel).toHaveAttribute('aria-hidden', 'true');
  });

  it('stops watching when it goes away', () => {
    const { unmount } = render(<ScrollToTop />);
    unmount();
    expect(disconnected).toBe(1);
  });

  /*
   * Being wrong in the safe direction: a reader can always get back to the top,
   * they just get an extra button on a page too short to need one.
   */
  it('stays available in a browser with no observer', () => {
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;

    render(<ScrollToTop />);
    expect(button().className).toContain('visible');
  });
});

describe('pressing it', () => {
  it('glides to the top, because this is a scroll the reader asked for', () => {
    const scrollTo = jest.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;

    render(<ScrollToTop />);
    fireEvent.click(button());

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
