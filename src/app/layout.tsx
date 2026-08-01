import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

export const metadata: Metadata = {
  // Only used to resolve the relative share image below to an absolute URL.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://samband.unicast.space'),
  title: 'Sambandscentralen: polishändelser i realtid',
  description:
    'Följ polisens händelser i realtid över hela Sverige. Se aktuella polishändelser på karta, filtrera efter plats och händelsetyp.',
  keywords: ['polis', 'polishändelser', 'Sverige', 'realtid', 'brott', 'olyckor', 'karta'],
  manifest: '/manifest.json',
  // Files rather than an inline data URI: the same bitmaps the manifest points
  // at, so an installed app, a browser tab and an iOS home screen all show one
  // mark, and the markup stops carrying a copy of the artwork on every request.
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sambandscentralen',
  },
  openGraph: {
    title: 'Sambandscentralen: polishändelser i realtid',
    description: 'Följ polisens händelser i realtid över hela Sverige.',
    type: 'website',
    locale: 'sv_SE',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512 }],
  },
};

export const viewport: Viewport = {
  // Array form renders two <meta name="theme-color" media="..."> tags; the
  // browser picks the matching one, so the address bar tracks the OS setting
  // with no JS. (It won't track the in-app toggle, which is a one-off override
  // stored in localStorage: only the OS preference.)
  // Kept in step with --bg in globals.css. A pure white bar over a tinted
  // canvas reads as a seam across the top of the app.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f5f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1218' },
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
