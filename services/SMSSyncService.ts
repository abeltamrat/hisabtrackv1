import { Account, Transaction } from '@/types/database';
import { EnhancedSMSParser } from '@/utils/enhancedSMSParser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { DraftTransaction, DraftTransactionService } from './DraftTransactionService';
import LocalChangeEmitter from './LocalChangeEmitter';
import { SMSLearningService } from './SMSLearningService';

export type { SMSReconciliationResult } from './DraftTransactionService';
import type { SMSReconciliationResult } from './DraftTransactionService';

// SMS Message interface
export interface SMSMessage {
  id: string;
  address: string; // Sender
  body: string;
  date: number; // Timestamp
}

export class SMSSyncService {
  private static SYNC_STATUS_LISTENER: ((status: { accountId: string, status: string, progress: number }) => void) | null = null;

  static setSyncStatusListener(listener: (status: { accountId: string, status: string, progress: number }) => void) {
    this.SYNC_STATUS_LISTENER = listener;
  }

  private static emitStatus(accountId: string, status: string, progress: number) {
    if (this.SYNC_STATUS_LISTENER) {
      this.SYNC_STATUS_LISTENER({ accountId, status, progress });
    }
  }

  /**
   * Request SMS permissions
   */
  static async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      const { PermissionsAndroid } = require('react-native');
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          {
            title: 'SMS Permission',
            message: 'HisabTrack needs access to your SMS to automatically track bank transactions',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
      return false;
    } catch (error) {
      console.error('Error requesting SMS permissions:', error);
      return false;
    }
  }

  static async hasReadSmsPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const { PermissionsAndroid } = require('react-native');
      return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    } catch (error) {
      console.warn('Error checking READ_SMS permission:', error);
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
    if (Platform.OS === 'web') return this.getMockSMS(sender);
    if (Platform.OS !== 'android') return [];

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 10000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const SmsAndroid = require('react-native-get-sms-android');
        const filter = {
          box: 'inbox',
          address: sender,
          minDate: sinceTimestamp || 0,
        };

        const result = await Promise.race([
          new Promise<SMSMessage[]>((resolve, reject) => {
            SmsAndroid.list(
              JSON.stringify(filter),
              (fail: string) => {
                console.warn(`[SMS] Failed to list messages (Attempt ${attempt}):`, fail);
                reject(new Error(fail));
              },
              (count: number, smsList: string) => {
                try {
                  const messages = JSON.parse(smsList) as any[];
                  const formatted: SMSMessage[] = messages.map(m => ({
                    id: String(m._id),
                    address: m.address,
                    body: m.body,
                    date: m.date,
                  }));
                  resolve(formatted);
                } catch (e) {
                  reject(e);
                }
              }
            );
          }),
          new Promise<SMSMessage[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS)
          )
        ]);

        return result;
      } catch (error) {
        console.warn(`[SMS] Read attempt ${attempt} failed:`, error);
        if (attempt === MAX_RETRIES) {
          console.error('[SMS] All attempts failed. Returning empty list.');
          return [];
        }
        // Wait briefly before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return [];
  }

  /**
   * Sync SMS for a specific account
   */
  static async syncAccountSMS(
    account: Account,
    existingTransactions: Transaction[],
    options: { historicalDays?: number, ignorePrevious?: boolean } = {}
  ): Promise<SMSReconciliationResult> {
    const result: SMSReconciliationResult = {
      totalSMS: 0,
      parsedTransactions: 0,
      matchedAccounts: 0,
      newDrafts: 0,
      alreadyRecorded: 0,
      drafts: [],
    };

    if (!account.sms_number) return result;

    try {
      this.emitStatus(account.id, 'Identifying Senders...', 10);
      const senders = account.sms_number.split(',').map(s => s.trim()).filter(Boolean);
      const allMessages: SMSMessage[] = [];

      let sinceTimestamp = 0;
      if (options.ignorePrevious) {
        sinceTimestamp = Date.now();
      } else if (options.historicalDays) {
        sinceTimestamp = Date.now() - (options.historicalDays * 24 * 60 * 60 * 1000);
      } else {
        const lastSync = await this.getLastSuccessfulSync(account.id);
        // NEW: If never synced before, default to NOW to avoid pulling years of history
        sinceTimestamp = lastSync || Date.now();
      }

      for (const sender of senders) {
        const messages = await this.readSMSFromSender(sender, sinceTimestamp);
        // Safety: Limit messages to avoid memory/crash issues if history is huge
        allMessages.push(...messages.slice(-200));
      }

      result.totalSMS = allMessages.length;
      allMessages.sort((a, b) => a.date - b.date);

      this.emitStatus(account.id, `Processing ${allMessages.length} Messages...`, 30);

      // Cache existing draft sms_ids to speed up duplicate check
      const existingDrafts = await DraftTransactionService.getAll();
      const existingSmsIds = new Set(existingDrafts.map(d => d.sms_id));

      for (let i = 0; i < allMessages.length; i++) {
        const sms = allMessages[i];
        const progress = 30 + (Math.floor((i / allMessages.length) * 60));
        if (i % 5 === 0) this.emitStatus(account.id, `Parsing message ${i + 1}/${allMessages.length}...`, progress);

        if (existingSmsIds.has(sms.id)) {
          result.alreadyRecorded++;
          continue;
        }

        const parsed = EnhancedSMSParser.parseTransaction(sms.body, sms.address, sms.id, sms.date);
        if (!parsed) continue;

        result.parsedTransactions++;

        // Account Identification Logic: 
        // If the SMS contains an account number, it must match this account.
        // If the SMS doesn't mention an account number, we assume it's for this account if it's the only one 
        // or if it matches the account's configured digits.
        if (parsed.accountNumber && account.account_number) {
          const accLast4 = account.account_number.slice(-4);
          const smsLastDigits = parsed.accountNumber.slice(-4);
          if (!accLast4.endsWith(smsLastDigits) && !smsLastDigits.endsWith(accLast4)) {
            // This SMS belongs to a different account (shared sender)
            continue;
          }
        }

        result.matchedAccounts++;
        const isAlreadyRecorded = this.isTransactionRecorded(parsed, existingTransactions);

        // Learning
        let category = EnhancedSMSParser.suggestCategory(parsed.merchant, parsed.rawMessage, parsed.type);
        let description = parsed.merchant || `${parsed.type === 'INCOME' ? 'Received' : 'Paid'} via ${sms.address}`;

        const rule = await SMSLearningService.getRule({
          accountId: account.id,
          sender: sms.address,
          rawMerchant: parsed.merchant || '',
          referenceNumber: parsed.referenceNumber,
        });
        if (rule) {
          category = rule.category;
          description = rule.description;
        }

        const draft: Omit<DraftTransaction, 'id' | 'created_at'> = {
          account_id: account.id,
          type: parsed.type,
          amount: parsed.amount,
          category,
          description,
          date: parsed.date,
          sms_id: parsed.smsId,
          sms_sender: sms.address,
          sender_receiver: parsed.merchant,
          reference_number: parsed.referenceNumber,
          fees: parsed.fees,
          tax: parsed.tax,
          suggested_balance: parsed.balance,
          raw_sms: parsed.rawMessage,
          status: isAlreadyRecorded ? 'RECORDED' : 'PENDING',
          is_recorded: isAlreadyRecorded,
        };

        const savedDraft = await DraftTransactionService.add(draft);
        result.drafts.push(savedDraft);
        if (!isAlreadyRecorded) result.newDrafts++;
        else result.alreadyRecorded++;
      }

      this.emitStatus(account.id, 'Sync Complete', 100);
      await this.setLastSuccessfulSync(account.id, Date.now());
      return result;
    } catch (error) {
      this.emitStatus(account.id, 'Sync Failed', 0);
      return result;
    }
  }

  static async setLastSuccessfulSync(accountId: string, timestamp: number) {
    try {
      await AsyncStorage.setItem(`sms_last_sync_${accountId}`, String(timestamp));
    } catch (e) { }
  }

  static async getLastSuccessfulSync(accountId: string): Promise<number | null> {
    try {
      const v = await AsyncStorage.getItem(`sms_last_sync_${accountId}`);
      return v ? Number(v) : null;
    } catch (e) { return null; }
  }

  private static isTransactionRecorded(parsed: any, existingTransactions: Transaction[]): boolean {
    if (parsed.referenceNumber) {
      if (existingTransactions.some(t => t.reference_number === parsed.referenceNumber)) return true;
    }
    if (parsed.smsId) {
      if (existingTransactions.some(t => t.sms_id === parsed.smsId)) return true;
    }
    const timeWindow = 6 * 60 * 60 * 1000; // 6 hours
    return existingTransactions.some(t => {
      const amountMatch = Math.abs(t.amount - parsed.amount) < 0.01;
      const typeMatch = t.type === parsed.type;
      const dateMatch = Math.abs(t.date - parsed.date) < timeWindow;
      return amountMatch && typeMatch && dateMatch;
    });
  }

  private static getMockSMS(sender: string): SMSMessage[] {
    const now = Date.now();
    return [
      {
        id: 'sms_1',
        address: sender,
        body: `Dear Abel, You have transfered ETB 600.00 to Semira Kamil on 06/01/2026 at 19:07:04 from your account 1*4191. Your account has been debited with a S.charge of ETB 0.50 and 15% VAT of ETB0.08, with a total of ETB 600.58. Your Current Balance is ETB 87,413.40. Thank you for Banking with CBE!`,
        date: now - 3600000,
      },
      {
        id: 'sms_2',
        address: sender,
        body: `Dear Abel your Account 1*****4191 has been Credited with ETB 26,400.00 from Tamirat Haile, on 06/01/2026 at 16:09:11 with Ref No FT26006S91QV Your Current Balance is ETB 98,538.13.`,
        date: now - 7200000,
      },
      {
        id: 'sms_3',
        address: 'telebirr',
        body: `Dear Abel You have transferred ETB 2,000.00 to Aelmisegd Gtachwu (2519****3129) on 06/01/2026 18:22:38. Your transaction number is DA62LSQ7RI. The service fee is ETB 5.22 and 15% VAT on the service fee is ETB 0.78. Your current E-Money Account balance is ETB 3,763.87.`,
        date: now - 10800000,
      },
    ];
  }

  static async syncAllAccounts(accounts: Account[], transactions: Transaction[]) {
    for (const account of accounts) {
      if (account.sms_number) {
        await this.syncAccountSMS(account, transactions);
      }
    }
  }

  static async syncAllAccountsBackground(options: { historicalDays?: number, ignorePrevious?: boolean } = {}): Promise<SMSReconciliationResult> {
    try {
      const { getDatabase } = require('./database');
      const db = await getDatabase();
      const accounts = await db.getAccounts();
      const transactions = await db.getTransactions();

      let totalNew = 0;
      const result: SMSReconciliationResult = {
        totalSMS: 0,
        parsedTransactions: 0,
        matchedAccounts: 0,
        newDrafts: 0,
        alreadyRecorded: 0,
        drafts: [],
      };

      for (const account of accounts) {
        if (account.sms_number) {
          const res = await this.syncAccountSMS(account, transactions, options);
          result.newDrafts += res.newDrafts;
          result.drafts.push(...res.drafts);
          // Aggregate other stats if needed
        }
      }
      return result;
    } catch (e) {
      console.error('Background sync failed', e);
      return {
        totalSMS: 0,
        parsedTransactions: 0,
        matchedAccounts: 0,
        newDrafts: 0,
        alreadyRecorded: 0,
        drafts: [],
      };
    }
  }

  static async checkAllNow(accounts: Account[], transactions: Transaction[]) {
    if (Platform.OS === 'web') return;
    const hasPermission = await this.hasReadSmsPermission();
    if (!hasPermission) return;
    await this.syncAllAccounts(accounts, transactions);
    LocalChangeEmitter.emit();
  }
}

