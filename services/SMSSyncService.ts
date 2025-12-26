import { Account, Transaction } from '@/types/database';
import { EnhancedSMSParser } from '@/utils/enhancedSMSParser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { DraftTransaction, DraftTransactionService, SMSReconciliationResult } from './DraftTransactionService';

// SMS Message interface
export interface SMSMessage {
  id: string;
  address: string; // Sender
  body: string;
  date: number; // Timestamp
}

export class SMSSyncService {
  /**
   * Request SMS permissions
   */
  static async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') {
      console.log('SMS not available on web');
      return false;
    }

    try {
      // For React Native, you would use expo-sms or react-native-sms
      // This is a placeholder for the actual implementation
      const { PermissionsAndroid } = require('react-native');
      
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          {
            title: 'SMS Permission',
            message: 'HisabTrack needs access to your SMS to automatically track bank transactions',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      
      return false; // iOS doesn't support SMS reading
    } catch (error) {
      console.error('Error requesting SMS permissions:', error);
      return false;
    }
  }

  /**
   * Read SMS messages from specific sender
   */
  static async readSMSFromSender(
    sender: string,
    sinceTimestamp?: number
  ): Promise<SMSMessage[]> {
    if (Platform.OS === 'web') {
      // For web, return mock data for testing
      return this.getMockSMS(sender);
    }

    try {
      // For React Native, you would use a native module or library
      // This is a placeholder - you'll need to implement actual SMS reading
      // using libraries like react-native-get-sms-android
      
      // Example implementation would be:
      // const SmsAndroid = require('react-native-get-sms-android');
      // const filter = {
      //   box: 'inbox',
      //   address: sender,
      //   minDate: sinceTimestamp || 0,
      // };
      // const messages = await SmsAndroid.list(JSON.stringify(filter));
      
      return [];
    } catch (error) {
      console.error('Error reading SMS:', error);
      return [];
    }
  }

  /**
   * Sync SMS for a specific account
   */
  static async syncAccountSMS(
    account: Account,
    existingTransactions: Transaction[]
  ): Promise<SMSReconciliationResult> {
    const result: SMSReconciliationResult = {
      totalSMS: 0,
      parsedTransactions: 0,
      matchedAccounts: 0,
      newDrafts: 0,
      alreadyRecorded: 0,
      drafts: [],
    };

    if (!account.sms_number) {
      console.log('No SMS number configured for account:', account.name);
      return result;
    }

    try {
      // Read SMS from the configured sender
      const messages = await this.readSMSFromSender(account.sms_number);
      result.totalSMS = messages.length;

      for (const sms of messages) {
        // Check if already processed
        if (await DraftTransactionService.isDuplicate(sms.id)) {
          result.alreadyRecorded++;
          continue;
        }

        // Parse SMS
        const parsed = EnhancedSMSParser.parseTransaction(
          sms.body,
          sms.address,
          sms.id,
          sms.date
        );

        if (!parsed) {
          continue; // Not a transaction SMS
        }

        result.parsedTransactions++;

        // Check if account number matches
        if (parsed.accountNumber) {
          const accountLastDigits = account.account_number?.slice(-4);
          if (accountLastDigits && accountLastDigits !== parsed.accountNumber) {
            continue; // Different account
          }
        }

        result.matchedAccounts++;

        // Check if transaction already exists
        const isAlreadyRecorded = this.isTransactionRecorded(parsed, existingTransactions);
        
        // Suggest category
        const category = EnhancedSMSParser.suggestCategory(parsed.merchant, parsed.rawMessage);

        // Create draft transaction
        const draft: Omit<DraftTransaction, 'id' | 'created_at'> = {
          account_id: account.id,
          type: parsed.type,
          amount: parsed.amount,
          category,
          description: parsed.merchant || `${parsed.type === 'INCOME' ? 'Received' : 'Paid'} via ${sms.address}`,
          date: parsed.date,
          sms_id: parsed.smsId,
          sender_receiver: parsed.merchant,
          reference_number: parsed.referenceNumber,
          fees: parsed.fees,
          tax: parsed.tax,
          suggested_balance: parsed.balance,
          raw_sms: parsed.rawMessage,
          is_recorded: isAlreadyRecorded,
        };

        const savedDraft = await DraftTransactionService.add(draft);
        result.drafts.push(savedDraft);

        if (!isAlreadyRecorded) {
          result.newDrafts++;
        } else {
          result.alreadyRecorded++;
        }
      }

      // Persist last successful sync timestamp for this account
      try { await this.setLastSuccessfulSync(account.id, Date.now()); } catch (e) { /* ignore */ }
      return result;
    } catch (error) {
      console.error('Error syncing SMS for account:', account.name, error);
      return result;
    }
  }

  /**
   * Persist last successful sync timestamp for an account
   */
  static async setLastSuccessfulSync(accountId: string, timestamp: number) {
    try {
      await AsyncStorage.setItem(`sms_last_sync_${accountId}`, String(timestamp));
    } catch (e) {
      console.error('Failed to persist last SMS sync', e);
    }
  }

  /**
   * Get last successful sync timestamp for an account
   */
  static async getLastSuccessfulSync(accountId: string): Promise<number | null> {
    try {
      const v = await AsyncStorage.getItem(`sms_last_sync_${accountId}`);
      return v ? Number(v) : null;
    } catch (e) {
      console.error('Failed to read last SMS sync', e);
      return null;
    }
  }

  /**
   * Check if transaction is already recorded
   */
  private static isTransactionRecorded(
    parsed: any,
    existingTransactions: Transaction[]
  ): boolean {
    // Match by reference number if available
    if (parsed.referenceNumber) {
      const match = existingTransactions.find(
        t => t.reference_number === parsed.referenceNumber
      );
      if (match) return true;
    }

    // Match by SMS ID
    if (parsed.smsId) {
      const match = existingTransactions.find(
        t => t.sms_id === parsed.smsId
      );
      if (match) return true;
    }

    // Match by amount, type, and date (within 1 hour)
    const timeWindow = 60 * 60 * 1000; // 1 hour
    const match = existingTransactions.find(t => {
      const amountMatch = Math.abs(t.amount - parsed.amount) < 0.01;
      const typeMatch = t.type === parsed.type;
      const dateMatch = Math.abs(t.date - parsed.date) < timeWindow;
      return amountMatch && typeMatch && dateMatch;
    });

    return !!match;
  }

  /**
   * Get mock SMS for testing (web platform)
   */
  private static getMockSMS(sender: string): SMSMessage[] {
    const now = Date.now();
    return [
      {
        id: 'sms_1',
        address: sender,
        body: `CBE: Your account ending 1234 has been debited with Birr 500.00 on ${new Date().toLocaleDateString()}. Fee: Birr 5.00. Available balance: Birr 15,234.50. Ref: TXN123456`,
        date: now - 3600000,
      },
      {
        id: 'sms_2',
        address: sender,
        body: `CBE: Birr 2,500.00 credited to your account ending 1234 on ${new Date().toLocaleDateString()}. Available balance: Birr 17,734.50. Ref: TXN123457`,
        date: now - 7200000,
      },
      {
        id: 'sms_3',
        address: sender,
        body: `CBE: You have paid Birr 1,200.00 to ETHIO TELECOM from account 1234. Fee: Birr 10.00. Balance: Birr 16,524.50. Ref: TXN123458`,
        date: now - 10800000,
      },
    ];
  }

  /**
   * Sync all accounts with SMS enabled
   */
  static async syncAllAccounts(
    accounts: Account[],
    transactions: Transaction[]
  ): Promise<Map<string, SMSReconciliationResult>> {
    const results = new Map<string, SMSReconciliationResult>();

    for (const account of accounts) {
      if (account.sms_number) {
        const result = await this.syncAccountSMS(account, transactions);
        results.set(account.id, result);
      }
    }

    return results;
  }
}
