import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { VIEWS } from '@/components/views';

/** A keydown on window, the way the hook listens for it. */
function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

/** A keydown that appears to come from a form control. */
function pressIn(tagName: string, key: string) {
  const element = document.createElement(tagName);
  document.body.appendChild(element);
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  element.remove();
}

describe('useKeyboardShortcuts', () => {
  /**
   * The keys used to be three hard-coded handlers bound to 1, 2 and 3. The nav
   * grew a fourth entry (VMA, in third place) and they did not follow: 3 opened
   * Statistik while the third tab was VMA, and the one view with any urgency had
   * no shortcut at all.
   */
  it('selects views by their position in the navigation', () => {
    const onSelectView = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSelectView }));

    press('1');
    press('2');
    press('3');
    press('4');

    expect(onSelectView.mock.calls.map(([i]) => i)).toEqual([0, 1, 2, 3]);
  });

  // The guarantee that matters: every view the nav shows is reachable.
  it('reaches every view the navigation lists, VMA included', () => {
    const reached: string[] = [];
    renderHook(() =>
      useKeyboardShortcuts({ onSelectView: (index) => reached.push(VIEWS[index].id) })
    );

    for (let i = 1; i <= VIEWS.length; i++) press(String(i));

    expect(reached).toEqual(VIEWS.map((view) => view.id));
    expect(reached).toContain('vma');
  });

  it('ignores a digit past the end of the navigation', () => {
    const onSelectView = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSelectView }));

    press('9');

    // The hook still reports the index; the caller is what bounds it.
    expect(onSelectView).toHaveBeenCalledWith(8);
    expect(VIEWS[8]).toBeUndefined();
  });

  it('focuses the search on / and on Ctrl+K', () => {
    const onSearch = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSearch }));

    press('/');
    press('k', { ctrlKey: true });
    press('k', { metaKey: true });

    expect(onSearch).toHaveBeenCalledTimes(3);
  });

  it('stays out of the way while the reader is typing', () => {
    const onSelectView = jest.fn();
    const onSearch = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSelectView, onSearch }));

    pressIn('input', '1');
    pressIn('textarea', '2');
    pressIn('select', '/');

    expect(onSelectView).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('still closes a modal from inside a field', () => {
    const onEscape = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onEscape }));

    pressIn('input', 'Escape');

    expect(onEscape).toHaveBeenCalled();
  });

  // Ctrl+1 switches browser tab; Alt+1 is an OS shortcut on some platforms.
  // Neither is the reader asking this app for anything.
  it('leaves modified number keys to the browser', () => {
    const onSelectView = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onSelectView }));

    press('1', { ctrlKey: true });
    press('1', { metaKey: true });
    press('1', { altKey: true });

    expect(onSelectView).not.toHaveBeenCalled();
  });

  it('scrolls to the top on Home and on t', () => {
    const onScrollTop = jest.fn();
    renderHook(() => useKeyboardShortcuts({ onScrollTop }));

    press('Home');
    press('t');

    expect(onScrollTop).toHaveBeenCalledTimes(2);
  });

  it('stops listening once unmounted', () => {
    const onSelectView = jest.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onSelectView }));

    unmount();
    press('1');

    expect(onSelectView).not.toHaveBeenCalled();
  });

  // The handlers object is rebuilt by the caller on some renders; the listener
  // must follow it rather than keep calling the first one it saw.
  it('uses the newest handlers without rebinding on every render', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ onSelectView }) => useKeyboardShortcuts({ onSelectView }),
      { initialProps: { onSelectView: first } }
    );

    rerender({ onSelectView: second });
    press('1');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(0);
  });
});
