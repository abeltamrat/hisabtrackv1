import { EnhancedSMSParser } from '@/utils/enhancedSMSParser';

export interface SmsBalanceMessage {
  id: string;
  address: string;
  body: string;
  date: number;
}

export interface LatestSmsBalance {
  balance: number;
  date: number;
  smsId: string;
  sender: string;
  accountNumber?: string;
}

function accountTail(value?: string): string {
  return (value ?? '').replace(/\D/g, '').slice(-4);
}

function statedBalance(message: string): number | undefined {
  const match = message.match(
    /(?:current\s+|available\s+|updated\s+)?(?:e-money\s+|telebirr\s+account\s+)?balance\s*(?:is|:)?\s*(?:now\s+)?(?:birr|etb|br|usd|rs\.?|inr|₹|\$)?\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (!match?.[1]) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Returns the newest stated balance without retaining the SMS body. When an
 * account number is supplied, messages that expose a different account suffix
 * are rejected so shared bank sender IDs cannot initialize the wrong account.
 */
export function findLatestSmsBalance(
  messages: SmsBalanceMessage[],
  accountNumber?: string,
): LatestSmsBalance | null {
  const wantedTail = accountTail(accountNumber);
  const sorted = [...messages].sort((a, b) => b.date - a.date);

  for (const sms of sorted) {
    const parsed = EnhancedSMSParser.parseTransaction(sms.body, sms.address, sms.id, sms.date);
    const parsedTail = accountTail(parsed?.accountNumber);

    if (wantedTail) {
      if (parsedTail && parsedTail !== wantedTail) continue;
      // Some balance alerts are not full transactions and therefore do not
      // parse an account number. If they expose the requested suffix in their
      // body, they are still safe to use; otherwise leave the balance manual.
      if (!parsedTail && !sms.body.replace(/\s/g, '').includes(wantedTail)) continue;
    }

    const balance = parsed?.balance ?? statedBalance(sms.body);
    if (balance === undefined || !Number.isFinite(balance) || balance < 0) continue;

    return {
      balance,
      date: sms.date,
      smsId: sms.id,
      sender: sms.address,
      accountNumber: parsed?.accountNumber,
    };
  }

  return null;
}
