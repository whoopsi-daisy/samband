'use client';

import { VIEWS } from './views';

interface BottomNavProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

/** Mobile-only tab bar. Hidden above 600px, where the header nav takes over. */
export default function BottomNav({ currentView, onViewChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Huvudnavigering">
      {VIEWS.map(({ id, label, icon }) => {
        const active = currentView === id;
        return (
          <button
            key={id}
            type="button"
            className={`bottom-nav-item${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onViewChange(id)}
          >
            <span className="bottom-nav-icon">{icon(22)}</span>
            <span className="bottom-nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
