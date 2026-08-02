#!/usr/bin/env node
/**
 * Forget the /stats account so first-run setup can be done again.
 *
 *   npm run admin:reset
 *
 * The dashboard password is stored as a hash, so a forgotten one cannot be
 * recovered, only replaced. This deletes the account row and the installation
 * key; the next start prints a fresh key and /stats sends you back to
 * /stats/setup.
 *
 * It needs a shell on the host holding the database, which is the point: the
 * only way to take the dashboard back is to already have the machine.
 *
 * STATS_USER/STATS_PASSWORD are not touched. If those are set they take
 * precedence, and this changes nothing until they are removed.
 *
 * SAMBAND_DATA_DIR selects the database, the same as for the app itself.
 */
import { clearStoredAdmin, getEnvCredentials, getStoredAdmin } from '../src/lib/adminAuth';
import { getDataDir } from '../src/lib/db';

function main(): void {
  const existing = getStoredAdmin();

  if (!existing) {
    console.log(`No stored admin account in ${getDataDir()}; nothing to reset.`);
  } else {
    clearStoredAdmin();
    console.log(`Removed the stored admin account "${existing.username}".`);
    console.log('Restart the app and open /stats/setup to choose a new one.');
  }

  if (getEnvCredentials()) {
    console.log(
      '\nNote: STATS_USER and STATS_PASSWORD are set, and they take precedence.\n' +
        '/stats will keep asking for those until they are removed.'
    );
  }
}

main();
