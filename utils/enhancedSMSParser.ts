export interface ParsedSMSTransaction {
  amount: number;
  grossAmount?: number;
  type: 'INCOME' | 'EXPENSE';
  accountNumber?: string;
  merchant?: string;
  date: number;
  balance?: number;
  fees?: number;
  tax?: number;
  serviceCharge?: number;
  vat?: number;
  disasterRecoveryFee?: number;
  referenceNumber?: string;
  receiptUrl?: string;
  rawMessage: string;
  smsId: string;
  sender: string;
  categoryHint?: string;
  isTransfer?: boolean;
  transferToAccountNumber?: string;
  transferFromAccountNumber?: string;
  isLoanDisbursement?: boolean;
}

// Shared terminators that end a merchant name capture
const MERCHANT_END = `(?:[,.]?\\s+(?:on|at|dated|with|from|via|ref|in\\s+bank)|[,.]?\\s*\\(|\\s+\\d|$)`;

const ENHANCED_SMS_PATTERNS: Record<string, any> = {
  // ─── Commercial Bank of Ethiopia ───────────────────────────────────────────
  cbe: {
    debit: [
      // "transferred ETB 560.00" / "transfered ETB 600.00" (CBE's own single-r
      // spelling) / "debited with ETB25,000.00" (no space before digits OK due to \s*)
      /(?:transferr?ed|debited|withdrawn|paid|spent)\s+(?:with\s+)?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      // "total of ETB 25132.00" — overrides base amount (applied separately in parseTransaction)
      /total\s+of\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      // "Credited with ETB 200,000.00"
      /(?:credited|received|deposited)\s+(?:with\s+)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      /(?:credited|received|deposited).*?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    ],
    // "Account 1*4191" or "account 1*****4191"
    accountNumber: /account\s+([\d*\\]+)/i,
    balance: /(?:current\s+)?balance\s+is\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    fees: /(?:s\.?\s*charge|service\s+charge)\s+(?:of\s+)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    tax: /vat\s*(?:\([^)]+\))?\s+of\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    disasterRecoveryFee: /disaster\s+recovery\s*(?:\([^)]+\))?\s+of\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    // "Ref No FT261751639Z" or "?id=FT..." (URL-based, handled in extractReference)
    reference: /(?:ref(?:erence)?\s*no\.?\s*([A-Z0-9]{6,}))/i,
    merchant: [
      // "to account 1**8885 (Abduletif Awol Ebrahim)"
      /to\s+account\s+[\d*]+\s*\(([A-Za-z][A-Za-z\s&.'\-]+)\)/i,
      // "from account 1**2089 (Abel Getachew Tadessie)"
      /from\s+account\s+[\d*]+\s*\(([A-Za-z][A-Za-z\s&.'\-]+)\)/i,
      new RegExp(`(?:transferr?ed\\s+to|to)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
      new RegExp(`from\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+at\s+(\d{2}:\d{2}:\d{2})/i,
    receiptUrl: /https?:\/\/(?:apps|mbreciept)\.cbe\.com\.et[^\s]*/i,
  },

  // ─── Telebirr / Ethio Telecom ──────────────────────────────────────────────
  telebirr: {
    debit: [
      // "paid ETB 82.00" / "transferred ETB 700.00"
      /(?:paid|spent|charged|transferr?ed)\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      /repaid\s+([\d,]+\.?\d*)\s*(?:birr|etb|br)/i,
      /paid\s+(?:a\s+)?credit\s+amount\s+of\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      /paid\s+for\s+[^.]{0,80}?\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      // "Transfer of 4,000.00 ETB" (amount before currency — Awash→Telebirr format)
      /(?:transfer(?:red)?)\s+of\s+([\d,]+\.?\d*)/i,
    ],
    credit: [
      // "received  ETB 15,000.00"
      /received\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      // "loan of ETB 5,000.00 has been credited"
      /loan\s+of\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)\s+has\s+been\s+credited/i,
      // "credited with ETB 5,000.00" / "credited ... ETB 5,000.00"
      /credited\s+(?:with\s+)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:account|acc)\s*(\d{6,16})/i,
    balance: /(?:current.*?)?(?:(?:e-money|telebirr)\s+account\s+)?balance\s+is\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    fees: /service\s+fee\s+is\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?is\s+(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    // "transaction number is  DFO184MOZD" or "by transaction number DFN67FUSM4"
    reference: /(?:by\s+)?(?:telebirr\s+)?transaction\s+number\s+(?:is\s+)?([A-Z0-9]{6,})/i,
    merchant: [
      /purchased\s+from\s+\d+\s*-\s*([A-Za-z][A-Za-z\s&.'\-]+?)\s+for\s+plate/i,
      /\bto\s+\d+\s*-\s*([A-Za-z][A-Za-z\s&.'\-]+?)\s*;\s*with\s+Payment/i,
      /from\s+([A-Za-z][A-Za-z\s&.'\-]+?)\s+to\s+your\s+telebirr\s+Account/i,
      /to\s+(Commercial\s+Bank\s+of\s+Ethiopia)\s+account\s+number/i,
      // "to WENDIMU DAMISE (2519****9356)" — name before phone in parens
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)\\s*(?:\\(\\d|${MERCHANT_END})`, 'i'),
      // "for package Monthly Internet Package" (bill payment)
      /for\s+package\s+([^.]+?)\s+(?:purchase|for\s+\d)/i,
    ],
    date: /on\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    dateAlt: /on\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
    receiptUrl: /https?:\/\/transactioninfo\.ethiotelecom\.et[^\s]*/i,
  },

  // ─── Bank of Abyssinia ─────────────────────────────────────────────────────
  boa: {
    debit: [
      // "was debited with ETB 195,000.00"
      /(?:debited|withdrawn|paid|charged)\s+(?:with\s+)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      // "was credited with ETB 40,000.00"
      /(?:credited)\s+(?:with\s+)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      /(?:received|deposited).*?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    ],
    // "account 1*49" — extract last digit cluster
    accountNumber: /account\s+([\d*\\]+)/i,
    // "Available Balance: ETB 5,459.42"
    balance: /(?:available\s+)?balance\s*:?\s*(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    // Reference comes from URL ?trx=... (handled in extractReference)
    reference: /receipt\s*:?\s*([A-Z0-9]{6,})/i,
    merchant: [
      // "credited ... by Mscwt . Available Balance"
      /\bby\s+([A-Za-z][A-Za-z\s&.'\-]*?)\s*\.\s*Available\s+Balance/i,
      // "by  Abel Tamirat Mengistu" (credit from name)
      new RegExp(`by\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i,
    receiptUrl: /https?:\/\/cs\.bankofabyssinia\.com[^\s]*/i,
  },

  // ─── Awash Bank ────────────────────────────────────────────────────────────
  awash: {
    debit: [
      // "transferred to other bank ETB  40,000"
      /(?:transferr?ed|transfer)\s+(?:to\s+other\s+bank\s+)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      // "Transfer of 4,000.00 ETB" (amount before currency)
      /transfer(?:red)?\s+of\s+([\d,]+\.?\d*)/i,
      // "withdrawal request of 50,000.00"
      /withdrawal\s+request\s+of\s+([\d,]+\.?\d*)/i,
      // Standard debit keywords
      /(?:debited|charged|paid|withdrawn|deducted)\s+(?:with\s+)?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      // Amount before currency: "4,000.00 ETB ... to"
      /([\d,]+\.?\d*)\s+(?:etb|birr|br)\s+to\b/i,
    ],
    credit: [
      // "ETB 93,000 has been credited to your account"
      /(?:etb|birr|br)\s*([\d,]+\.?\d*)\s*has\s+been\s+(?:credited|deposited|received)/i,
      // Standard credit keywords
      /(?:credited|received|deposited)\s+(?:to\s+your\s+account\s+)?(?:from\s+[A-Za-z].*?)?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
      /(?:credited|received|deposited).*?(?:birr|etb|br)\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:a\/c|account)\s*([\d*/]+)/i,
    // "Your available balance is  ETB 1,887.77" or "Your updated balance is 43,571.37"
    balance: /(?:available\s+|updated\s+)?balance\s+is\s+(?:now\s+)?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge)[:\s]+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    // "VAT: 21.60"
    tax: /(?:tax|vat)\s*:?\s*(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    // "Ref: 260619150657562" or "Txn ID: 260619141515107"
    reference: /(?:ref|txn\s+id)\s*:?\s*([A-Z0-9]{6,})/i,
    merchant: [
      // "(ABEL TAMIRAT MENGISTU)" — name in parens after account number
      /\(([A-Z][A-Z\s]+?)\)(?:\s+in\s+|\s+from\s+|\s*$)/i,
      new RegExp(`from\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(?:on\s+)?(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i,
    dateAlt: /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
    receiptUrl: /https?:\/\/awashpay\.awashbank\.com[^\s]*/i,
  },

  // ─── Dashen Bank ───────────────────────────────────────────────────────────
  dashen: {
    debit: [
      /(?:debited|withdrawn|paid|transferred?)\s+(?:with\s+)?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      /(?:credited|received|deposited)\s+(?:with\s+)?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:a\/c|acct?|account)[\s#:]*(\d[\d*]+)/i,
    balance: /(?:available\s+|current\s+)?balance.*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref(?:erence)?|tran(?:s(?:action)?)?\s*no\.?|receipt)[\s:#]*([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i,
  },

  // ─── Generic / fallback ────────────────────────────────────────────────────
  generic: {
    debit: [
      /(?:debited|withdrawn|paid|spent|deducted|transferr?ed)\s+(?:with\s+)?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)\s*([\d,]+\.?\d*).*?(?:debited|withdrawn|paid|spent|deducted)/i,
      // "withdrawal request of X"
      /withdrawal\s+request\s+of\s+([\d,]+\.?\d*)/i,
      // "Transfer of X ETB/Birr"
      /transfer(?:red)?\s+of\s+([\d,]+\.?\d*)/i,
    ],
    credit: [
      /(?:credited|received|deposited|added)\s+(?:with\s+)?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)\s*([\d,]+\.?\d*).*?(?:credited|received|deposited|added)/i,
      // Amount-before-currency-before-verb
      /(?:etb|birr|br)\s*([\d,]+\.?\d*)\s*has\s+been\s+(?:credited|deposited|received)/i,
    ],
    accountNumber: /(?:a\/c|account|acc|card)[\s#:]*(\d{3,16})/i,
    balance: /(?:balance|bal|avail|remaining).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge|charges).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat|gst).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref(?:erence)?|txn|transaction)[\s:#]*([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from|received from|transferred? to|by)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
  },
};

const OTP_KEYWORDS = ['otp', 'one-time', 'verification code', 'secret code', 'password reset', 'pin ', ' pin:', '2fa', 'auth code'];
const MARKETING_KEYWORDS = ['lucky', 'prize', 'promo', 'offer expires', 'click here to win'];

export class EnhancedSMSParser {
  static parseTransaction(
    message: string,
    sender: string,
    smsId: string,
    timestamp: number
  ): ParsedSMSTransaction | null {
    try {
      const lowerMsg = message.toLowerCase();

      if (OTP_KEYWORDS.some(kw => lowerMsg.includes(kw))) return null;
      if (MARKETING_KEYWORDS.some(kw => lowerMsg.includes(kw))) {
        if (!lowerMsg.includes('debited') && !lowerMsg.includes('credited') && !lowerMsg.includes('transferred')) return null;
      }

      const bankType = this.detectBankType(sender, message);
      const patterns = ENHANCED_SMS_PATTERNS[bankType] ?? ENHANCED_SMS_PATTERNS.generic;

      let type: 'INCOME' | 'EXPENSE' | null = null;
      let amount = 0;

      // Try debit patterns
      for (const p of patterns.debit) {
        const m = message.match(p);
        if (m) {
          const parsed = this.parseAmount(m[1]);
          if (parsed > 0) { amount = parsed; type = 'EXPENSE'; break; }
        }
      }
      // Try credit patterns
      if (!type) {
        for (const p of patterns.credit) {
          const m = message.match(p);
          if (m) {
            const parsed = this.parseAmount(m[1]);
            if (parsed > 0) { amount = parsed; type = 'INCOME'; break; }
          }
        }
      }

      if (!type || amount === 0) return null;

      let accountNumber = this.extractAccountNumber(message, patterns.accountNumber);
      // CBE credit messages mention the sender's account first and the user's
      // destination account second. Always attach the transaction to the
      // direction-appropriate user account instead of taking the first match.
      if (bankType === 'cbe') {
        const directionalAccount = type === 'INCOME'
          ? message.match(/to\s+your\s+account\s+([\d*]+)/i)
          : message.match(/from\s+(?:your\s+)?account\s+([\d*]+)/i);
        if (directionalAccount?.[1]) {
          accountNumber = this.extractAccountNumber(`account ${directionalAccount[1]}`, patterns.accountNumber);
        }
      }
      const balance = this.extractAmount(message, patterns.balance);
      const serviceCharge = this.extractAmount(message, patterns.fees);
      const vat = this.extractAmount(message, patterns.tax);
      const disasterRecoveryFee = this.extractAmount(message, patterns.disasterRecoveryFee);
      const fees = Math.round(((serviceCharge ?? 0) + (disasterRecoveryFee ?? 0)) * 100) / 100 || undefined;
      const tax = vat;
      const referenceNumber = this.extractReference(message, patterns.reference);
      const merchant = this.extractMerchant(message, patterns.merchant);
      const extractedDate = this.extractDate(message, patterns);
      const receiptUrl = this.extractReceiptUrl(message, patterns.receiptUrl);

      // Keep the amount received by the counterparty separate from the amount
      // debited from the account. CBE's "total of" includes bank charges.
      let grossAmount: number | undefined;
      if (type === 'EXPENSE') {
        const totalMatch = message.match(/total\s+of\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i);
        if (totalMatch) {
          const total = this.parseAmount(totalMatch[1]);
          if (total > 0) grossAmount = total;
        } else if (serviceCharge || vat || disasterRecoveryFee) {
          grossAmount = Math.round((amount + (serviceCharge ?? 0) + (vat ?? 0) + (disasterRecoveryFee ?? 0)) * 100) / 100;
        }
      }

      const categoryHint = this.suggestCategoryHint(merchant, message, type);
      const transferInfo = this.detectSelfTransfer(message, type);
      const isLoanDisbursement = type === 'INCOME' && this.detectLoanDisbursement(message);

      return {
        amount,
        grossAmount,
        type,
        accountNumber,
        merchant,
        date: extractedDate ?? timestamp,
        balance,
        fees,
        tax,
        serviceCharge,
        vat,
        disasterRecoveryFee,
        referenceNumber,
        receiptUrl,
        rawMessage: message,
        smsId,
        sender,
        categoryHint,
        isTransfer: transferInfo.isTransfer || undefined,
        transferToAccountNumber: transferInfo.transferToAccountNumber,
        transferFromAccountNumber: transferInfo.transferFromAccountNumber,
        isLoanDisbursement: isLoanDisbursement || undefined,
      };
    } catch (error) {
      console.error('Error parsing SMS:', error);
      return null;
    }
  }

  static detectBankType(sender: string, message: string): string {
    const s = sender.toLowerCase();
    const m = message.toLowerCase();

    // Telebirr: sender or message mentions telebirr, or ethiotelecom receipt URL
    if (s.includes('telebirr') || s.includes('ethiotelecom') || m.includes('telebirr') || m.includes('transactioninfo.ethiotelecom')) return 'telebirr';
    if (s.includes('cbe') || s === 'cbebirr' || m.includes('commercial bank of ethiopia')) return 'cbe';
    // BOA: "8397" shortcode, bankofabyssinia URL, or message text
    if (s.includes('abyssinia') || s === 'boa' || s === '8397' || s.includes('8397') || m.includes('bank of abyssinia') || m.includes('bankofabyssinia.com')) return 'boa';
    if (s.includes('awash') || m.includes('awash bank') || m.includes('awashpay') || m.includes('awashbank')) return 'awash';
    if (s.includes('dashen') || m.includes('dashen bank')) return 'dashen';
    // Other Ethiopian banks → generic (still use improved generic patterns)
    return 'generic';
  }

  static detectLoanDisbursement(message: string): boolean {
    const text = message.toLowerCase();
    const loanLanguage = /\b(?:loan|digital\s+loan|credit\s+(?:amount|facility|disbursement)|borrowed|mela\s+\d+\s+days\s+contract|overdraft)\b/i;
    const incomingLanguage = /\b(?:credited|received|deposited|disbursed|approved|paid\s+to\s+your\s+account)\b/i;
    const repaymentLanguage = /\b(?:repaid|repayment|paid\s+(?:a\s+)?credit|unpaid\s+credit|outstanding\s+credit)\b/i;
    return loanLanguage.test(text) && incomingLanguage.test(text) && !repaymentLanguage.test(text);
  }

  static detectSelfTransfer(message: string, type?: 'INCOME' | 'EXPENSE'): {
    isTransfer: boolean;
    transferToAccountNumber?: string;
    transferFromAccountNumber?: string;
  } {
    // "between accounts" / "self transfer"
    if (/between\s+(?:your\s+)?(?:own\s+)?accounts?/i.test(message) || /self[\s-]transfer/i.test(message)) {
      return { isTransfer: true };
    }

    const OWN_ACCOUNT = `your\\s+(?:own\\s+)?(?:(?:cbe|boa|awash|dashen|telebirr|commercial|abyssinia)\\s+)?(?:bank\\s+)?account\\s*([\\d*]+)?`;
    // Bounded gap between the verb and "to/from your … account": stays inside
    // the sentence (no ., !, ?) but must let decimal points in amounts through
    // ("ETB 5,000.00"), so a period is allowed only when a digit follows it.
    const GAP = `(?:[^.!?]|\\.(?=\\d)){0,80}?`;

    // Keep only the visible digit run after the mask: "1*9876" → "9876".
    // Joining digits across the mask would corrupt suffix matching later.
    const tailDigits = (raw?: string): string | undefined => {
      const runs = (raw ?? '').split(/[^0-9]+/).filter(Boolean);
      return runs.length ? runs[runs.length - 1] : undefined;
    };

    // Debit side: a transfer verb sending money TO one of the user's own accounts.
    // Anchoring on the verb keeps ordinary credits ("credited to your account")
    // from matching; the type gate keeps this off INCOME messages entirely.
    if (type !== 'INCOME') {
      const toMatch = message.match(
        new RegExp(`(?:transferr?ed|transfer|sent|moved)\\b${GAP}\\bto\\s+${OWN_ACCOUNT}`, 'i')
      );
      if (toMatch) {
        return { isTransfer: true, transferToAccountNumber: tailDigits(toMatch[1]) };
      }
    }

    // Credit side: money received FROM one of the user's own accounts.
    // The type gate keeps ordinary debits ("debited from your account 1*4191")
    // on EXPENSE messages from being flagged as transfers.
    if (type !== 'EXPENSE') {
      const fromMatch = message.match(
        new RegExp(`(?:received|credited|deposited)\\b${GAP}\\bfrom\\s+${OWN_ACCOUNT}`, 'i')
      );
      if (fromMatch) {
        return { isTransfer: true, transferFromAccountNumber: tailDigits(fromMatch[1]) };
      }
    }

    return { isTransfer: false };
  }

  private static parseAmount(amountStr: string): number {
    if (!amountStr) return 0;
    const cleaned = amountStr.replace(/,/g, '').trim();
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? 0 : amount;
  }

  /**
   * Extract account number using last visible digit cluster from masked numbers.
   * "1*49" → "49", "1*4191" → "4191", "****4191" → "4191", "01320**3100" → "3100"
   */
  private static extractAccountNumber(message: string, pattern?: RegExp): string | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    if (!match?.[1]) return undefined;

    const raw = match[1]; // e.g. "1*4191" or "1*****4191"
    // Split on non-digit non-asterisk boundaries, get digit clusters
    const digitClusters = raw.split(/[^0-9*]+/).filter(Boolean);
    // Within each cluster, extract consecutive digit runs (ignoring *)
    const allRuns: string[] = [];
    for (const cluster of digitClusters) {
      const runs = cluster.split('*').filter(s => /\d/.test(s));
      allRuns.push(...runs);
    }

    if (allRuns.length === 0) return undefined;
    // Use the last digit run (the visible end digits)
    const lastRun = allRuns[allRuns.length - 1];
    // Return last 4 digits maximum
    return lastRun.length > 4 ? lastRun.slice(-4) : lastRun;
  }

  private static extractAmount(message: string, pattern?: RegExp): number | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    if (!match?.[1]) return undefined;
    const v = this.parseAmount(match[1]);
    return v > 0 ? v : undefined;
  }

  private static extractReference(message: string, pattern?: RegExp): string | undefined {
    // Text-based reference
    if (pattern) {
      const match = message.match(pattern);
      const ref = match?.[1]?.trim() || match?.[2]?.trim();
      if (ref) return ref;
    }

    // URL-embedded reference: CBE ?id=..., BOA ?trx=..., Awash receipt path
    const cbeId = message.match(/[?&]id=([A-Z0-9]+)/i);
    if (cbeId) return cbeId[1];

    // Newer CBE receipt links encode the receipt token in the path.
    const cbeReceiptToken = message.match(/mbreciept\.cbe\.com\.et\/v2-([A-Z0-9_-]+)/i);
    if (cbeReceiptToken) return cbeReceiptToken[1];

    const boaTrx = message.match(/[?&]trx=([A-Z0-9]+)/i);
    if (boaTrx) return boaTrx[1];

    // Awash: "Ref: 260619150657562" or "Txn ID: 260619141515107"
    const awashRef = message.match(/(?:ref|txn\s+id)\s*:?\s*([A-Z0-9]{6,})/i);
    if (awashRef) return awashRef[1];

    return undefined;
  }

  static cleanMerchantName(raw?: string): string {
    if (!raw) return '';
    return raw
      .replace(/(?:Ref|Txn|FT|RefNo|Receipt)[\s:#-]*[A-Z0-9]+/gi, '')
      .replace(/\b(?:PLC|LTD|Corp|Inc|Co\.)\b/gi, '')
      .replace(/\b(?:CBE\s*BIRR|telebirr|CBE|BOA|Awash)\b/gi, '')
      .replace(/[,.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static extractMerchant(message: string, patterns?: RegExp | RegExp[]): string | undefined {
    if (!patterns) return undefined;
    const pts = Array.isArray(patterns) ? patterns : [patterns];
    for (const p of pts) {
      const m = message.match(p);
      if (m?.[1]) {
        const rawName = m[1].trim().replace(/[,.\s]+$/, '');
        // Skip obvious non-names: short codes, "other bank", "your account"
        if (rawName.length < 3 || /^(other bank|your|the|a|an)$/i.test(rawName)) continue;
        if (/^Awash\s+International\s+Bank/i.test(rawName)) return rawName;
        const cleaned = this.cleanMerchantName(rawName);
        return cleaned || rawName;
      }
    }
    return undefined;
  }

  /**
   * Extract receipt/payment URL from the message.
   * Prefers known receipt URL patterns; falls back to any https URL.
   */
  static extractReceiptUrl(message: string, bankPattern?: RegExp): string | undefined {
    // Try bank-specific pattern first
    if (bankPattern) {
      const match = message.match(bankPattern);
      if (match) return match[0];
    }

    // Find all URLs in the message
    const allUrls = message.match(/https?:\/\/[^\s,)]+/gi) ?? [];

    // Prefer URLs that look like receipts/payments
    const receiptUrl = allUrls.find(url => {
      const lower = url.toLowerCase();
      return lower.includes('receipt') || lower.includes('slip') ||
        lower.includes('trx=') || lower.includes('?id=') ||
        lower.includes('pay') || lower.includes('transactioninfo');
    });

    return receiptUrl || allUrls[0];
  }

  private static extractDate(message: string, patterns: any): number | null {
    let match = patterns.date ? message.match(patterns.date) : null;
    if (match) {
      const dateStr = match[1];
      const timeStr = match[2];
      if (dateStr.includes('/')) {
        const [day, month, year] = dateStr.split('/');
        const ts = new Date(`${year}-${month}-${day}T${timeStr}`).getTime();
        if (!isNaN(ts)) return ts;
      } else {
        const ts = new Date(`${dateStr}T${timeStr}`).getTime();
        if (!isNaN(ts)) return ts;
      }
    }

    if (patterns.dateAlt) {
      match = message.match(patterns.dateAlt);
      if (match) {
        const ts = new Date(`${match[1]}T${match[2]}`).getTime();
        if (!isNaN(ts)) return ts;
      }
    }

    // Shared fallback: "on DD/MM/YYYY HH:mm:ss"
    const fallback = message.match(/on\s+(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i);
    if (fallback) {
      const [, dateStr, timeStr] = fallback;
      const [day, month, year] = dateStr.split('/');
      const ts = new Date(`${year}-${month}-${day}T${timeStr}`).getTime();
      if (!isNaN(ts)) return ts;
    }

    // Fallback ISO: "on : 2026-06-19 14:15:39" (Awash style with extra colon/space)
    const isoFallback = message.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    if (isoFallback) {
      const ts = new Date(`${isoFallback[1]}T${isoFallback[2]}`).getTime();
      if (!isNaN(ts)) return ts;
    }

    return null;
  }

  static suggestCategory(merchant?: string, message?: string, type?: 'INCOME' | 'EXPENSE'): string {
    return this.suggestCategoryHint(merchant, message, type);
  }

  static suggestCategoryHint(merchant?: string, message?: string, type?: 'INCOME' | 'EXPENSE'): string {
    const text = `${merchant ?? ''} ${message ?? ''}`.toLowerCase();

    // Keywords are anchored on a leading word boundary (plus a trailing one for
    // short words) — bare substrings misfire badly on bank SMS boilerplate:
    // "rent" matches "Current Balance", "bus" matches "business".

    if (type === 'INCOME') {
      if (this.detectLoanDisbursement(message ?? '')) return 'loan';
      if (text.match(/\b(?:salary|payroll|stipend)/)) return 'salary';
      if (text.match(/\b(?:freelance|contract\s+pay)/)) return 'freelance';
      // Note: "received from <name>" alone is ordinary income, not a transfer.
      if (text.match(/\b(?:transfer|sent\s+by)/)) return 'transfer';
      return 'income';
    }

    if (text.match(/\b(?:loan|credit\s+amount|unpaid\s+credit|outstanding\s+credit|mela\s+\d+\s+days\s+contract|repaid)\b/)) return 'loan';
    if (text.match(/\b(?:food|restaurant|cafe|coffee|lunch|dinner|breakfast|pizza|burger|shiro|tibs|injera)/)) return 'food';
    if (text.match(/\b(?:supermarket|grocery|market|shop|store|mall|amazon|jumia)/)) return 'shopping';
    if (text.match(/\b(?:uber|taxi|bus\b|fuel|petrol|diesel|transport|parking|rides?\b)/)) return 'transport';
    if (text.match(/\b(?:electricity|water|gas\b|internet|phone|mobile|recharge|bill|ethiotelecom|wifi|package)/)) return 'bills';
    if (text.match(/\b(?:movie|cinema|games?\b|entertainment|netflix|spotify)/)) return 'entertainment';
    if (text.match(/\b(?:hospital|pharmacy|medical|health|doctor|clinic|medicine)/)) return 'health';
    if (text.match(/\b(?:rent(?:al|ed)?\b|lease|mortgage)/)) return 'housing';
    if (text.match(/\b(?:school|university|course|education|tuition)/)) return 'education';
    // Last-resort fallback: nearly every bank debit says "transferred", so this
    // must stay below the specific category checks or it swallows them all.
    if (text.match(/\b(?:transfer|cbe\s*birr|send\s+money|other\s+bank)/)) return 'transfer';

    return 'other';
  }

  static matchCategory(
    hint: string,
    userCategories: Array<{ name: string; type: string }>,
    transactionType: 'INCOME' | 'EXPENSE'
  ): string {
    const relevant = userCategories.filter(c =>
      c.type.toLowerCase() === transactionType.toLowerCase()
    );
    if (relevant.length === 0) return hint;

    const hintKeywords: Record<string, string[]> = {
      salary: ['salary', 'payroll', 'income'],
      freelance: ['freelance', 'contract'],
      transfer: ['transfer'],
      income: ['income', 'revenue'],
      food: ['food', 'dining', 'restaurant', 'eat'],
      shopping: ['shopping', 'shop', 'retail', 'market'],
      transport: ['transport', 'travel', 'fuel', 'taxi'],
      bills: ['bill', 'util', 'phone', 'electric', 'internet'],
      entertainment: ['entertain', 'movie', 'fun'],
      health: ['health', 'medical', 'hospital', 'pharma'],
      housing: ['hous', 'rent', 'mortgage'],
      education: ['edu', 'school', 'tuition'],
      loan: ['loan', 'debt', 'credit', 'repayment'],
      other: ['other', 'misc', 'general'],
    };

    const keywords = hintKeywords[hint] ?? [];
    for (const kw of keywords) {
      const match = relevant.find(c => c.name.toLowerCase().includes(kw));
      if (match) return match.name;
    }

    return relevant[0].name;
  }
}
