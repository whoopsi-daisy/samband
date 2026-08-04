/**
 * The theme bootstrap, in its own module so two places can agree on it.
 *
 * It runs before first paint so the theme never flashes, which means it has to
 * be inline, which means the Content-Security-Policy has to allow it. It is
 * allowed by hash rather than by `'unsafe-inline'`: the string never varies, so
 * its digest is stable, and the proxy computes that digest from this same
 * constant. Two copies of the script could drift apart and produce a page whose
 * theme silently stops applying; one copy cannot.
 *
 * Absence of the attribute is the light theme, so only dark needs stamping.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()`;
