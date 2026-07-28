'use client';

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
      <span className="footer-dot" aria-hidden="true" />
      <span>
        Uppdaterad{' '}
        {mounted ? lastChecked.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
      </span>
      <span>
        Data från{' '}
        <a href="https://polisen.se/aktuellt/handelser/" target="_blank" rel="noopener noreferrer">
          polisen.se
        </a>
      </span>
    </footer>
  );
}
