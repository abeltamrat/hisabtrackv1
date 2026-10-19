import { AppRegistry, Platform } from 'react-native';

import { setDatabaseScope } from '@/services/database';
import { setSessionScope } from '@/services/SessionStorage';
import { SMSSyncService } from '@/services/SMSSyncService';

export const HISAB_SMS_HEADLESS_TASK = 'HisabSmsHeadlessTask';

interface SmsHeadlessPayload {
  scope?: string;
  receivedAt?: number;
}

/**
 * Runs only in Android builds containing HisabSmsHeadlessService. The native
 * receiver starts it for a configured bank sender when no React instance is
 * alive. It opens the signed-in user's scoped ledger and performs a small
 * catch-up scan; the same parser and duplicate checks used in the foreground
 * therefore remain the source of truth.
 */
export async function processHeadlessSms(payload: SmsHeadlessPayload): Promise<void> {
  const scope = payload.scope?.trim();
  if (Platform.OS !== 'android' || !scope) return;

  await setSessionScope(scope);
  await setDatabaseScope(scope);
  SMSSyncService.resume();
  await SMSSyncService.syncAllAccountsBackground({
    historicalDays: 2,
    maxMessagesPerSender: 50,
  });
}

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(HISAB_SMS_HEADLESS_TASK, () => processHeadlessSms);
}
