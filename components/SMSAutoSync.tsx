import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSSyncService } from '@/services/SMSSyncService';
import { NotificationService } from '@/services/NotificationService';

// Background (suspended-app) SMS sync is owned by BackgroundService's
// BACKGROUND_SYNC_TASK, which respects the Settings reminder toggles.
// This id is kept only so installs that registered the old task can clean it up.
const LEGACY_SMS_BACKGROUND_TASK = 'SMS_BACKGROUND_SYNC';

/**
 * Global headless component: auto-syncs SMS on app start and foreground resume,
 * and sends a push notification with Record / Ignore / Later actions for each
 * new draft. Background syncing while the app is suspended is handled by
 * BackgroundService, not here.
 */
export const SMSAutoSync: React.FC = () => {
  const accountsLoaded = useSelector((state: RootState) => state.accounts.status === 'succeeded');
  const hasSmsAccounts = useSelector((state: RootState) =>
    state.accounts.items.some(a => !!a.sms_number)
  );

  const hasSmsRef = useRef(hasSmsAccounts);
  useEffect(() => { hasSmsRef.current = hasSmsAccounts; }, [hasSmsAccounts]);

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
          await NotificationService.showSMSDraftNotification(draft);
        }
      } catch (err) {
        console.error('[SMSAutoSync] Auto-sync failed:', err);
      }
    };

    // Initial sync after 3 s, then every 5 minutes while app is in foreground
    const timer = setTimeout(performSync, 3000);
    const interval = setInterval(performSync, 5 * 60 * 1000);

    const subscription = AppState.addEventListener('change', (nextState: string) => {
      if (nextState === 'active') performSync();
    });

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      subscription.remove();
    };
  }, [accountsLoaded]);

  return null;
};

export default SMSAutoSync;
