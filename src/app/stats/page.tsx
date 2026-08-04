import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getOperationalStats, getRecentFetchLogs, getDatabaseHealth, getStatsSummary } from '@/lib/db';
import OperationalDashboard from '@/components/OperationalDashboard';

// Disable caching for real-time stats
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Without this the operations dashboard inherited the feed's title, so a tab
// showing internal health read "Sambandscentralen: polishändelser i realtid".
// noindex because it is behind HTTP Basic auth and has no business in a search
// index even if someone leaves it open.
export const metadata: Metadata = {
  title: 'Systemstatus · Sambandscentralen',
  robots: { index: false, follow: false },
};

async function StatsContent() {
  const operationalStats = getOperationalStats();
  const fetchLogs = getRecentFetchLogs(25);
  const databaseHealth = getDatabaseHealth();
  const eventStats = getStatsSummary();

  return (
    <OperationalDashboard
      operationalStats={operationalStats}
      fetchLogs={fetchLogs}
      databaseHealth={databaseHealth}
      eventStats={eventStats}
    />
  );
}

export default function StatsPage() {
  return (
    <Suspense
      fallback={
        <div className="ops-container">
          <div className="loading-center">
            <div className="spinner" />
          </div>
        </div>
      }
    >
      <StatsContent />
    </Suspense>
  );
}
