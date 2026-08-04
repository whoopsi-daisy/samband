'use client';

import { useMounted } from '@/hooks/useMounted';
import { VIEWS } from './views';

interface FooterProps {
  lastChecked: Date;
}

export default function Footer({ lastChecked }: FooterProps) {
  // `lastChecked` starts as `new Date()`, so the server and the browser format
  // different clock values. Show it only once mounted; before that the markup
  // is stable.
  const mounted = useMounted();

  return (
    <footer className="site-footer">
      <span className="dot dot--sm dot--ok" aria-hidden="true" />
      <span>
        Uppdaterad{' '}
        {mounted ? lastChecked.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
      </span>
      {/* The app has had keyboard shortcuts since it was built and has never
          said so anywhere. Shown only where there is a keyboard to press.
          Counted off the nav rather than written out: it said "1 2 3" for a
          four-view nav, and the missing key was VMA's. */}
      <span className="footer-keys">
        <kbd>1</kbd>–<kbd>{VIEWS.length}</kbd> byter vy · <kbd>/</kbd> söker
      </span>
    </footer>
  );
}
