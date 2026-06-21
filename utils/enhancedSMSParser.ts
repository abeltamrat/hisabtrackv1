// Enhanced SMS Parser for comprehensive transaction extraction
export interface ParsedSMSTransaction {
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  accountNumber?: string; // Last digits
  merchant?: string;
  date: number; // Timestamp
  balance?: number; // Current balance from SMS
  fees?: number;
  tax?: number;
  referenceNumber?: string;
  rawMessage: string;
  smsId: string;
  sender: string;
}

// Enhanced patterns based on user templates
const ENHANCED_SMS_PATTERNS = {
  // CBE patterns
  cbe: {
    debit: [
      /(?:debited|withdrawn|paid|spent|transfered).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      /total of (?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      /(?:credited|received|deposited).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:a\/c|account|acc).*?(\d{1,16})/i,
    balance: /(?:balance|bal|avail).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge|s\.charge).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref|reference|txn|receipt).*?(\w+\d+)/i,
    merchant: [
      /(?:to|from|received from|transfered to)\s+([A-Z][A-Za-z\s&]+?)(?:\s+on|\s+dated|\s+\d|$)/i,
      /(?:by|via|to|from)\s+([A-Za-z\s&]+?)(?:\s+on|\s+at|\s+\d|$)/i,
    ],
    date: /(\d{2}\/\d{2}\/\d{4})\s+at\s+(\d{2}:\d{2}:\d{2})/i,
  },
  // telebirr patterns
  telebirr: {
    debit: [
      /transferred (?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    credit: [
      /received\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    ],
    accountNumber: /(?:account|acc).*?(\d{4,16})/i,
    balance: /current.*?balance.*?is\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /service fee is\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?is\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /transaction number is\s+(\w+)/i,
    merchant: /(?:to|from)\s+([A-Z][A-Za-z\s&]+?)(?:\s*\(|\s+on|\s+at|$)/i,
    date: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
    dateAlt: /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  },
  // BoA patterns
  boa: {
    debit: [/debited\s+with\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i],
    credit: [/credited\s+with\s+(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i],
    accountNumber: /(?:account|acc).*?(\d+)/i,
    balance: /balance\s*:\s*(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /receipt\s*:\s*(https?:\/\/\S+)/i,
    merchant: /receipt\s*:\s*(https?:\/\/\S+)/i,
  },
  generic: {
    debit: [
      /(?:debited|withdrawn|paid|spent|deducted).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*).*?(?:debited|withdrawn|paid|spent|deducted)/i,
    ],
    credit: [
      /(?:credited|received|deposited|added).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*).*?(?:credited|received|deposited|added)/i,
    ],
    accountNumber: /(?:a\/c|account|acc|card).*?(\d{3,16})/i,
    balance: /(?:balance|bal|avail|remaining).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge|charges).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat|gst).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref|reference|txn|transaction).*?([A-Z0-9]{6,})/i,
  },
};

export class EnhancedSMSParser {
  /**
   * Parse SMS message and extract transaction details
   */
  static parseTransaction(
    message: string,
    sender: string,
    smsId: string,
    timestamp: number
  ): ParsedSMSTransaction | null {
    try {
      const lowerMsg = message.toLowerCase();

      // Ignore non-financial messages
      if (lowerMsg.includes('otp') || lowerMsg.includes('verification') || lowerMsg.includes('secret code')) return null;
      if (lowerMsg.includes('gift') || lowerMsg.includes('win') || lowerMsg.includes('congratulations')) {
        // Check if it's a real transaction or just marketing
        if (!lowerMsg.includes('debited') && !lowerMsg.includes('credited')) return null;
      }

      const bankType = this.detectBankType(sender, message);
      const patterns: any = ENHANCED_SMS_PATTERNS[bankType] || ENHANCED_SMS_PATTERNS.generic;

      let type: 'INCOME' | 'EXPENSE' | null = null;
      let amount = 0;

      // Detect type & base amount
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

      // Extract specific details
      const accountNumber = this.extractAccountNumber(message, patterns.accountNumber);
      const balance = this.extractBalance(message, patterns.balance);
      const fees = this.extractFees(message, patterns.fees);
      const tax = this.extractTax(message, patterns.tax);
      const referenceNumber = this.extractReference(message, patterns.reference);
      const merchant = this.extractMerchant(message, patterns.merchant);
      const extractedDate = this.extractDate(message, patterns);

      // Special handling for telebirr/CBE "total" calculation
      // If total is mentioned explicitly, use it. Otherwise, if fees/tax are found, add them to expense.
      if (type === 'EXPENSE') {
        const totalMatch = message.match(/total of (?:birr|etb|br)?\s*([\d,]+\.?\d*)/i);
        if (totalMatch) {
          amount = this.parseAmount(totalMatch[1]);
        } else if (fees || tax) {
          // User specified telebirr should be 2.00 ETB (1.00 + 0.87 + 0.13)
          // If amount was 1.00, we add them.
          amount = amount + (fees || 0) + (tax || 0);
        }
      }

      return {
        amount,
        type,
        accountNumber,
        merchant,
        date: extractedDate || timestamp,
        balance,
        fees,
        tax,
        referenceNumber,
        rawMessage: message,
        smsId,
        sender,
      };
    } catch (error) {
      console.error('Error parsing SMS:', error);
      return null;
    }
  }

  private static detectBankType(sender: string, message: string): 'cbe' | 'telebirr' | 'boa' | 'generic' {
    const s = sender.toLowerCase();
    const m = message.toLowerCase();
    if (s.includes('cbe') || m.includes('commercial bank')) return 'cbe';
    if (s.includes('telebirr') || m.includes('telebirr')) return 'telebirr';
    if (s.includes('abyssinia') || m.includes('abyssinia') || s === '8397') return 'boa';
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
    if (match && match[1]) {
      // Get last 4 digits if it's a long number or has *
      const raw = match[1].replace(/[^\d]/g, '');
      return raw.length > 4 ? raw.slice(-4) : raw;
    }
    return undefined;
  }

  private static extractBalance(message: string, pattern?: RegExp): number | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    return match ? this.parseAmount(match[1]) : undefined;
  }

  private static extractFees(message: string, pattern?: RegExp): number | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    return match ? this.parseAmount(match[1]) : undefined;
  }

  private static extractTax(message: string, pattern?: RegExp): number | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    return match ? this.parseAmount(match[1]) : undefined;
  }

  private static extractReference(message: string, pattern?: RegExp): string | undefined {
    if (!pattern) return undefined;
    const match = message.match(pattern);
    return match ? match[1].trim() : undefined;
  }

  private static extractMerchant(message: string, patterns?: RegExp | RegExp[]): string | undefined {
    if (!patterns) return undefined;
    const pts = Array.isArray(patterns) ? patterns : [patterns];
    for (const p of pts) {
      const m = message.match(p);
      if (m && m[1]) return m[1].trim();
    }
    return undefined;
  }

  private static extractDate(message: string, patterns: any): number | null {
    const dPattern = patterns.date;
    const dAlt = patterns.dateAlt;

    let match = message.match(dPattern);
    if (match) {
      // DD/MM/YYYY at HH:mm:ss
      const [_, dateStr, timeStr] = match;
      const [day, month, year] = dateStr.split('/');
      return new Date(`${year}-${month}-${day}T${timeStr}`).getTime();
    }

    match = message.match(dAlt);
    if (match) {
      // YYYY-MM-DD HH:mm:ss
      const [_, dateStr, timeStr] = match;
      return new Date(`${dateStr}T${timeStr}`).getTime();
    }

    // fallback for Date only patterns
    const telebirrDate = message.match(/on (\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    if (telebirrDate) {
      const [_, dateStr, timeStr] = telebirrDate;
      const [day, month, year] = dateStr.split('/');
      return new Date(`${year}-${month}-${day}T${timeStr}`).getTime();
    }

    return null;
  }

  static suggestCategory(merchant?: string, message?: string, type?: 'INCOME' | 'EXPENSE'): string {
    const text = `${merchant || ''} ${message || ''}`.toLowerCase();

    if (type === 'INCOME') {
      if (text.includes('salary') || text.includes('payroll')) return 'Salary';
      if (text.includes('freelance')) return 'Freelance';
      return 'Income';
    }

    const categoryMap: { [key: string]: string } = {
      'food|restaurant|cafe|coffee|lunch|dinner|breakfast|starbucks': 'Food & Dining',
      'supermarket|grocery|market|shop|store|mall|amazon|flipkart|shopping': 'Shopping',
      'uber|taxi|bus|fuel|petrol|diesel|transport|parking': 'Transportation',
      'electricity|water|gas|internet|phone|mobile|recharge|bill|ethiotelecom': 'Bills & Utilities',
      'movie|cinema|game|entertainment|netflix|spotify': 'Entertainment',
      'hospital|pharmacy|medical|health|doctor|clinic': 'Healthcare',
      'rent|lease|mortgage': 'Housing',
      'school|university|course|education|tuition': 'Education',
      'transfer|telebirr|cbe birr': 'Transfer',
    };

    for (const [keywords, category] of Object.entries(categoryMap)) {
      if (keywords.split('|').some(kw => text.includes(kw))) return category;
    }

    return 'Other';
  }
}
