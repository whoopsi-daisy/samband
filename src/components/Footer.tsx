'use client';

import { useMounted } from '@/hooks/useMounted';

interface FooterProps {
  lastChecked: Date;
}

export default function Footer({ lastChecked }: FooterProps) {
  // `lastChecked` starts as `new Date()`, so the server and the browser format
  // different clock values (different instant, and often a different timezone).
  // Show it only once mounted; before that the markup is stable.
  const mounted = useMounted();

  return (
    <footer>
      <div className="footer-status">
        <div className="status-counts">
          <span className="count-item count-item--checked">
            <span className="last-checked-dot" />
            Senast uppdaterad: <span className="count-value">{mounted ? lastChecked.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
