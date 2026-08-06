'use client';

import { useCallback } from 'react';
import { useDarkTheme } from '@/hooks/useDarkTheme';

/**
 * Light/dark only. The default is whatever the OS prefers: the inline script in
 * the root layout applies it before first paint. Toggling stores an explicit
 * override in localStorage.
 *
 * The icon is one shape rather than two swapped by `display: none`: a disc that
 * slides under a mask into a crescent, rays that fold into it, and two stars
 * that come up in the space they leave. All of it is driven by the `--dark`
 * token in the stylesheet, which the theme sets, so the icon is *correct* on the
 * very first frame with no hydration flash — the same property the two-icon
 * version had — and only a change of theme has anything to animate.
 */
export default function ThemeToggle() {
  // Read for the button's state, not for the drawing: the shape is CSS, and if
  // this hook is a frame behind on mount the icon is still right.
  const isDark = useDarkTheme();

  const toggle = useCallback(() => {
    const next = document.documentElement.getAttribute('data-theme') !== 'dark';
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // localStorage unavailable (private mode, blocked cookies)
    }
  }, []);

  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      onClick={toggle}
      /*
       * A name for the control, and a state beside it.
       *
       * The label used to name the *other* theme ("Byt till mörkt tema"), read
       * off state that starts false on every render the server does — so a
       * reader already in dark mode was offered the theme they were in until
       * hydration corrected it. What the button does never changes; whether it
       * is on does, and aria-pressed is where that belongs.
       */
      aria-label="Mörkt tema"
      aria-pressed={isDark}
      title="Byt tema"
    >
      <svg
        className="theme-orb"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <mask id="theme-orb-mask">
          {/* Everything shows except what the circle covers. In the light theme
              the circle is translated clear of the disc, so nothing is cut. */}
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          <circle className="theme-orb-bite" cx="17.5" cy="6.5" r="7.5" fill="#000" />
        </mask>

        <g
          className="theme-orb-rays"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 1.5v2.3M12 20.2v2.3M1.5 12h2.3M20.2 12h2.3M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" />
        </g>

        <g className="theme-orb-stars" fill="currentColor">
          <circle cx="19.4" cy="3.6" r="1" />
          <circle cx="21.2" cy="8.2" r="0.7" />
        </g>

        <circle
          className="theme-orb-core"
          cx="12"
          cy="12"
          r="5.2"
          fill="currentColor"
          mask="url(#theme-orb-mask)"
        />
      </svg>
    </button>
  );
}
