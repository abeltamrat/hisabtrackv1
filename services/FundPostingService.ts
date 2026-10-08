import { getDatabase } from './database';
import { AppNotificationService } from './AppNotificationService';
import { fundErrorCode, fundErrorMessage, FundsUnavailableError, PERMANENT_FUND_ERRORS, SharedFundService, type FundEntryInput } from './SharedFundService';
import { createSerialQueue } from '@/utils/asyncLock';
import type { Transaction } from '@/types/database';

/**
 * Sends the custodian's fund entries to the server and survives being offline.
 *
 * The job is persisted first, then the caller writes the custodian's own ledger
 * row (their real money movement, which must work offline), then the server is
 * told. A crash at any point leaves a durable job that retryPending finishes;
 * the server's entryId idempotency makes every retry safe.
 */
export interface FundPostingJob {
  id: string;            // the fund entry id
  uid: string;
  fundId: string;
  fundName: string;
  kind: 'record' | 'ack';
  entry?: FundEntryInput;
  evidence?: { reference_number?: string; receipt_url?: string; sms_linked?: boolean };
  status: 'pending' | 'failed';
  error?: string;
  createdAt: number;
}

const META_KEY = 'fund_posting_jobs';
const enqueue = createSerialQueue();

/** Local id of the custodian's ledger row for an entry. */
export const custodianTransactionId = (entryId: string) => `op-fund-${entryId}`;

export { custodianFundFields } from '@/utils/fundLedger';

type Db = Awaited<ReturnType<typeof getDatabase>>;

async function readJobs(db: Db): Promise<FundPostingJob[]> {
  const jobs = await db.readMeta(META_KEY);
  return Array.isArray(jobs) ? jobs : [];
}

export default class FundPostingService {
  private static suspended = false;
  static async suspend() { this.suspended = true; await this.settle(); }
  static resume() { this.suspended = false; }
  static settle() { return enqueue(async () => undefined); }

  /**
   * Persists the job, runs writeLocal (the caller's ledger write), then tries
   * the server once. Resolves with whether the server has it yet; a transient
   * failure keeps the job for retryPending, a permanent one marks it failed.
   */
  static submit(job: Omit<FundPostingJob, 'status' | 'createdAt'>, writeLocal?: () => Promise<unknown>): Promise<{ synced: boolean; error?: string }> {
    if (this.suspended) return Promise.reject(new Error('Fund syncing is paused'));
    return enqueue(async () => {
      if (this.suspended) throw new Error('Fund syncing is paused');
      const db = await getDatabase();
      if (db.scope !== job.uid) throw new Error('Session changed');
      const jobs = await readJobs(db);
      if (!jobs.some(item => item.id === job.id)) {
        await db.writeMeta(META_KEY, [...jobs, { ...job, status: 'pending', createdAt: Date.now() } satisfies FundPostingJob]);
      }
      if (writeLocal) {
        try {
          await writeLocal();
        } catch (error) {
          // Nothing reached the ledger, so nothing should reach the fund either.
          await db.writeMeta(META_KEY, (await readJobs(db)).filter(item => item.id !== job.id));
          throw error;
        }
      }
      return this.process(db, { ...job, status: 'pending', createdAt: Date.now() });
    });
  }

  private static async process(db: Db, job: FundPostingJob): Promise<{ synced: boolean; error?: string }> {
    try {
      if (job.kind === 'record' && job.entry) await SharedFundService.record(job.fundId, job.id, job.entry);
      else if (job.kind === 'ack') await SharedFundService.ack(job.fundId, job.id, job.evidence);
      await db.writeMeta(META_KEY, (await readJobs(db)).filter(item => item.id !== job.id));
      return { synced: true };
    } catch (error) {
      const permanent = !(error instanceof FundsUnavailableError) && PERMANENT_FUND_ERRORS.has(fundErrorCode(error));
      if (!permanent) return { synced: false };
      const message = fundErrorMessage(error);
      await db.writeMeta(META_KEY, (await readJobs(db)).map(item => (item.id === job.id ? { ...item, status: 'failed', error: message } : item)));
      await AppNotificationService.addNotification({
        title: `Not added to ${job.fundName}`,
        message: `${message} Open the fund to retry or keep it as your own transaction.`,
        type: 'warning',
        icon: 'exclamation-triangle',
        color: '#f59e0b',
        actionType: 'view_funds',
        fundId: job.fundId,
        sourceKey: `fund-job-failed-${job.id}`,
      }).catch(() => undefined);
      return { synced: false, error: message };
    }
  }

  static retryPending() {
    return enqueue(async () => {
      if (this.suspended) return;
      const db = await getDatabase();
      for (const job of await readJobs(db)) {
        if (job.uid !== db.scope || job.status !== 'pending') continue;
        try { await this.process(db, job); } catch { /* Keep the durable job for a later retry. */ }
      }
    });
  }

  static async getJobs(fundId?: string): Promise<FundPostingJob[]> {
    const db = await getDatabase();
    return (await readJobs(db)).filter(job => job.uid === db.scope && (!fundId || job.fundId === fundId));
  }

  /** Puts a failed job back in line and tries it now. */
  static retry(jobId: string) {
    return enqueue(async () => {
      const db = await getDatabase();
      const job = (await readJobs(db)).find(item => item.id === jobId);
      if (!job) return { synced: true };
      return this.process(db, { ...job, status: 'pending' });
    });
  }

  /**
   * Gives up on sending a failed entry: the custodian's ledger row becomes an
   * ordinary personal transaction (no fund link, counted in their reports).
   */
  static keepAsPersonal(jobId: string) {
    return enqueue(async () => {
      const db = await getDatabase();
      const jobs = await readJobs(db);
      const job = jobs.find(item => item.id === jobId);
      const row = await db.getTransactionById(custodianTransactionId(jobId));
      if (row) {
        const { id: _id, fund_id: _fund, fund_entry_id: _entry, operation_id: _op, purpose: _purpose, ...rest } = row;
        await db.deleteTransaction(row.id, true);
        await db.createTransaction({ ...rest, purpose: 'OPERATING' } as Omit<Transaction, 'id'>);
      }
      if (job) await db.writeMeta(META_KEY, jobs.filter(item => item.id !== jobId));
    });
  }

  /**
   * Takes back what this device did for an entry: a recorded entry is voided,
   * a confirmed deposit goes back to "expected". If the server never saw it,
   * the job is simply dropped. Either way the custodian's ledger row goes.
   */
  static undo(fundId: string, entryId: string, kind: FundPostingJob['kind'], reason?: string) {
    return enqueue(async () => {
      const db = await getDatabase();
      const jobs = await readJobs(db);
      if (jobs.some(item => item.id === entryId)) await db.writeMeta(META_KEY, jobs.filter(item => item.id !== entryId));
      else if (kind === 'record') await SharedFundService.void(fundId, entryId, reason);
      else await SharedFundService.unack(fundId, entryId);
      const row = await db.getTransactionById(custodianTransactionId(entryId));
      if (row) await db.deleteTransaction(row.id, true);
    });
  }
}
