import type { Metadata, Viewport } from 'next';
import { DM_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';

// Self-hosted at build time and served from /_next/static/media. Previously
// these came from fonts.googleapis.com, which meant a render-blocking request
// to a third party and every visitor's IP being handed to Google.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Sambandscentralen - Polishändelser i realtid',
  description: 'Följ polisens händelser i realtid över hela Sverige. Se aktuella polishändelser på karta, filtrera efter plats och händelsetyp.',
  keywords: ['polis', 'polishändelser', 'Sverige', 'realtid', 'brott', 'olyckor', 'karta'],
  manifest: '/manifest.json',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='9' fill='%23165a9b'/><circle cx='20' cy='20' r='13' fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.4'/><circle cx='20' cy='20' r='8' fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.95'/><circle cx='20' cy='20' r='3.6' fill='%23ffffff'/></svg>",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sambandscentralen',
  },
  openGraph: {
    title: 'Sambandscentralen - Polishändelser i realtid',
    description: 'Följ polisens händelser i realtid över hela Sverige.',
    type: 'website',
    locale: 'sv_SE',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f2ea' },
    { media: '(prefers-color-scheme: dark)', color: '#100e0a' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" className={`${dmSans.variable} ${playfairDisplay.variable}`}>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'||t==='radar')document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
          }}
        />
        <ServiceWorkerRegistration />
        <a href="#eventsGrid" className="skip-link">
          Hoppa till innehåll
        </a>
        {children}
      </body>
    </html>
  );
}
