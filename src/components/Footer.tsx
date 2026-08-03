'use client';

import Link from 'next/link';
import { useMounted } from '@/hooks/useMounted';

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
      {/* A feed of police notices, named after a dispatch centre, behind a
          mark of concentric rings, can be read as something the police run.
          One line, on every view, saying otherwise. */}
      <span className="footer-about">
        Inofficiell tjänst · källa{' '}
        <a href="https://polisen.se" target="_blank" rel="noopener noreferrer">
          polisen.se
        </a>{' '}
        · <Link href="/om">Om sidan</Link>
      </span>

      {/* The app has had keyboard shortcuts since it was built and has never
          said so anywhere. Shown only where there is a keyboard to press. */}
      <span className="footer-keys">
        <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> byter vy · <kbd>/</kbd> söker
      </span>
    </footer>
  );
}
