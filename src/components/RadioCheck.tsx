'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A radio check, for anyone who tries the old sequence.
 *
 * The app is named after a dispatch centre, so the reward for finding it is a
 * transmission back rather than a joke pasted over the page. It prints one line
 * at a time like a channel opening, and goes away on its own.
 *
 * Deliberately not a dialog: it takes no focus, traps nothing, blocks nothing.
 * Someone who came here to check whether their street is on fire must not have
 * to dismiss a novelty first, so it sits in a corner and closes itself.
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

const LINES = [
  'Anrop mottaget. Klart och tydligt.',
  'Enhet ......... okänd, men välkommen',
  'Position ...... någonstans i Sverige',
  'Uppdrag ....... hålla ett öga på landet',
  'Klart slut.',
];

/** Long enough to read the last line twice without being in the way. */
const CLOSE_AFTER_MS = 14_000;
const LINE_DELAY_MS = 550;

export default function RadioCheck() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const progressRef = useRef(0);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never while someone is typing: two of the keys are letters, and the
      // search field is the most-used control on the page.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        progressRef.current = 0;
        return;
      }

      const expected = SEQUENCE[progressRef.current];
      const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (pressed === expected) {
        progressRef.current += 1;
        if (progressRef.current === SEQUENCE.length) {
          progressRef.current = 0;
          setShown(0);
          setOpen(true);
        }
        return;
      }

      // A wrong key restarts, except when it is the first key of the sequence
      // again: holding the arrow one press too long should not lock you out.
      progressRef.current = pressed === SEQUENCE[0] ? 1 : 0;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Print the transmission one line at a time. Anyone who has asked for less
  // motion gets the whole thing at once instead.
  useEffect(() => {
    if (!open) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      setShown(LINES.length);
    } else {
      const timers = LINES.map((_, index) =>
        setTimeout(() => setShown(index + 1), (index + 1) * LINE_DELAY_MS)
      );
      return () => timers.forEach(clearTimeout);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(close, CLOSE_AFTER_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <aside className="radio" role="status" aria-live="polite">
      <p className="radio-head">
        <span className="radio-beacon" aria-hidden="true" />
        Sambandscentralen · radioprov
      </p>
      <div className="radio-log">
        {LINES.slice(0, shown).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <button type="button" className="radio-close" onClick={close}>
        Kvittera
      </button>
    </aside>
  );
}
