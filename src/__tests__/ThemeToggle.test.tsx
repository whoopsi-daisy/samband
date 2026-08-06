import { act, render, screen, fireEvent } from '@testing-library/react';
import ThemeToggle from '@/components/ThemeToggle';

/**
 * The theme toggle.
 *
 * Its icon used to be a sun and a moon with `display: none` on whichever did not
 * apply. That is now one shape that travels between the two, driven entirely by
 * the `--dark` token in the stylesheet — which is what these hold: nothing about
 * the drawing may depend on JavaScript having run, because the button has to be
 * right on the first painted frame, before hydration, or the header flashes the
 * wrong icon on every load.
 */

function button() {
  return screen.getByRole('button', { name: 'Mörkt tema' });
}

/**
 * Press it, and let the attribute change reach the button.
 *
 * `aria-pressed` is read from the theme actually on <html>, observed rather than
 * assumed, so it settles a microtask after the click. That is before the next
 * paint in a browser; it is one await here.
 */
async function press() {
  await act(async () => {
    fireEvent.click(button());
  });
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('what it draws', () => {
  it('draws the same markup whichever theme is on', async () => {
    const { container: light, unmount } = render(<ThemeToggle />);
    const lightIcon = light.querySelector('.theme-orb')!.innerHTML;
    unmount();

    document.documentElement.setAttribute('data-theme', 'dark');
    let dark!: HTMLElement;
    await act(async () => {
      dark = render(<ThemeToggle />).container;
    });

    // Identical, because the difference between a sun and a moon here is CSS
    // reading a token. A component that swapped nodes could not be correct
    // before hydration.
    expect(dark.querySelector('.theme-orb')!.innerHTML).toBe(lightIcon);
  });

  it('carries the parts the stylesheet moves', () => {
    const { container } = render(<ThemeToggle />);
    for (const part of ['.theme-orb-core', '.theme-orb-bite', '.theme-orb-rays', '.theme-orb-stars']) {
      expect(container.querySelector(part)).not.toBeNull();
    }
    // The crescent is cut by a mask, so the disc has to reference it.
    expect(container.querySelector('.theme-orb-core')!.getAttribute('mask')).toBe(
      'url(#theme-orb-mask)'
    );
  });

  it('hides the drawing from assistive technology', () => {
    const { container } = render(<ThemeToggle />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('what it announces', () => {
  /*
   * The name used to be the theme it would switch *to*, read off state that
   * starts false on every server render — so a reader already in dark mode was
   * offered the theme they were in until hydration corrected it. What the button
   * does does not change; whether it is on does.
   */
  it('names itself the same either way, and reports whether it is on', async () => {
    render(<ThemeToggle />);
    expect(button()).toHaveAttribute('aria-pressed', 'false');

    await press();
    expect(button()).toHaveAttribute('aria-pressed', 'true');

    await press();
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts pressed when the page opened in dark', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    await act(async () => {
      render(<ThemeToggle />);
    });
    expect(button()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('what it changes', () => {
  it('stamps the attribute the whole stylesheet keys off', async () => {
    render(<ThemeToggle />);

    await press();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await press();
    // Removed, not set to "light": absence of the attribute is the light theme,
    // which is what lets prefers-color-scheme stand in when the bootstrap script
    // never ran.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('remembers the choice in both directions', async () => {
    render(<ThemeToggle />);

    await press();
    expect(localStorage.getItem('theme')).toBe('dark');

    await press();
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('still toggles when localStorage is unavailable', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    render(<ThemeToggle />);
    await expect(press()).resolves.not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    setItem.mockRestore();
  });
});
