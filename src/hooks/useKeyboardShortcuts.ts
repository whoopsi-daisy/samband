'use client';

import { useEffect, useCallback, useRef } from 'react';

interface ShortcutHandlers {
  onSearch?: () => void;
  onEscape?: () => void;
  /**
   * Switch to the nth view, counting from zero, in the order the navigation
   * shows them.
   *
   * This used to be one handler per view: onListView, onMapView, onStatsView,
   * bound to 1, 2 and 3. The nav grew a fourth entry (VMA, in third place) and
   * these did not follow it, so 3 opened Statistik while the third tab was VMA,
   * and the one view with any urgency to it had no shortcut at all. The footer
   * went on advertising "1 2 3" for four views.
   *
   * Taking an index instead means the keys are the nav's own order by
   * construction, and adding a fifth view cannot silently break the fourth key.
   */
  onSelectView?: (index: number) => void;
  onScrollTop?: () => void;
}

/** Digits 1-9 select a view; beyond that a reader is counting, not reaching. */
const MAX_VIEW_KEY = 9;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  // Held in a ref so the listener is bound once rather than re-bound whenever a
  // caller passes a fresh handler object.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const current = handlersRef.current;

    // Don't trigger shortcuts when typing in input fields
    const target = event.target as HTMLElement;
    const isInputField = target.tagName === 'INPUT' ||
                         target.tagName === 'TEXTAREA' ||
                         target.tagName === 'SELECT' ||
                         target.isContentEditable;

    // Escape should always work (for closing modals, etc.)
    if (event.key === 'Escape' && current.onEscape) {
      current.onEscape();
      return;
    }

    // Don't trigger other shortcuts when in input fields
    if (isInputField) return;

    // A modifier means the reader is talking to the browser, not to us. Ctrl+K
    // is the one deliberate exception below.
    if (event.altKey || event.shiftKey) return;

    // Ctrl/Cmd + K or / for search focus
    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || event.key === '/') {
      event.preventDefault();
      current.onSearch?.();
      return;
    }

    if (event.metaKey || event.ctrlKey) return;

    // Number keys select a view, in the order the navigation lists them.
    if (current.onSelectView && event.key >= '1' && event.key <= String(MAX_VIEW_KEY)) {
      event.preventDefault();
      current.onSelectView(Number(event.key) - 1);
      return;
    }

    // Home key or 't' for scroll to top
    if ((event.key === 'Home' || event.key === 't') && current.onScrollTop) {
      event.preventDefault();
      current.onScrollTop();
      return;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
