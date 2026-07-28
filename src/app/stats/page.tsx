import { Suspense } from 'react';
import { getOperationalStats, getRecentFetchLogs, getDatabaseHealth, getStatsSummary } from '@/lib/db';
import OperationalDashboard from '@/components/OperationalDashboard';

// Disable caching for real-time stats
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
