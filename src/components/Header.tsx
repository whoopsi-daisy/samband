'use client';

import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import { VIEWS } from './views';

interface HeaderProps {
  currentView: string;
  onViewChange: (view: string) => void;
  onLogoClick?: () => void;
}

/**
 * Sticky 52px shell header: mark on the left, view nav and theme toggle on the
 * right. The bottom hairline appears only after the first pixel of scroll, via
 * a scroll-driven animation in the stylesheet: no scroll listener, and no
 * collapsing/compacting states.
 */
export default function Header({ currentView, onViewChange, onLogoClick }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link
          className="header-logo"
          href="/"
          onClick={(e) => {
            if (onLogoClick) {
              e.preventDefault();
              onLogoClick();
            }
          }}
          aria-label="Sambandscentralen, till startsidan"
        >
          <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="20" cy="20" r="13" strokeWidth="2.5" opacity="0.35" />
            <circle cx="20" cy="20" r="8" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="3.4" fill="currentColor" stroke="none" />
          </svg>
          <span>Sambandscentralen</span>
        </Link>
        <nav className="header-nav" aria-label="Vy-navigering">
          {VIEWS.map(({ id, label, icon }) => {
            const active = currentView === id;
            return (
              <button
                key={id}
                type="button"
                className={`header-nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onViewChange(id)}
              >
                {icon(16)}
                {label}
              </button>
            );
          })}
          <div className="header-utils">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  );
}
