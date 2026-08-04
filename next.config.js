/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone: a self-contained server with only the modules that
  // are actually reachable, so the runtime image does not need node_modules
  // (and therefore no devDependencies) copied into it.
  output: 'standalone',
  // Never bundle the native SQLite addon: it has to stay a real require().
  serverExternalPackages: ['better-sqlite3'],
  // better-sqlite3 resolves its .node binary at runtime, which static tracing
  // cannot always follow. Without this the standalone server starts and then
  // throws "Could not locate the bindings file". Both layouts are listed: v13
  // ships prebuilds/, older versions compile into build/Release/.
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/better-sqlite3/prebuilds/**',
      './node_modules/better-sqlite3/build/Release/*.node',
    ],
  },
  // Transpile leaflet to avoid bundler issues
  transpilePackages: ['leaflet'],
  // Allow Turbopack (default in Next.js 16) with empty config
  turbopack: {},
  // Next sends `X-Powered-By: Next.js` on every response by default, which
  // names the framework to anyone scanning for one. It buys nothing.
  poweredByHeader: false,
  // Security headers
  async headers() {
    const isProduction = process.env.NODE_ENV === 'production';

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here asks for a camera, a microphone, a location or a
          // payment handler, and the browser default is to allow the page to
          // request them. Denying them outright means an injected script
          // cannot prompt for one in the site's name.
          {
            key: 'Permissions-Policy',
            value: [
              'accelerometer=()',
              'camera=()',
              'display-capture=()',
              'geolocation=()',
              'gyroscope=()',
              'magnetometer=()',
              'microphone=()',
              'payment=()',
              'usb=()',
            ].join(', '),
          },
          // Content-Security-Policy is deliberately NOT here. It carries a
          // per-request nonce so the page's inline scripts can be allowed by
          // name instead of by `'unsafe-inline'`, and a static header cannot
          // hold a value that changes per request. See src/proxy.ts.
          //
          // Only meaningful over TLS: browsers ignore HSTS on a plain-HTTP
          // origin, so it costs a local `npm start` nothing. A reverse proxy
          // that already sets this wins, since it terminates TLS and answers
          // the first request on the domain.
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
      {
        // App icons: referenced by the manifest and by every page, and they
        // change only when the mark does. Out of public/ they would otherwise
        // be revalidated on each load.
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, must-revalidate' }],
      },
      {
        // The worker decides what everything else caches, so it must never be
        // served from a cache itself.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },

  // Webpack fallback config (used with next build --webpack)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    config.module.rules.push({
      test: /leaflet[\\/]dist[\\/]leaflet\.css$/,
      type: 'asset/resource',
      generator: {
        emit: false,
      },
    });

    return config;
  },
};

module.exports = nextConfig;
