import { EnhancedSMSParser } from '@/utils/enhancedSMSParser';
import { matchEthiopianBank } from '@/constants/ethiopianBanks';
import { statedBalance } from '@/utils/latestSmsBalance';

export interface SmsDetectionMessage {
  id: string;
  address: string;
  body: string;
  date: number;
}

export interface DetectedAccountCandidate {
  /** Stable key for list rendering and selection state: `${sender}::${accountTail}`. */
  key: string;
  sender: string;
  /** A recognized bank/wallet name, or null if this sender isn't in the directory. */
  bankName: string | null;
  /** The longest run of digits (2-4) seen identifying this account across its messages. */
  accountTail: string;
  balance: number;
  date: number;
  smsId: string;
  /** True when an existing account already has this sender + tail. */
  alreadyLinked: boolean;
}

function digitsTail(value?: string): string {
  return (value ?? '').replace(/\D/g, '').slice(-4);
}

/**
 * Pulls an account reference directly out of the raw body, for balance-only
 * alerts ("Account ****4191 available balance: ETB 0.00") that have no
 * debit/credit verb and so never parse as a transaction at all.
 */
function rawAccountTail(message: string): string {
  const match = message.match(/(?:account|a\/c|acc)\.?\s*(?:number|no)?\s*[:#]?\s*([\d*]{2,})/i);
  return digitsTail(match?.[1]);
}

interface TailObservation {
  tail: string;
  balance: number;
  date: number;
  smsId: string;
}

/**
 * Two accounts at the same bank show up as different trailing digits across
 * their SMS. But not every message exposes the same number of digits (some
 * mask down to 2, others show 4), so a message with fewer digits is merged
 * into whichever longer-tailed bucket it's a suffix of, rather than treated
 * as its own account.
 */
function mergeTailObservations(observations: TailObservation[]): TailObservation[] {
  const sorted = [...observations].sort((a, b) => b.tail.length - a.tail.length);
  const accepted: TailObservation[] = [];
  for (const obs of sorted) {
    const parent = accepted.find(a => a.tail.endsWith(obs.tail) || obs.tail.endsWith(a.tail));
    if (parent) {
      if (obs.date > parent.date) { parent.balance = obs.balance; parent.date = obs.date; parent.smsId = obs.smsId; }
      continue;
    }
    accepted.push({ ...obs });
  }
  return accepted;
}

/**
 * Groups a sender's messages by the account they belong to (by trailing
 * digits, 2-4 long) and returns one candidate per distinct account found,
 * each with its most recent stated balance.
 */
export function detectAccountCandidates(
  messagesBySender: Record<string, SmsDetectionMessage[]>,
  existingAccounts: Array<{ sms_number?: string; account_number?: string }> = [],
): DetectedAccountCandidate[] {
  const existingKeys = new Set<string>();
  for (const account of existingAccounts) {
    const tail = digitsTail(account.account_number);
    if (!tail) continue;
    for (const sender of (account.sms_number || '').split(',').map(s => s.trim()).filter(Boolean)) {
      existingKeys.add(`${sender.toLowerCase()}::${tail}`);
    }
  }

  const results: DetectedAccountCandidate[] = [];

  for (const [sender, messages] of Object.entries(messagesBySender)) {
    const bestPerTail = new Map<string, TailObservation>();

    for (const sms of messages) {
      // A balance-only alert ("Account ****4191 available balance: ETB 0.00")
      // has no debit/credit verb, so it never parses as a transaction at all —
      // fall back to reading the account and balance straight off the body.
      const parsed = EnhancedSMSParser.parseTransaction(sms.body, sms.address, sms.id, sms.date);
      const tail = digitsTail(parsed?.accountNumber) || rawAccountTail(sms.body);
      if (tail.length < 2) continue;
      const balance = parsed?.balance ?? statedBalance(sms.body);
      if (balance === undefined || !Number.isFinite(balance) || balance < 0) continue;

      const existing = bestPerTail.get(tail);
      if (!existing || sms.date > existing.date) {
        bestPerTail.set(tail, { tail, balance, date: sms.date, smsId: sms.id });
      }
    }

    const merged = mergeTailObservations([...bestPerTail.values()]);
    const bank = matchEthiopianBank(sender);

    for (const obs of merged) {
      const existingKey = `${sender.toLowerCase()}::${obs.tail}`;
      results.push({
        key: existingKey,
        sender,
        bankName: bank?.name ?? null,
        accountTail: obs.tail,
        balance: obs.balance,
        date: obs.date,
        smsId: obs.smsId,
        alreadyLinked: existingKeys.has(existingKey),
      });
    }
  }

  return results.sort((a, b) => {
    const nameCompare = (a.bankName ?? a.sender).localeCompare(b.bankName ?? b.sender);
    return nameCompare !== 0 ? nameCompare : a.accountTail.localeCompare(b.accountTail);
  });
}
