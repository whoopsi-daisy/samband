'use client';

import { useEffect, useState } from 'react';

// True only after the first client-side effect has run.
//
// Anything derived from `new Date()` or from the viewer's timezone renders
// differently on the server than in the browser, which React reports as a
// hydration mismatch and then discards. Gate those values on this hook so the
// first client render still matches the server markup, and the live value is
// swapped in immediately afterwards.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
