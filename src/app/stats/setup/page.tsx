import { redirect } from 'next/navigation';
import { getEnvCredentials, hasStoredAdmin, isSetupOpen } from '@/lib/adminAuth';
import AdminSetupForm from '@/components/AdminSetupForm';

// First-run credentials for /stats.
//
// The proxy already redirects away from here once an account exists, but this
// page renders on its own when the proxy is bypassed (a direct call in a test,
// a rewrite in front of the app), so it repeats the check rather than trusting
// the layer above it.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AdminSetupPage() {
  if (getEnvCredentials() || hasStoredAdmin()) {
    redirect('/stats');
  }

  return <AdminSetupForm tokenRequired={!isSetupOpen()} />;
}
