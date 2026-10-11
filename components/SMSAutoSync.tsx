import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSSyncService } from '@/services/SMSSyncService';
import { NotificationService } from '@/services/NotificationService';
import { NativeSmsReceiver } from '@/services/NativeSmsReceiver';

// Background (suspended-app) SMS sync is owned by BackgroundService's
// BACKGROUND_SYNC_TASK, which respects the Settings reminder toggles.
// This id is kept only so installs that registered the old task can clean it up.
const LEGACY_SMS_BACKGROUND_TASK = 'SMS_BACKGROUND_SYNC';

/**
 * Global headless component: consumes signals from the native SMS receiver and
 * sends a push notification with Record / Ignore / Later actions for each new
 * draft. A full inbox scan is deliberately not started on mount: older Android
 * devices can kill the process while the legacy SMS module enumerates a large
 * inbox. Manual sync and BackgroundService still provide catch-up scans.
 */
export const SMSAutoSync: React.FC = () => {
  const accountsLoaded = useSelector((state: RootState) => state.accounts.status === 'succeeded');
  const hasSmsAccounts = useSelector((state: RootState) =>
    state.accounts.items.some(a => !!a.sms_number)
  );
  const smsSendersKey = useSelector((state: RootState) =>
    state.accounts.items.flatMap(account =>
      (account.sms_number || '').split(',').map(sender => sender.trim()).filter(Boolean)
    ).join('|')
  );
  const smsSenders = smsSendersKey ? smsSendersKey.split('|') : [];
  const ledgerCurrency = useSelector((state: RootState) => state.accounts.items[0]?.currency || 'ETB');

  const hasSmsRef = useRef(hasSmsAccounts);
  const currencyRef = useRef(ledgerCurrency);
  useEffect(() => { hasSmsRef.current = hasSmsAccounts; }, [hasSmsAccounts]);
  useEffect(() => { currencyRef.current = ledgerCurrency; }, [ledgerCurrency]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Emptying this list on logout/session reset prevents one user's configured
    // bank senders or receipt signals from carrying into the next local session.
    void NativeSmsReceiver.configureSenders(accountsLoaded ? smsSenders : [])
      .catch(() => undefined);
  }, [accountsLoaded, smsSendersKey]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!accountsLoaded) return;

    // Unregister the background task older app versions registered here;
    // leaving it active caused double syncs and duplicate notifications
    // alongside BackgroundService's task.
    TaskManager.isTaskRegisteredAsync(LEGACY_SMS_BACKGROUND_TASK)
      .then(registered => registered
        ? BackgroundFetch.unregisterTaskAsync(LEGACY_SMS_BACKGROUND_TASK)
        : undefined)
      .catch(() => {
        // Fails gracefully in Expo Go / web
      });

    const performSync = async () => {
      if (!hasSmsRef.current) return;
      try {
        const result = await SMSSyncService.syncAllAccountsBackground();
        const pending = result.drafts.filter(d => d.status === 'PENDING');
        for (const draft of pending) {
          await NotificationService.showSMSDraftNotification(draft, currencyRef.current);
        }
      } catch (err) {
        console.error('[SMSAutoSync] Auto-sync failed:', err);
      }
    };

    // Keep a minimal sender allowlist in the native receiver. Android can then
    // capture the arrival signal even when the React Native process is stopped.
    // Message bodies remain in the system SMS provider and are parsed by the
    // existing service, preserving its account matching and deduplication rules.
    const consumeSignals = () => NativeSmsReceiver.consumePendingSignals()
      .then(pending => { if (pending > 0) return performSync(); })
      .catch(() => undefined);
    void consumeSignals();
    const unsubscribeFromSms = NativeSmsReceiver.subscribe(() => {
      void consumeSignals();
    });

    const subscription = AppState.addEventListener('change', (nextState: string) => {
      if (nextState === 'active') void consumeSignals();
    });

    return () => {
      subscription.remove();
      unsubscribeFromSms();
    };
  }, [accountsLoaded, smsSendersKey]);

  return null;
};

export default SMSAutoSync;
