'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
 *
 * What it says is largely true, which is the point. Three of the lines used to
 * be placeholders — "Position ...... någonstans i Sverige" — and a dispatch
 * centre answering a radio check with nothing checkable is a joke that only
 * lands once. It reports the time on the reader's own clock and the actual size
 * of the record it is watching instead, so finding it also tells you something
 * about the app you did not know.
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

/**
 * How many correct keys in before the arrows stop scrolling the page.
 *
 * Entering this used to send the reader to the bottom of the feed and back:
 * eight arrow presses on a scrollable document are eight scrolls, so the reward
 * for finding the sequence was arriving somewhere else on the page. Held off
 * until the second key so that an ordinary ArrowUp — someone reading with the
 * keyboard, which is most of the people who will ever press these — still does
 * what it is supposed to.
 */
const CLAIM_ARROWS_AFTER = 2;

/** Long enough to read the last line twice without being in the way. */
const CLOSE_AFTER_MS = 14_000;
const LINE_DELAY_MS = 550;

/** Whether a key is one of the four the page would otherwise scroll with. */
const isArrow = (key: string) => key.startsWith('Arrow');

/**
 * How much of the sequence the last few keys amount to.
 *
 * The longest run of recent keys that is a prefix of SEQUENCE, which is not the
 * same as "how many correct keys in a row": the sequence opens with two
 * identical presses, so it has to be able to re-enter itself part way.
 *
 * This was a counter that reset to 1 on a wrong key if that key was the first of
 * the sequence, with a comment saying that holding an arrow one press too long
 * should not lock you out. It half worked. Press ArrowUp three times and the
 * counter lands on 1, where the next key it wants is another ArrowUp — so the
 * ArrowDown that follows resets it to nothing and the sequence cannot be entered
 * at all until you stop and start over. Asking the question of the last ten keys
 * instead answers it correctly from any mis-start, for a loop over at most ten
 * strings per keypress.
 */
function progressOf(recent: readonly string[]): number {
  for (let length = Math.min(recent.length, SEQUENCE.length); length > 0; length--) {
    const tail = recent.slice(recent.length - length);
    if (tail.every((key, index) => key === SEQUENCE[index])) return length;
  }
  return 0;
}

/**
 * Module scope, so the hint below is printed once per page and not once per
 * mount. This component is inside the client app, which remounts on a hot
 * reload and in every test that renders the page.
 */
let hinted = false;

interface RadioCheckProps {
  /**
   * How many notices the app holds, and how far back they reach. Unfiltered
   * facts about the whole record, not about whatever the reader has narrowed to:
   * the transmission is the app saying what it is, and "Bevakar 4 notiser"
   * because someone searched for a word is not that.
   */
  watching?: number;
  coverageDays?: number;
}

/** The transmission, built when the channel opens so the clock is current. */
function transmission(watching: number, coverageDays: number): string[] {
  const clock = new Date().toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const years = Math.floor(coverageDays / 365);
  const reach =
    years >= 1
      ? `, ${years} år bakåt`
      : coverageDays >= 1
        ? `, ${coverageDays} dygn bakåt`
        : '';

  return [
    'Anrop mottaget. Klart och tydligt.',
    'Enhet ......... okänd, men välkommen',
    `Tid ........... ${clock} lokal tid`,
    watching > 0
      ? `Bevakar ....... ${watching.toLocaleString('sv-SE')} notiser${reach}`
      : 'Bevakar ....... väntar på första notisen',
    'Uppdrag ....... hålla ett öga på landet',
    'Klart slut.',
  ];
}

export default function RadioCheck({ watching = 0, coverageDays = 0 }: RadioCheckProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  /** The last SEQUENCE.length keys pressed outside a text field. */
  const recentRef = useRef<string[]>([]);

  const close = useCallback(() => setOpen(false), []);

  // The values the transmission reads, without making the key handler depend on
  // them: it is registered once for the life of the page.
  const factsRef = useRef({ watching, coverageDays });
  factsRef.current = { watching, coverageDays };

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
        recentRef.current = [];
        return;
      }

      const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      const recent = recentRef.current;
      recent.push(pressed);
      if (recent.length > SEQUENCE.length) recent.shift();

      const progress = progressOf(recent);

      // Far enough in that this is somebody entering the sequence rather than
      // somebody reading, so the page stays where they left it.
      if (progress >= CLAIM_ARROWS_AFTER && isArrow(pressed)) {
        event.preventDefault();
      }

      if (progress === SEQUENCE.length) {
        recentRef.current = [];
        setLines(transmission(factsRef.current.watching, factsRef.current.coverageDays));
        setShown(0);
        setOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /*
   * Said once, where the people who look for these things look.
   *
   * A ten-key sequence with nothing anywhere hinting at it is a feature written
   * for an audience of one. This is the cheapest hint that does not cost the
   * page anything: no pixel of the interface changes, and the only reader who
   * ever sees it went looking.
   */
  useEffect(() => {
    if (hinted) return;
    hinted = true;
    console.info(
      '%cSambandscentralen%c · ↑ ↑ ↓ ↓ ← → ← → B A för radioprov.',
      'font-weight:600',
      'font-weight:400'
    );
  }, []);

  // Print the transmission one line at a time. Anyone who has asked for less
  // motion gets the whole thing at once instead.
  useEffect(() => {
    if (!open) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      setShown(lines.length);
    } else {
      const timers = lines.map((_, index) =>
        setTimeout(() => setShown(index + 1), (index + 1) * LINE_DELAY_MS)
      );
      return () => timers.forEach(clearTimeout);
    }
  }, [open, lines]);

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

  const visible = useMemo(() => lines.slice(0, shown), [lines, shown]);

  if (!open) return null;

  return (
    <aside className="radio" role="status" aria-live="polite">
      <p className="radio-head">
        <span className="radio-beacon" aria-hidden="true" />
        Sambandscentralen · radioprov
      </p>
      <div className="radio-log">
        {visible.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <button type="button" className="radio-close" onClick={close}>
        Kvittera
      </button>
    </aside>
  );
}
