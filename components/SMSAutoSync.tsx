import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
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
 * draft. A full inbox scan is deliberately not started on mount: older Android
 * devices can kill the process while the legacy SMS module enumerates a large
 * inbox. Manual sync and BackgroundService still provide catch-up scans.
 */
export const SMSAutoSync: React.FC = () => {
  const { user } = useAuth();
  const [smsParsingSelected, setSmsParsingSelected] = React.useState(false);
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
  useEffect(() => { hasSmsRef.current = hasSmsAccounts; }, [hasSmsAccounts]);
  useEffect(() => { currencyRef.current = ledgerCurrency; }, [ledgerCurrency]);
  useEffect(() => { smsParsingSelectedRef.current = smsParsingSelected; }, [smsParsingSelected]);

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

  const performSync = React.useCallback(async () => {
    if (!hasSmsRef.current || !smsParsingSelectedRef.current) return;
    try {
      // A receiver signal always refers to a newly arrived message. Keep this
      // catch-up scan small so phones with a large inbox are not overwhelmed.
      const result = await SMSSyncService.syncAllAccountsBackground({
        historicalDays: 2,
        maxMessagesPerSender: 50,
      });
      const pending = result.drafts.filter(d => d.status === 'PENDING');
      for (const draft of pending) {
        await NotificationService.showSMSDraftNotification(draft, currencyRef.current);
      }
    } catch (err) {
      console.error('[SMSAutoSync] Auto-sync failed:', err);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !smsParsingSelected || !accountsLoaded || !hasSmsAccounts || permissionPromptedRef.current) return;
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
        await performSync();
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
  }, [accountsLoaded, hasSmsAccounts, performSync, smsParsingSelected, user?.uid]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Emptying this list on logout/session reset prevents one user's configured
    // bank senders or receipt signals from carrying into the next local session.
    if (!smsParsingSelected) {
      void NativeSmsReceiver.configureSenders([]).catch(() => undefined);
      return () => { void NativeSmsReceiver.configureSenders([]).catch(() => undefined); };
    }
    void NativeSmsReceiver.configureSenders(accountsLoaded ? smsSenders : [])
      .catch(() => undefined);
    return () => { void NativeSmsReceiver.configureSenders([]).catch(() => undefined); };
  }, [accountsLoaded, smsParsingSelected, smsSendersKey]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!accountsLoaded || !smsParsingSelected) return;

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
    void consumeSignals();
    const unsubscribeFromSms = NativeSmsReceiver.subscribe(() => {
      void consumeSignals();
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
      subscription.remove();
      unsubscribeFromSms();
    };
  }, [accountsLoaded, smsParsingSelected, smsSendersKey, performSync]);

  return null;
};

export default SMSAutoSync;
