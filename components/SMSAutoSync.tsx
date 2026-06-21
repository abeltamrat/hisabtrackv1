import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSSyncService } from '@/services/SMSSyncService';
import { Platform } from 'react-native';

/**
 * Global component to handle automatic SMS syncing on app start
 */
export const SMSAutoSync: React.FC = () => {
    const accounts = useSelector((state: RootState) => state.accounts.items);
    const transactions = useSelector((state: RootState) => state.transactions.items);
    const accountsLoaded = useSelector((state: RootState) => state.accounts.status === 'succeeded');

    useEffect(() => {
        if (Platform.OS !== 'android') return;
        if (!accountsLoaded || accounts.length === 0) return;

        const performSync = async () => {
            try {
                // Only sync if there are accounts with SMS numbers
                const smsAccounts = accounts.filter(a => a.sms_number);
                if (smsAccounts.length === 0) return;

                console.log('[SMSAutoSync] Checking for new SMS...');
                await SMSSyncService.checkAllNow(accounts, transactions);
            } catch (err) {
                console.error('[SMSAutoSync] Auto-sync failed:', err);
            }
        };

        // Initial sync
        const timer = setTimeout(performSync, 3000);

        // Periodic check every 5 minutes
        const interval = setInterval(performSync, 5 * 60 * 1000);

        // Also check when app comes to foreground
        const { AppState } = require('react-native');
        const subscription = AppState.addEventListener('change', (nextState: string) => {
            if (nextState === 'active') {
                performSync();
            }
        });

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
            subscription.remove();
        };
    }, [accountsLoaded, accounts.length]);

    return null; // This component doesn't render anything
};

export default SMSAutoSync;
