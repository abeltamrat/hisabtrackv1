import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSSyncService } from '@/services/SMSSyncService';
import { Platform, AppState } from 'react-native';

/**
 * Global headless component: auto-syncs SMS on app start and foreground resume.
 * Uses syncAllAccountsBackground() so it always reads fresh data from the DB
 * rather than capturing potentially stale Redux state in a closure.
 */
export const SMSAutoSync: React.FC = () => {
    const accountsLoaded = useSelector((state: RootState) => state.accounts.status === 'succeeded');
    const hasSmsAccounts = useSelector((state: RootState) =>
        state.accounts.items.some(a => !!a.sms_number)
    );

    // Keep a ref so performSync always reads the latest value without re-triggering the effect.
    const hasSmsRef = useRef(hasSmsAccounts);
    useEffect(() => { hasSmsRef.current = hasSmsAccounts; }, [hasSmsAccounts]);

    useEffect(() => {
        if (Platform.OS !== 'android') return;
        if (!accountsLoaded) return;

        const performSync = async () => {
            if (!hasSmsRef.current) return;
            try {
                await SMSSyncService.syncAllAccountsBackground();
            } catch (err) {
                console.error('[SMSAutoSync] Auto-sync failed:', err);
            }
        };

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
