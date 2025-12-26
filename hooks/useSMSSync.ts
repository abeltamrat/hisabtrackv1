import { DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSReconciliationResult, SMSSyncService } from '@/services/SMSSyncService';
import { Account, Transaction } from '@/types/database';
import { useEffect, useState } from 'react';

export function useSMSSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  /**
   * Sync SMS for a specific account
   */
  const syncAccount = async (
    account: Account,
    transactions: Transaction[]
  ): Promise<SMSReconciliationResult | null> => {
    if (!account.sms_number) {
      return null;
    }

    try {
      setSyncing(true);
      const result = await SMSSyncService.syncAccountSMS(account, transactions);
      setLastSyncTime(Date.now());
      return result;
    } catch (error) {
      console.error('Error syncing SMS:', error);
      return null;
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Get unrecorded count for an account
   */
  const getUnrecordedCount = async (accountId: string): Promise<number> => {
    return await DraftTransactionService.getUnrecordedCount(accountId);
  };

  /**
   * Request SMS permissions
   */
  const requestPermissions = async (): Promise<boolean> => {
    return await SMSSyncService.requestPermissions();
  };

  return {
    syncing,
    lastSyncTime,
    syncAccount,
    getUnrecordedCount,
    requestPermissions,
  };
}

export function useAccountDrafts(accountId: string) {
  const [unrecordedCount, setUnrecordedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadCount = async () => {
    try {
      setLoading(true);
      const count = await DraftTransactionService.getUnrecordedCount(accountId);
      setUnrecordedCount(count);
    } catch (error) {
      console.error('Error loading draft count:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCount();
  }, [accountId]);

  return {
    unrecordedCount,
    loading,
    refresh: loadCount,
  };
}
