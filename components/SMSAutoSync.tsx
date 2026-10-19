import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect, useRef } from 'react';
import { AppState, InteractionManager, Linking, Platform } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSSyncService } from '@/services/SMSSyncService';
import { NotificationService } from '@/services/NotificationService';
import { NativeSmsReceiver } from '@/services/NativeSmsReceiver';
import { Alert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import RemotePushService from '@/services/RemotePushService';

// Background (suspended-app) SMS sync is owned by BackgroundService's
// BACKGROUND_SYNC_TASK, which respects the Settings reminder toggles.
// This id is kept only so installs that registered the old task can clean it up.
const LEGACY_SMS_BACKGROUND_TASK = 'SMS_BACKGROUND_SYNC';

/**
 * Global headless component: consumes signals from the native SMS receiver and
 * sends a push notification with Record / Ignore / Later actions for each new
 * draft. Startup reconciliation reads only from each account's last successful
 * checkpoint (30 days on the first run), after the initial UI interactions.
 */
export const SMSAutoSync: React.FC = () => {
  const { user } = useAuth();
  // null means the account-level device choice has not loaded yet. Preserve the
  // receiver's persisted configuration during that short startup window.
  const [smsParsingSelected, setSmsParsingSelected] = React.useState<boolean | null>(null);
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
  const permissionPromptedRef = useRef(false);
  const smsPermissionRef = useRef<boolean | null>(null);
  const smsParsingSelectedRef = useRef(false);
  const startupReconciliationRef = useRef<Promise<void> | null>(null);
  useEffect(() => { hasSmsRef.current = hasSmsAccounts; }, [hasSmsAccounts]);
  useEffect(() => { currencyRef.current = ledgerCurrency; }, [ledgerCurrency]);
  useEffect(() => { smsParsingSelectedRef.current = smsParsingSelected === true; }, [smsParsingSelected]);
  useEffect(() => { startupReconciliationRef.current = null; }, [user?.uid]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !user?.uid) {
      setSmsParsingSelected(false);
      return;
    }
    const unsubscribe = RemotePushService.subscribeSmsParserSelection(user.uid, selected => {
      setSmsParsingSelected(selected);
    });
    void RemotePushService.ensureSmsParserSelection(user.uid).catch(() => undefined);
    return unsubscribe;
  }, [user?.uid]);

  const performSync = React.useCallback(async (incrementalFromCheckpoint = false) => {
    if (!hasSmsRef.current || !smsParsingSelectedRef.current) return false;
    try {
      // Receiver signals use a small recent window. Startup uses the durable
      // per-account checkpoint so SMS missed while the app was stopped are not
      // left behind, including messages older than that recent window.
      const result = incrementalFromCheckpoint
        ? await SMSSyncService.syncAllAccountsBackground()
        : await SMSSyncService.syncAllAccountsBackground({
            historicalDays: 2,
            maxMessagesPerSender: 50,
          });
      const pending = result.drafts.filter(d => d.status === 'PENDING');
      for (const draft of pending) {
        await NotificationService.showSMSDraftNotification(draft, currencyRef.current);
      }
      return !result.failed;
    } catch (err) {
      console.error('[SMSAutoSync] Auto-sync failed:', err);
      return false;
    }
  }, []);

  const reconcileStartup = React.useCallback((): Promise<void> => {
    if (startupReconciliationRef.current) return startupReconciliationRef.current;
    if (!hasSmsRef.current || !smsParsingSelectedRef.current) return Promise.resolve();

    const reconciliation = (async () => {
      const granted = await SMSSyncService.hasReadSmsPermission();
      smsPermissionRef.current = granted;
      if (!granted) {
        startupReconciliationRef.current = null;
        return;
      }
      // Clear any native receipt markers first. The checkpoint scan below is the
      // authoritative catch-up and still runs when no receipt marker was queued.
      await NativeSmsReceiver.consumePendingSignals().catch(() => 0);
      const completed = await performSync(true);
      if (!completed) startupReconciliationRef.current = null;
    })();
    startupReconciliationRef.current = reconciliation;
    return reconciliation;
  }, [performSync]);

  useEffect(() => {
    if (Platform.OS !== 'android' || smsParsingSelected !== true || !accountsLoaded || !hasSmsAccounts || permissionPromptedRef.current) return;
    permissionPromptedRef.current = true;
    void SMSSyncService.hasReadSmsPermission().then(async granted => {
      smsPermissionRef.current = granted;
      if (granted) {
        await NotificationService.requestPermissions();
        return;
      }
      const enabled = await SMSSyncService.requestPermissions();
      smsPermissionRef.current = enabled;
      if (enabled) {
        await NotificationService.requestPermissions();
        await reconcileStartup();
        return;
      }
      Alert.alert(
        'SMS access needed',
        'HisabTrack needs both read and receive SMS access to detect new bank messages. Enable SMS permission in Android settings.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => { void Linking.openSettings().catch(() => undefined); } },
        ],
      );
      if (user?.uid) await RemotePushService.setCurrentDeviceSmsParsing(user.uid, false).catch(() => undefined);
    }).catch(() => undefined);
  }, [accountsLoaded, hasSmsAccounts, reconcileStartup, smsParsingSelected, user?.uid]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (smsParsingSelected === null) return;
    // Emptying this list on logout/session reset prevents one user's configured
    // bank senders or receipt signals from carrying into the next local session.
    if (!smsParsingSelected) {
      void NativeSmsReceiver.configureSenders([]).catch(() => undefined);
      void NativeSmsReceiver.configureScope(null).catch(() => undefined);
      return;
    }
    if (!accountsLoaded) return;
    // Do not clear the native configuration from an effect cleanup. Cleanup
    // and the next async configure call can finish out of order, leaving the
    // receiver with an empty allowlist until the app is opened again.
    void Promise.all([
      NativeSmsReceiver.configureScope(user?.uid || null),
      NativeSmsReceiver.configureSenders(smsSenders),
    ]).catch(() => undefined);
  }, [accountsLoaded, smsParsingSelected, smsSendersKey, user?.uid]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!accountsLoaded || smsParsingSelected !== true) return;

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

    // Keep a minimal sender allowlist in the native receiver. Android can then
    // capture the arrival signal even when the React Native process is stopped.
    // Message bodies remain in the system SMS provider and are parsed by the
    // existing service, preserving its account matching and deduplication rules.
    const consumeSignals = () => NativeSmsReceiver.consumePendingSignals()
      .then(pending => { if (pending > 0) return performSync(); })
      .catch(() => undefined);
    const startupTask = InteractionManager.runAfterInteractions(() => {
      void reconcileStartup();
    });
    const unsubscribeFromSms = NativeSmsReceiver.subscribe(() => {
      // Never let a small recent-window scan advance the durable checkpoint
      // before the startup catch-up has inspected all messages since that point.
      void reconcileStartup().then(consumeSignals);
    });

    const subscription = AppState.addEventListener('change', (nextState: string) => {
      if (nextState !== 'active') return;
      void SMSSyncService.hasReadSmsPermission().then(granted => {
        const newlyGranted = granted && smsPermissionRef.current === false;
        smsPermissionRef.current = granted;
        if (newlyGranted) {
          return NotificationService.requestPermissions().then(() => performSync());
        }
        return consumeSignals();
      }).catch(() => undefined);
    });

    return () => {
      startupTask.cancel();
      subscription.remove();
      unsubscribeFromSms();
    };
  }, [accountsLoaded, smsParsingSelected, smsSendersKey, performSync, reconcileStartup]);

  return null;
};

export default SMSAutoSync;
