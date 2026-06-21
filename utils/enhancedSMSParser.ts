export interface ParsedSMSTransaction {
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  accountNumber?: string;
  merchant?: string;
  date: number;
  balance?: number;
  fees?: number;
  tax?: number;
  referenceNumber?: string;
  rawMessage: string;
  smsId: string;
  sender: string;
  categoryHint?: string; // loose semantic hint, not an exact category name
}

// Shared terminators that end a merchant name capture
// Handles: ", on", " on", ". at", " with Ref", " (", digit, end-of-string
const MERCHANT_END = `(?:[,.]?\\s+(?:on|at|dated|with|from|via|ref)|[,.]?\\s*\\(|\\s+\\d|$)`;

const ENHANCED_SMS_PATTERNS: Record<string, any> = {
  // ─── Commercial Bank of Ethiopia ───────────────────────────────────────────
  cbe: {
    debit: [
      /(?:transferred?|debited|withdrawn|paid|spent).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      /total of (?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      /(?:credited|received|deposited).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:a\/c|account|acc)[\s#:]*(\d[\d*]+)/i,
    balance: /(?:current\s+)?balance.*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /s\.charge.*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:vat|tax).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref(?:erence)?|txn|receipt)\s*(?:no\.?|#|:)?\s*([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from|received from|transferred? to)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
      new RegExp(`(?:by|via)\\s+([A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+at\s+(\d{2}:\d{2}:\d{2})/i,
  },

  // ─── Telebirr ──────────────────────────────────────────────────────────────
  telebirr: {
    debit: [
      /transferred?\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      /(?:paid|spent|charged)\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      /received\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:account|acc).*?(\d{4,16})/i,
    balance: /current.*?(?:e-money\s+account\s+)?balance.*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /service\s+fee\s+is\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?is\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /transaction\s+number\s+is\s+([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    dateAlt: /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  },

  // ─── Bank of Abyssinia ─────────────────────────────────────────────────────
  boa: {
    debit: [/debited\s+with\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i],
    credit: [/credited\s+with\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i],
    accountNumber: /(?:account|acc).*?(\d+)/i,
    balance: /balance\s*:?\s*(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /receipt\s*:?\s*([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i,
  },

  // ─── Awash Bank ────────────────────────────────────────────────────────────
  awash: {
    debit: [
      /(?:debited|charged|paid|withdrawn|transferred?).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      /(?:birr|etb|br)\s*([\d,]+\.?\d*).*?(?:debited|charged|paid)/i,
    ],
    credit: [
      /(?:credited|received|deposited).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:a\/c|account|acc)[\s#:]*(\d[\d*]+)/i,
    balance: /(?:available\s+)?balance.*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref(?:erence)?|tran(?:s(?:action)?)?\s*(?:id|no\.?)|receipt)[\s:#]*([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i,
  },

  // ─── Dashen Bank ───────────────────────────────────────────────────────────
  dashen: {
    debit: [
      /(?:debited|withdrawn|paid|transferred?).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      /(?:credited|received|deposited).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
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
      /(?:debited|withdrawn|paid|spent|deducted|transferred?).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)\s*([\d,]+\.?\d*).*?(?:debited|withdrawn|paid|spent|deducted)/i,
    ],
    credit: [
      /(?:credited|received|deposited|added).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)\s*([\d,]+\.?\d*).*?(?:credited|received|deposited|added)/i,
    ],
    accountNumber: /(?:a\/c|account|acc|card)[\s#:]*(\d{3,16})/i,
    balance: /(?:balance|bal|avail|remaining).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge|charges).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat|gst).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref(?:erence)?|txn|transaction)[\s:#]*([A-Z0-9]{6,})/i,
    merchant: [
      new RegExp(`(?:to|from|received from|transferred? to)\\s+([A-Za-z][A-Za-z\\s&.'\\-]+?)${MERCHANT_END}`, 'i'),
    ],
  },
};

// Keywords that indicate an OTP / security / marketing message, not a transaction
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

      // Filter OTP / security messages
      if (OTP_KEYWORDS.some(kw => lowerMsg.includes(kw))) return null;
      // Filter obvious marketing unless it's a real debit/credit
      if (MARKETING_KEYWORDS.some(kw => lowerMsg.includes(kw))) {
        if (!lowerMsg.includes('debited') && !lowerMsg.includes('credited') && !lowerMsg.includes('transferred')) return null;
      }

      const bankType = this.detectBankType(sender, message);
      const patterns = ENHANCED_SMS_PATTERNS[bankType] ?? ENHANCED_SMS_PATTERNS.generic;

      let type: 'INCOME' | 'EXPENSE' | null = null;
      let amount = 0;

      for (const p of patterns.debit) {
        const m = message.match(p);
        if (m) { amount = this.parseAmount(m[1]); type = 'EXPENSE'; break; }
      }
      if (!type) {
        for (const p of patterns.credit) {
          const m = message.match(p);
          if (m) { amount = this.parseAmount(m[1]); type = 'INCOME'; break; }
        }
      }

      if (!type || amount === 0) return null;

      const accountNumber = this.extractAccountNumber(message, patterns.accountNumber);
      const balance = this.extractAmount(message, patterns.balance);
      const fees = this.extractAmount(message, patterns.fees);
      const tax = this.extractAmount(message, patterns.tax);
      const referenceNumber = this.extractReference(message, patterns.reference);
      const merchant = this.extractMerchant(message, patterns.merchant);
      const extractedDate = this.extractDate(message, patterns);

      // Use "total of" explicitly if present (CBE includes fees in the total line)
      if (type === 'EXPENSE') {
        const totalMatch = message.match(/total of (?:birr|etb|br)?\s*([\d,]+\.?\d*)/i);
        if (totalMatch) {
          amount = this.parseAmount(totalMatch[1]);
        } else if (fees || tax) {
          amount = amount + (fees ?? 0) + (tax ?? 0);
        }
      }

      const categoryHint = this.suggestCategoryHint(merchant, message, type);

      return {
        amount,
        type,
        accountNumber,
        merchant,
        date: extractedDate ?? timestamp,
        balance,
        fees,
        tax,
        referenceNumber,
        rawMessage: message,
        smsId,
        sender,
        categoryHint,
      };
    } catch (error) {
      console.error('Error parsing SMS:', error);
      return null;
    }
  }

  static detectBankType(sender: string, message: string): string {
    const s = sender.toLowerCase();
    const m = message.toLowerCase();
    if (s.includes('cbe') || s === 'cbebirr' || m.includes('commercial bank of ethiopia')) return 'cbe';
    if (s.includes('telebirr') || m.includes('telebirr')) return 'telebirr';
    if (s.includes('abyssinia') || m.includes('bank of abyssinia') || s === '8397') return 'boa';
    if (s.includes('awash') || m.includes('awash bank')) return 'awash';
    if (s.includes('dashen') || m.includes('dashen bank')) return 'dashen';
    if (s.includes('nib') || m.includes('nib international')) return 'generic';
    if (s.includes('wegagen') || m.includes('wegagen bank')) return 'generic';
    if (s.includes('zemen') || m.includes('zemen bank')) return 'generic';
    return 'generic';
  }

  private static parseAmount(amountStr: string): number {
    const cleaned = amountStr.replace(/,/g, '').trim();
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? 0 : amount;
  }

  private static extractAccountNumber(message: string, pattern?: RegExp): string | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    if (match?.[1]) {
      const raw = match[1].replace(/[^\d]/g, '');
      return raw.length > 4 ? raw.slice(-4) : raw;
    }
    return undefined;
  }

  private static extractAmount(message: string, pattern?: RegExp): number | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    return match ? this.parseAmount(match[1]) : undefined;
  }

  private static extractReference(message: string, pattern?: RegExp): string | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    return match?.[1]?.trim();
  }

  static cleanMerchantName(raw?: string): string {
    if (!raw) return '';
    return raw
      // Remove reference/transaction IDs like FT24... or Ref...
      .replace(/(?:Ref|Txn|FT|RefNo|Receipt)[\s:#-]*[A-Z0-9]+/gi, '')
      // Remove business suffixes
      .replace(/\b(?:PLC|LTD|Corp|Inc|Co\.)\b/gi, '')
      // Remove common bank-specific suffixes/prefixes
      .replace(/\b(?:CBE\s*BIRR|telebirr|CBE|BOA|Awash)\b/gi, '')
      // Remove multiple spaces, commas, periods
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
        // Trim trailing punctuation and whitespace, then clean
        const rawName = m[1].trim().replace(/[,.\s]+$/, '');
        const cleaned = this.cleanMerchantName(rawName);
        return cleaned || rawName;
      }
    }
    return undefined;
  }

  private static extractDate(message: string, patterns: any): number | null {
    // Primary date pattern
    let match = patterns.date ? message.match(patterns.date) : null;
    if (match) {
      const dateStr = match[1];
      const timeStr = match[2];
      if (dateStr.includes('/')) {
        // DD/MM/YYYY
        const [day, month, year] = dateStr.split('/');
        const ts = new Date(`${year}-${month}-${day}T${timeStr}`).getTime();
        if (!isNaN(ts)) return ts;
      } else {
        // YYYY-MM-DD
        const ts = new Date(`${dateStr}T${timeStr}`).getTime();
        if (!isNaN(ts)) return ts;
      }
    }

    // Alt date pattern (ISO-style)
    if (patterns.dateAlt) {
      match = message.match(patterns.dateAlt);
      if (match) {
        const ts = new Date(`${match[1]}T${match[2]}`).getTime();
        if (!isNaN(ts)) return ts;
      }
    }

    // Shared fallback: "on DD/MM/YYYY HH:mm:ss" or "on DD/MM/YYYY at HH:mm:ss"
    const fallback = message.match(/on\s+(\d{2}\/\d{2}\/\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i);
    if (fallback) {
      const [, dateStr, timeStr] = fallback;
      const [day, month, year] = dateStr.split('/');
      const ts = new Date(`${year}-${month}-${day}T${timeStr}`).getTime();
      if (!isNaN(ts)) return ts;
    }

    return null;
  }

  static suggestCategory(merchant?: string, message?: string, type?: 'INCOME' | 'EXPENSE'): string {
    return this.suggestCategoryHint(merchant, message, type);
  }

  /**
   * Returns a loose semantic hint used to find the best matching user category.
   * This is intentionally coarse — the actual category name is matched
   * by the caller against the user's real category list.
   */
  static suggestCategoryHint(merchant?: string, message?: string, type?: 'INCOME' | 'EXPENSE'): string {
    const text = `${merchant ?? ''} ${message ?? ''}`.toLowerCase();

    if (type === 'INCOME') {
      if (text.match(/salary|payroll|stipend/)) return 'salary';
      if (text.match(/freelance|contract\s+pay/)) return 'freelance';
      if (text.match(/transfer|sent\s+by|from\s+[a-z]/)) return 'transfer';
      return 'income';
    }

    if (text.match(/food|restaurant|cafe|coffee|lunch|dinner|breakfast|pizza|burger|shiro|tibs|injera/)) return 'food';
    if (text.match(/supermarket|grocery|market|shop|store|mall|amazon|jumia/)) return 'shopping';
    if (text.match(/uber|taxi|bus|fuel|petrol|diesel|transport|parking|ride/)) return 'transport';
    if (text.match(/electricity|water|gas|internet|phone|mobile|recharge|bill|ethiotelecom|wifi/)) return 'bills';
    if (text.match(/movie|cinema|game|entertainment|netflix|spotify/)) return 'entertainment';
    if (text.match(/hospital|pharmacy|medical|health|doctor|clinic|medicine/)) return 'health';
    if (text.match(/rent|lease|mortgage/)) return 'housing';
    if (text.match(/school|university|course|education|tuition/)) return 'education';
    if (text.match(/transfer|telebirr|cbe\s*birr|send\s+money/)) return 'transfer';

    return 'other';
  }

  /**
   * Map a categoryHint to the best matching category name from the user's real list.
   * Falls back to the first category of the correct type if no match found.
   */
  static matchCategory(
    hint: string,
    userCategories: Array<{ name: string; type: string }>,
    transactionType: 'INCOME' | 'EXPENSE'
  ): string {
    const relevant = userCategories.filter(c =>
      c.type.toLowerCase() === transactionType.toLowerCase()
    );
    if (relevant.length === 0) return hint;

    // Keyword map: hint → substrings to look for in category names
    const hintKeywords: Record<string, string[]> = {
      salary: ['salary', 'payroll', 'income'],
      freelance: ['freelance', 'contract'],
      transfer: ['transfer'],
      income: ['income', 'revenue'],
      food: ['food', 'dining', 'restaurant', 'eat'],
      shopping: ['shopping', 'shop', 'retail', 'market'],
      transport: ['transport', 'travel', 'fuel', 'taxi'],
      bills: ['bill', 'util', 'phone', 'electric'],
      entertainment: ['entertain', 'movie', 'fun'],
      health: ['health', 'medical', 'hospital', 'pharma'],
      housing: ['hous', 'rent', 'mortgage'],
      education: ['edu', 'school', 'tuition'],
      other: [],
    };

    const keywords = hintKeywords[hint] ?? [];
    for (const kw of keywords) {
      const match = relevant.find(c => c.name.toLowerCase().includes(kw));
      if (match) return match.name;
    }

    return relevant[0].name;
  }
}
