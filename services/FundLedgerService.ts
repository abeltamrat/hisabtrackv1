import { getDatabase } from './database';
import { createSerialQueue } from '@/utils/asyncLock';
import { mirrorSignature, mirrorTransactionId, planFundMirror, type FundAction } from '@/utils/fundLedger';
import type { Account, FundEntry, SharedFund } from '@/types/database';

/**
 * Keeps the owner's own books in step with a shared fund.
 *
 * Mirror rows are derived data: each one is rebuilt from its fund entry, so
 * reconcile can run on every device, any number of times, and converge.
 * It never throws to the UI; problems come back as `error`.
 */
export interface ReconcileResult {
  fundAccountId?: string;
  actions: FundAction[];
  changed: boolean;
  error?: string;
}

const queue = createSerialQueue();

export function fundAccountName(fund: SharedFund): string {
  return `Fund – ${fund.custodianName || fund.name}`.slice(0, 60);
}

export default class FundLedgerService {
  /** The owner's cash account for this fund, if it exists yet. */
  static findFundAccount(accounts: Account[], fundId: string): Account | undefined {
    return accounts.find(account => account.fund_id === fundId);
  }

  static reconcile(fund: SharedFund, entries: FundEntry[], ownerUid: string, returnAccountId?: string): Promise<ReconcileResult> {
    return queue(async () => {
      try {
        if (fund.ownerUid !== ownerUid) return { actions: [], changed: false };
        const db = await getDatabase();
        if (db.scope !== ownerUid) return { actions: [], changed: false };

        const accounts = await db.getAccounts();
        let fundAccount = this.findFundAccount(accounts, fund.id);
        const hasActivity = entries.some(entry => entry.status === 'ACTIVE');
        if (!fundAccount && !hasActivity) return { actions: [], changed: false };
        if (!fundAccount) {
          const currency = accounts[0]?.currency ?? fund.currency;
          if (currency !== fund.currency) {
            return { actions: [], changed: false, error: `This fund is in ${fund.currency} but your books are in ${currency}.` };
          }
          fundAccount = await db.createAccount({
            name: fundAccountName(fund), type: 'CASH', balance: 0, currency,
            is_locked: false, locked_amount: 0, fund_id: fund.id,
          } as Omit<Account, 'id' | 'created_at'>);
        }

        const plan = planFundMirror(fund, entries, {
          fundAccountId: fundAccount.id,
          returnAccountId,
          accountIds: new Set(accounts.map(account => account.id)),
        });

        const wanted = new Map(plan.rows.map(row => [mirrorTransactionId(row.entryId), row]));
        const existing = (await db.getTransactions()).filter(row => row.fund_id === fund.id && row.fund_mirror);
        let changed = false;

        for (const row of existing) {
          if (!wanted.has(row.id)) { await db.deleteTransaction(row.id, true); changed = true; }
        }
        for (const [id, row] of wanted) {
          const current = existing.find(item => item.id === id);
          if (current && mirrorSignature(current) === mirrorSignature(row.input)) continue;
          if (current) await db.deleteTransaction(id, true);
          await db.createTransaction(row.input);
          changed = true;
        }
        return { fundAccountId: fundAccount.id, actions: plan.actions, changed };
      } catch (error) {
        return { actions: [], changed: false, error: error instanceof Error ? error.message : 'Could not update your books.' };
      }
    });
  }
}
