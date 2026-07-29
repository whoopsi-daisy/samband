'use client';

import { VmaAlert } from '@/types';

interface VmaRibbonProps {
  alerts: VmaAlert[];
  /** Open the VMA view. */
  onOpen: () => void;
}

/**
 * A live emergency warning, across the top of every view.
 *
 * Above the header, not inside it, and not dismissible. A VMA is issued when
 * there is an immediate danger to life or health, so it is the one thing on
 * this site allowed to interrupt: it should be the first thing on the page
 * whatever the reader came for, and it should still be there if they navigate.
 * It leaves as soon as SR says the warning is over, and not before.
 */
export default function VmaRibbon({ alerts, onOpen }: VmaRibbonProps) {
  if (alerts.length === 0) return null;

  const first = alerts[0];
  const rest = alerts.length - 1;
  // The headline is what SR wrote for exactly this purpose. Falling back to the
  // event type keeps the ribbon from ever being a bare icon with no words.
  const headline = first.headline || first.event || 'Viktigt meddelande till allmänheten';
  const where = first.areas.join(', ');

  return (
    <aside className="vma-ribbon" role="alert" aria-label="Viktigt meddelande till allmänheten">
      <div className="vma-ribbon-inner">
        <span className="vma-ribbon-tag">VMA</span>
        <p className="vma-ribbon-text">
          <strong>{headline}</strong>
          {where ? <span className="vma-ribbon-where">{where}</span> : null}
        </p>
        <button type="button" className="vma-ribbon-open" onClick={onOpen}>
          {rest > 0 ? `Läs mer (${alerts.length})` : 'Läs mer'}
        </button>
      </div>
    </aside>
  );
}
