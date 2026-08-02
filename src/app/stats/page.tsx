import { Suspense } from 'react';
import {
  getOperationalStats,
  getRecentFetchLogs,
  getDatabaseHealth,
  getSystemSnapshot,
} from '@/lib/db';
import { MAX_DAILY_FETCHES } from '@/lib/policeApi';
import OperationalDashboard from '@/components/OperationalDashboard';

// Never cached: the whole point of the page is what is true right now, and the
// dashboard asks for a fresh render on a timer.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function StatsContent() {
  const operationalStats = getOperationalStats();

  return (
    <OperationalDashboard
      operationalStats={operationalStats}
      fetchLogs={getRecentFetchLogs(25)}
      databaseHealth={getDatabaseHealth()}
      system={getSystemSnapshot()}
      // fetches24h is the same count the limiter checks before every upstream
      // call, so the gauge cannot drift from what is actually enforced.
      fetchBudget={{ used: operationalStats.fetches24h, limit: MAX_DAILY_FETCHES }}
      generatedAt={new Date().toISOString()}
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
