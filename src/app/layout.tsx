import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

const ICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='9' fill='%23165a9b'/><circle cx='20' cy='20' r='13' fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.4'/><circle cx='20' cy='20' r='8' fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.95'/><circle cx='20' cy='20' r='3.6' fill='%23ffffff'/></svg>";

export const metadata: Metadata = {
  title: 'Sambandscentralen — Polishändelser i realtid',
  description:
    'Följ polisens händelser i realtid över hela Sverige. Se aktuella polishändelser på karta, filtrera efter plats och händelsetyp.',
  keywords: ['polis', 'polishändelser', 'Sverige', 'realtid', 'brott', 'olyckor', 'karta'],
  manifest: '/manifest.json',
  icons: { icon: ICON },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sambandscentralen',
  },
  openGraph: {
    title: 'Sambandscentralen — Polishändelser i realtid',
    description: 'Följ polisens händelser i realtid över hela Sverige.',
    type: 'website',
    locale: 'sv_SE',
  },
};

export const viewport: Viewport = {
  // Array form renders two <meta name="theme-color" media="..."> tags; the
  // browser picks the matching one, so the address bar tracks the OS setting
  // with no JS. (It won't track the in-app toggle, which is a one-off override
  // stored in localStorage — only the OS preference.)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111111' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Runs before first paint so the theme never flashes. Absence of the attribute
// is the light theme, so only dark needs stamping.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark')}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ServiceWorkerRegistration />
        <a href="#main-content" className="skip-link">
          Hoppa till innehåll
        </a>
        {children}
      </body>
    </html>
  );
}
