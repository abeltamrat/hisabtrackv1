import { Account, Transaction } from '@/types/database';
import { EnhancedSMSParser } from '@/utils/enhancedSMSParser';
import AsyncStorage from '@/services/SessionStorage';
import { Platform } from 'react-native';
import { DraftTransaction, DraftTransactionService } from './DraftTransactionService';
import LocalChangeEmitter from './LocalChangeEmitter';
import { SMSLearningService } from './SMSLearningService';
import { StorageService } from '@/utils/storage';
import { createSerialQueue } from '@/utils/asyncLock';
import { findSelfTransferPairs } from '@/utils/transferPairing';
import { SMSAICalibrationService } from './SMSAICalibrationService';

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

  // Serializes account syncs: the foreground timer, AppState resume handler,
  // background task, and manual pull-to-refresh can all fire concurrently, and
  // overlapping runs would race on the shared draft store and double-create drafts.
  private static syncQueue = createSerialQueue();
  private static suspended = true;
  static async suspend() { this.suspended = true; await this.syncQueue(async () => undefined); }
  static resume() { this.suspended = false; }
  private static backgroundSyncInFlight = new Map<string, Promise<SMSReconciliationResult>>();

  static setSyncStatusListener(listener: (status: { accountId: string, status: string, progress: number }) => void) {
    this.SYNC_STATUS_LISTENER = listener;
  }

  static clearSyncStatusListener() {
    this.SYNC_STATUS_LISTENER = null;
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
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        ]);
        return granted[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED
          && granted[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED;
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
      const [canRead, canReceive] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
      ]);
      return canRead && canReceive;
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
    sinceTimestamp?: number,
    indexFrom = 0,
    maxDate = Date.now()
  ): Promise<SMSMessage[]> {
    // Mock messages are a dev-only convenience; production web must not
    // fabricate drafts.
    if (Platform.OS === 'web') return __DEV__ ? this.getMockSMS(sender) : [];
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
          maxCount: 200,
          indexFrom,
          maxDate,
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

        if (result.length === 200) return [...result, ...await this.readSMSFromSender(sender, sinceTimestamp, indexFrom + result.length, maxDate)];
        return result;
      } catch (error) {
        console.warn(`[SMS] Read attempt ${attempt} failed:`, error);
        if (attempt === MAX_RETRIES) {
          console.error('[SMS] All attempts failed. Returning empty list.');
          throw error;
        }
        // Wait briefly before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return [];
  }

  /**
   * Sync SMS for a specific account. Runs are serialized through syncQueue so
   * concurrent triggers can't interleave draft reads/writes.
   */
  static syncAccountSMS(
    account: Account,
    existingTransactions: Transaction[],
    options: { historicalDays?: number, ignorePrevious?: boolean, allAccounts?: Account[] } = {}
  ): Promise<SMSReconciliationResult> {
    if (this.suspended) return Promise.reject(new Error('SMS scanning is unavailable during session changes'));
    return this.syncQueue(() => { if (this.suspended) throw new Error('SMS scanning paused'); return this.doSyncAccountSMS(account, existingTransactions, options); });
  }

  private static async doSyncAccountSMS(
    account: Account,
    existingTransactions: Transaction[],
    options: { historicalDays?: number, ignorePrevious?: boolean, allAccounts?: Account[] } = {}
  ): Promise<SMSReconciliationResult> {
    const scanStartedAt = Date.now();
    const result: SMSReconciliationResult = {
      totalSMS: 0,
      parsedTransactions: 0,
      matchedAccounts: 0,
      newDrafts: 0,
      alreadyRecorded: 0,
      drafts: [],
    };

    if (!account.sms_number) return result;

    const userCategories = await StorageService.loadCategories();

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
        // Default to 30 days back on first sync so users get recent history
        sinceTimestamp = lastSync ?? (Date.now() - 30 * 24 * 60 * 60 * 1000);
      }

      for (const sender of senders) {
        const messages = await this.readSMSFromSender(sender, sinceTimestamp);
        // Safety: Limit messages to avoid memory/crash issues if history is huge.
        // The SMS provider returns newest-first, so keep the head of the list —
        // slice(-200) would keep the oldest 200 and drop the recent ones.
        allMessages.push(...messages);
      }

      result.totalSMS = allMessages.length;
      allMessages.sort((a, b) => a.date - b.date);

      this.emitStatus(account.id, `Processing ${allMessages.length} Messages...`, 30);

      // Cache existing draft sms_ids to speed up duplicate check
      const existingDrafts = await DraftTransactionService.getAll();
      const draftsToAdd: Omit<DraftTransaction, 'id' | 'created_at'>[] = [];

      // Load app settings to check if Gemini/AI keys are configured
      let appSettings: any = null;
      const calibrationExamples = await SMSAICalibrationService.getForAccount(account.id);
      try {
        const { loadStoredAppSettings } = require('@/contexts/AppSettingsContext');
        appSettings = await loadStoredAppSettings();
      } catch (e) {
        console.warn('[SMS] Failed to load app settings for AI fallback:', e);
      }

      for (let i = 0; i < allMessages.length; i++) {
        const sms = allMessages[i];
        const progress = 30 + (Math.floor((i / allMessages.length) * 60));
        if (i % 5 === 0) this.emitStatus(account.id, `Parsing message ${i + 1}/${allMessages.length}...`, progress);

        let parsed = EnhancedSMSParser.parseTransaction(sms.body, sms.address, sms.id, sms.date);
        
        // AI Fallback parsing if regex failed and a Gemini API key (or fallback provider) is configured
        if (!parsed && appSettings?.aiSharingEnabled && (appSettings.geminiApiKey || appSettings.groqApiKey || appSettings.openRouterApiKey)) {
          const hasFinancialKeywords = /(?:birr|etb|br|usd|amt|amount|debited|credited|spent|paid|received|deposited|transfer|send|sent|transferred|ref)/i.test(sms.body);
          if (hasFinancialKeywords) {
            try {
              const { AIFinancialAssistant } = require('./AIFinancialAssistant');
              const aiParsed = await AIFinancialAssistant.parseSMS(sms.body, {
                geminiApiKey: appSettings.geminiApiKey,
                groqApiKey: appSettings.groqApiKey,
                openRouterApiKey: appSettings.openRouterApiKey
              }, calibrationExamples);
              if (aiParsed && aiParsed.amount) {
                parsed = {
                  amount: aiParsed.amount,
                  type: aiParsed.type || 'EXPENSE',
                  accountNumber: aiParsed.accountNumber,
                  merchant: aiParsed.merchant,
                  date: sms.date,
                  balance: aiParsed.balance,
                  fees: aiParsed.fees,
                  tax: aiParsed.tax,
                  referenceNumber: aiParsed.referenceNumber,
                  rawMessage: sms.body,
                  smsId: sms.id || '',
                  sender: sms.address,
                  categoryHint: EnhancedSMSParser.suggestCategoryHint(aiParsed.merchant, sms.body, aiParsed.type || 'EXPENSE')
                  ,isLoanDisbursement: aiParsed.isLoanDisbursement ||
                    ((aiParsed.type || 'EXPENSE') === 'INCOME' && EnhancedSMSParser.detectLoanDisbursement(sms.body)) || undefined
                };
              }
            } catch (err) {
              console.warn('[SMS] AI fallback parsing failed:', err);
            }
          }
        }

        if (!parsed) continue;

        const isAlreadyInDrafts = [...existingDrafts, ...draftsToAdd].some(d =>
          d.account_id === account.id && ((sms.id && d.sms_id === sms.id) ||
          (parsed!.referenceNumber && d.reference_number === parsed!.referenceNumber && d.type === parsed!.type))
        );

        if (isAlreadyInDrafts) {
          result.alreadyRecorded++;
          continue;
        }

        result.parsedTransactions++;

        // Account Identification Logic:
        // Only reject on account number when the SMS exposes ≥ 4 visible digits —
        // shorter masked tails (e.g. "1*49" → "49") are too ambiguous to route reliably.
        // When the filter applies, the digits must match as a suffix of the stored account number.
        if (parsed.accountNumber && account.account_number) {
          const accNum = account.account_number.replace(/\D/g, '');
          const smsDigits = parsed.accountNumber.replace(/\D/g, '');
          if (smsDigits.length >= 4) {
            const minLen = Math.min(accNum.length, smsDigits.length);
            if (minLen >= 4 && !accNum.endsWith(smsDigits.slice(-minLen)) && !smsDigits.endsWith(accNum.slice(-minLen))) {
              // SMS clearly belongs to a different account (shared sender, ≥4 digits differ)
              continue;
            }
          } else if (smsDigits.length >= 2 && accNum.length >= smsDigits.length && !accNum.endsWith(smsDigits)) {
            // Short masked tail that doesn't match this account: if it does match a
            // sibling SMS-enabled account, let that account's sync claim the draft
            // instead of first-come-first-served routing to the wrong account.
            const sibling = (options.allAccounts ?? []).find(a =>
              a.id !== account.id &&
              !!a.sms_number &&
              (a.account_number ?? '').replace(/\D/g, '').endsWith(smsDigits)
            );
            if (sibling) continue;
          }
        }

        result.matchedAccounts++;
        const isAlreadyRecorded = this.isTransactionRecorded(parsed, existingTransactions.filter(t => t.account_id === account.id || t.to_account_id === account.id));

        // ── Transfer detection ──────────────────────────────────────────────
        let isTransfer = false;
        let transferToAccountId: string | undefined;
        let transferFromAccountId: string | undefined;
        let transferPeerAccountNumber: string | undefined;

        if (parsed.isTransfer) {
          isTransfer = true;
          const allAccts = options.allAccounts ?? [];

          const matchAcctNumber = (storedNumber: string | undefined, smsDigits: string): boolean => {
            if (!storedNumber) return false;
            const n = storedNumber.replace(/\D/g, '');
            const d = smsDigits.replace(/\D/g, '');
            if (!n || !d || d.length < 2) return false;
            return n.endsWith(d) || d.endsWith(n.slice(-d.length));
          };

          if (parsed.type === 'EXPENSE' && parsed.transferToAccountNumber) {
            transferPeerAccountNumber = parsed.transferToAccountNumber;
            const toAcct = allAccts.find(a => a.id !== account.id && matchAcctNumber(a.account_number, parsed.transferToAccountNumber!));
            if (toAcct) transferToAccountId = toAcct.id;
          } else if (parsed.type === 'INCOME' && parsed.transferFromAccountNumber) {
            transferPeerAccountNumber = parsed.transferFromAccountNumber;
            const fromAcct = allAccts.find(a => a.id !== account.id && matchAcctNumber(a.account_number, parsed.transferFromAccountNumber!));
            if (fromAcct) transferFromAccountId = fromAcct.id;
          }

          // Dedup: skip INCOME side if the EXPENSE (source) draft was already created
          if (parsed.type === 'INCOME') {
            const timeWindow = 6 * 60 * 60 * 1000;
            const hasExpenseSide =
              existingDrafts.some(d =>
                d.is_transfer && d.type === 'EXPENSE' &&
                Math.abs(d.amount - parsed.amount) < 0.01 &&
                Math.abs(d.date - parsed.date) < timeWindow
              ) ||
              draftsToAdd.some(d =>
                (d as any).is_transfer && d.type === 'EXPENSE' &&
                Math.abs(d.amount - parsed.amount) < 0.01 &&
                Math.abs(d.date - parsed.date) < timeWindow
              );
            if (hasExpenseSide) {
              result.alreadyRecorded++;
              continue;
            }
          }
        }
        // ────────────────────────────────────────────────────────────────────

        // Learning & Category Suggestion
        const categoryHint = parsed.categoryHint || EnhancedSMSParser.suggestCategoryHint(parsed.merchant, parsed.rawMessage, parsed.type);
        let category = isTransfer ? 'Transfer' : EnhancedSMSParser.matchCategory(categoryHint, userCategories, parsed.type);
        let description = parsed.merchant
          ? `${parsed.type === 'INCOME' ? 'Received from' : 'Transfer to'} ${parsed.merchant}`
          : `${parsed.type === 'INCOME' ? 'Received' : 'Paid'} via ${sms.address}`;

        if (!isTransfer) {
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
        }

        const draft: Omit<DraftTransaction, 'id' | 'created_at'> = {
          account_id: account.id,
          type: parsed.type,
          amount: parsed.amount,
          gross_amount: parsed.grossAmount,
          category,
          description,
          date: parsed.date,
          sms_id: parsed.smsId,
          sms_sender: sms.address,
          sender_receiver: parsed.merchant,
          reference_number: parsed.referenceNumber,
          fees: parsed.fees,
          tax: parsed.tax,
          service_charge: parsed.serviceCharge,
          vat: parsed.vat,
          disaster_recovery_fee: parsed.disasterRecoveryFee,
          suggested_balance: parsed.balance,
          raw_sms: parsed.rawMessage,
          receipt_url: parsed.receiptUrl,
          status: isAlreadyRecorded ? 'RECORDED' : 'PENDING',
          is_recorded: isAlreadyRecorded,
          categoryHint,
          is_transfer: isTransfer || undefined,
          transfer_to_account_id: transferToAccountId,
          transfer_from_account_id: transferFromAccountId,
          transfer_peer_account_number: transferPeerAccountNumber,
          is_loan_disbursement: parsed.isLoanDisbursement || undefined,
        };

        draftsToAdd.push(draft);
        if (!isAlreadyRecorded) result.newDrafts++;
        else result.alreadyRecorded++;
      }

      if (draftsToAdd.length > 0) {
        const savedDrafts = await DraftTransactionService.addMany(draftsToAdd);
        result.drafts.push(...savedDrafts);
      }

      // Link debit/credit legs of transfers between the user's own accounts
      // (e.g. CBE → Telebirr): both banks text within minutes, so pair by
      // amount + time across accounts even when neither SMS says "your account".
      // Runs even when this sync added nothing so legs created in earlier runs
      // still get paired once their counterpart shows up.
      const pairedCount = await this.pairCrossAccountTransfers(options.allAccounts ?? []);
      if (pairedCount > 0 && result.drafts.length > 0) {
        // Refresh returned drafts so notifications/callers see paired fields.
        const fresh = await DraftTransactionService.getAll();
        result.drafts = result.drafts.map(d => fresh.find(f => f.id === d.id) ?? d);
      }

      this.emitStatus(account.id, 'Sync Complete', 100);
      // Only advance lastSync when SMS were actually found; if 0 were read,
      // keep the old timestamp so the next sync re-scans the same window.
      if (result.totalSMS > 0) {
        await this.setLastSuccessfulSync(account.id, scanStartedAt - 60000);
      }
      return result;
    } catch (error) {
      console.error(`[SMS] Sync failed for account ${account.id}:`, error);
      this.emitStatus(account.id, 'Sync Failed', 0);
      result.failed = true;
      return result;
    }
  }

  /**
   * Pair PENDING expense/income drafts on different accounts that represent
   * the two legs of one own-account transfer, and rewrite both drafts so
   * recording either leg produces a single TRANSFER transaction.
   * Returns the number of pairs linked.
   */
  static async pairCrossAccountTransfers(allAccounts: Account[] = []): Promise<number> {
    try {
      const drafts = await DraftTransactionService.getAll();
      const pairs = findSelfTransferPairs(drafts);
      if (pairs.length === 0) return 0;

      const nameOf = (id: string) => allAccounts.find(a => a.id === id)?.name;
      const byId = new Map(drafts.map(d => [d.id, d]));
      const patches: Array<{ id: string; patch: Partial<DraftTransaction> }> = [];
      for (const pair of pairs) {
        const toName = nameOf(pair.incomeAccountId);
        const fromName = nameOf(pair.expenseAccountId);
        const expenseLeg = byId.get(pair.expenseId);
        patches.push({
          id: pair.expenseId,
          patch: {
            is_transfer: true,
            transfer_to_account_id: pair.incomeAccountId,
            paired_draft_id: pair.incomeId,
            category: 'Transfer',
            description: toName ? `Transfer to ${toName}` : 'Transfer to own account',
          },
        });
        patches.push({
          id: pair.incomeId,
          patch: {
            is_transfer: true,
            transfer_from_account_id: pair.expenseAccountId,
            paired_draft_id: pair.expenseId,
            category: 'Transfer',
            description: fromName ? `Transfer from ${fromName}` : 'Transfer from own account',
            // Carry the sender-side charges so recording from this leg can
            // reconstruct the gross source debit (amount + fees + tax).
            fees: expenseLeg?.fees,
            tax: expenseLeg?.tax,
          },
        });
      }
      await DraftTransactionService.updateMany(patches);
      return pairs.length;
    } catch (e) {
      console.warn('[SMS] Transfer pairing failed:', e);
      return 0;
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
    return false; // Ambiguous amount/time matches remain available for human review.
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
        await this.syncAccountSMS(account, transactions, { allAccounts: accounts });
      }
    }
  }

  /**
   * Full sync of every SMS-enabled account. Concurrent callers (foreground
   * timer, resume handler, background task) coalesce onto the in-flight run.
   */
  static syncAllAccountsBackground(options: { historicalDays?: number, ignorePrevious?: boolean } = {}): Promise<SMSReconciliationResult> {
    // Coalesce only equivalent requests. A manual historical resync must not be
    // swallowed by a smaller foreground sync that happens to already be running.
    const requestKey = JSON.stringify({
      historicalDays: options.historicalDays ?? null,
      ignorePrevious: options.ignorePrevious ?? false,
    });
    const inFlight = this.backgroundSyncInFlight.get(requestKey);
    if (inFlight) return inFlight;

    const run = this.doSyncAllAccountsBackground(options).finally(() => {
      this.backgroundSyncInFlight.delete(requestKey);
    });
    this.backgroundSyncInFlight.set(requestKey, run);
    return run;
  }

  private static async doSyncAllAccountsBackground(options: { historicalDays?: number, ignorePrevious?: boolean } = {}): Promise<SMSReconciliationResult> {
    try {
      const { getDatabase } = require('./database');
      const db = await getDatabase();
      const accounts = await db.getAccounts();
      const transactions = await db.getTransactions();

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
          const res = await this.syncAccountSMS(account, transactions, { ...options, allAccounts: accounts });
          result.newDrafts += res.newDrafts;
          result.drafts.push(...res.drafts);
          if (res.failed) result.failed = true;
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
        failed: true,
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

