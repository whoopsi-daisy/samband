'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

/** How far down the page the control appears, in pixels. */
const APPEARS_AFTER = 300;

/**
 * Back to the top of the feed, once there is a top to go back to.
 *
 * Whether it is showing used to be answered by a `scroll` listener that called
 * setState on every scroll event. React discards the ones that do not change
 * the boolean, but the handler still ran on the scroll path, hundreds of times
 * per flick, to answer a question with two possible answers. An
 * IntersectionObserver answers it twice: once when the reader passes the mark
 * and once when they come back up, and nothing at all in between.
 *
 * The sentinel is a `APPEARS_AFTER`-tall strip pinned to the top of the page and
 * positioned against the initial containing block, so "the reader has scrolled
 * past 300px" is exactly "the strip has left the viewport" — the same condition
 * the old handler tested, asked of the browser instead of of a number.
 */
export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // A browser without the observer keeps the control permanently available,
    // which is the safe way to be wrong about this: a reader can always get
    // back to the top, they just get an extra button on a short page.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => setVisible(!entries[entries.length - 1].isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <>
      {/* The height *is* the threshold, so it is set from the constant rather
          than restated in the stylesheet, which only pins it to the top. */}
      <div
        ref={sentinelRef}
        className="scroll-top-sentinel"
        style={{ height: APPEARS_AFTER }}
        aria-hidden="true"
      />
      <button
        className={`scroll-top${visible ? ' visible' : ''}`}
        type="button"
        aria-label="Scrolla till toppen"
        onClick={scrollToTop}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </>
  );
}
