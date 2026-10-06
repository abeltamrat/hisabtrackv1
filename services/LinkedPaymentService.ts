import { getDatabase } from './database';
import { LinkedLoanService } from './LinkedLoanService';
import { createSerialQueue } from '@/utils/asyncLock';
import type { LinkRole, Transaction } from '@/types/database';
export interface LinkedPaymentJob {
  id: string; sharedLoanId: string; repaymentId: string; uid: string; name: string;
  kind: 'record' | 'confirm'; role: LinkRole; amount: number; date: number;
  transaction: Omit<Transaction, 'id'>;
}
const enqueue = createSerialQueue();
export default class LinkedPaymentService {
  private static suspended = false;
  static async suspend() { this.suspended = true; await this.settle(); }
  static resume() { this.suspended = false; }
  static settle() { return enqueue(async () => undefined); }
  static save(job: LinkedPaymentJob) {
    if (this.suspended) return Promise.reject(new Error('Payment processing is paused'));
    return enqueue(async () => {
      if (this.suspended) throw new Error('Payment processing is paused');
      const db = await getDatabase();
      if (db.scope !== job.uid) throw new Error('Session changed');
      const jobs: LinkedPaymentJob[] = await db.readMeta('linked_payment_jobs') || [];
      const old = jobs.find(j => j.id === job.id);
      if (old && (old.amount !== job.amount || old.transaction.account_id !== job.transaction.account_id)) throw new Error('Pending payment uses different details. Retry with the original account.');
      if (!old) await db.writeMeta('linked_payment_jobs', [...jobs, job]);
      await this.process(db, job);
    });
  }
  private static async process(db: Awaited<ReturnType<typeof getDatabase>>, job: LinkedPaymentJob) {
    if (job.kind === 'record') await LinkedLoanService.addRepayment(job.sharedLoanId, {
      amount: job.amount, date: job.date, recordedByUid: job.uid, recordedBy: job.role, status: 'PENDING_CONFIRMATION',
    }, job.name, job.repaymentId);
    else await LinkedLoanService.confirmRepayment(job.sharedLoanId, job.repaymentId, job.uid, job.name);
    await db.createTransaction({ ...job.transaction, purpose: 'FINANCING', operation_id: job.id });
    await db.allocateLinkedInterest(job.sharedLoanId, await LinkedLoanService.getRepayments(job.sharedLoanId));
    const jobs: LinkedPaymentJob[] = await db.readMeta('linked_payment_jobs') || [];
    await db.writeMeta('linked_payment_jobs', jobs.filter(j => j.id !== job.id));
  }
  static retryPending() {
    return enqueue(async () => {
      if (this.suspended) return;
      const db = await getDatabase();
      for (const loan of await db.getLoans()) {
        if (loan.shared_loan_id && loan.link_status === 'ACCEPTED') {
          try { await db.allocateLinkedInterest(loan.shared_loan_id, await LinkedLoanService.getRepayments(loan.shared_loan_id)); } catch { /* Retry on the next foreground refresh. */ }
        }
      }
      for (const job of (await db.readMeta('linked_payment_jobs') || []) as LinkedPaymentJob[]) {
        if (job.uid !== db.scope) continue;
        try { await this.process(db, job); } catch { /* Keep the durable job for a later retry. */ }
      }
    });
  }
}
