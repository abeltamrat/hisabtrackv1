// Enhanced SMS Parser for comprehensive transaction extraction
export interface ParsedSMSTransaction {
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  accountNumber?: string; // Last 3-4 digits
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

// Enhanced patterns for Ethiopian banks (CBE, Awash, etc.)
const ENHANCED_SMS_PATTERNS = {
  // CBE patterns
  cbe: {
    debit: [
      /(?:debited|withdrawn|paid|spent).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      /(?:birr|etb|br)?\s*([\d,]+\.?\d*).*?(?:debited|withdrawn|paid|spent)/i,
    ],
    credit: [
      /(?:credited|received|deposited).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
      /(?:birr|etb|br)?\s*([\d,]+\.?\d*).*?(?:credited|received|deposited)/i,
    ],
    accountNumber: /(?:a\/c|account|acc).*?(\d{3,4})/i,
    balance: /(?:balance|bal|avail).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    fees: /(?:fee|charge).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    tax: /(?:tax|vat).*?(?:birr|etb|br)?\s*([\d,]+\.?\d*)/i,
    reference: /(?:ref|reference|txn).*?(\w+\d+)/i,
  },
  // Generic patterns for other banks
  generic: {
    debit: [
      /(?:debited|withdrawn|paid|spent|deducted).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*).*?(?:debited|withdrawn|paid|spent|deducted)/i,
    ],
    credit: [
      /(?:credited|received|deposited|added).*?(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*)/i,
      /(?:rs\.?|inr|₹|birr|etb|br|usd|\$)?\s*([\d,]+\.?\d*).*?(?:credited|received|deposited|added)/i,
    ],
    accountNumber: /(?:a\/c|account|acc|card).*?(\d{3,4})/i,
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
      // Determine bank type from sender
      const bankType = this.detectBankType(sender);
      const patterns = bankType === 'cbe' ? ENHANCED_SMS_PATTERNS.cbe : ENHANCED_SMS_PATTERNS.generic;

      // Detect transaction type
      let type: 'INCOME' | 'EXPENSE' | null = null;
      let amount = 0;

      // Try debit patterns
      for (const pattern of patterns.debit) {
        const match = message.match(pattern);
        if (match) {
          amount = this.parseAmount(match[1]);
          if (amount > 0) {
            type = 'EXPENSE';
            break;
          }
        }
      }

      // Try credit patterns if not found
      if (!type) {
        for (const pattern of patterns.credit) {
          const match = message.match(pattern);
          if (match) {
            amount = this.parseAmount(match[1]);
            if (amount > 0) {
              type = 'INCOME';
              break;
            }
          }
        }
      }

      if (!type || amount === 0) {
        return null; // Not a transaction SMS
      }

      // Extract additional details
      const accountNumber = this.extractAccountNumber(message, patterns.accountNumber);
      const balance = this.extractBalance(message, patterns.balance);
      const fees = this.extractFees(message, patterns.fees);
      const tax = this.extractTax(message, patterns.tax);
      const referenceNumber = this.extractReference(message, patterns.reference);
      const merchant = this.extractMerchant(message);

      return {
        amount,
        type,
        accountNumber,
        merchant,
        date: timestamp,
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

  /**
   * Detect bank type from sender
   */
  private static detectBankType(sender: string): 'cbe' | 'generic' {
    const senderLower = sender.toLowerCase();
    if (senderLower.includes('cbe') || senderLower.includes('commercial bank')) {
      return 'cbe';
    }
    return 'generic';
  }

  /**
   * Parse amount from string
   */
  private static parseAmount(amountStr: string): number {
    const cleaned = amountStr.replace(/,/g, '').trim();
    const amount = parseFloat(cleaned);
    return isNaN(amount) ? 0 : amount;
  }

  /**
   * Extract account number (last 3-4 digits)
   */
  private static extractAccountNumber(message: string, pattern: RegExp): string | undefined {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].slice(-4); // Get last 4 digits
    }
    return undefined;
  }

  /**
   * Extract balance
   */
  private static extractBalance(message: string, pattern: RegExp): number | undefined {
    const match = message.match(pattern);
    if (match && match[1]) {
      return this.parseAmount(match[1]);
    }
    return undefined;
  }

  /**
   * Extract fees
   */
  private static extractFees(message: string, pattern: RegExp): number | undefined {
    const match = message.match(pattern);
    if (match && match[1]) {
      return this.parseAmount(match[1]);
    }
    return undefined;
  }

  /**
   * Extract tax
   */
  private static extractTax(message: string, pattern: RegExp): number | undefined {
    const match = message.match(pattern);
    if (match && match[1]) {
      return this.parseAmount(match[1]);
    }
    return undefined;
  }

  /**
   * Extract reference number
   */
  private static extractReference(message: string, pattern: RegExp): string | undefined {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
    return undefined;
  }

  /**
   * Extract merchant name
   */
  private static extractMerchant(message: string): string | undefined {
    const merchantPatterns = [
      /(?:at|to|from|merchant|store)[\s:]+([A-Z][A-Za-z\s&]+?)(?:\s+on|\s+dated|\s+\d|$)/i,
      /(?:paid to|received from)[\s:]+([A-Za-z\s&]+?)(?:\s+on|\s+dated|\s+\d|$)/i,
    ];

    for (const pattern of merchantPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  /**
   * Match account by last 3-4 digits
   */
  static matchAccount(
    smsAccountNumber: string | undefined,
    accounts: Array<{ id: string; account_number?: string; name: string }>
  ): string | null {
    if (!smsAccountNumber) return null;

    for (const account of accounts) {
      if (account.account_number) {
        const lastDigits = account.account_number.slice(-4);
        if (lastDigits === smsAccountNumber || lastDigits.endsWith(smsAccountNumber)) {
          return account.id;
        }
      }
    }

    return null;
  }

  /**
   * Suggest category based on merchant and message
   */
  static suggestCategory(merchant?: string, message?: string): string {
    if (!merchant && !message) return 'Other';

    const text = `${merchant || ''} ${message || ''}`.toLowerCase();

    const categoryMap: { [key: string]: string } = {
      'food|restaurant|cafe|coffee|lunch|dinner|breakfast': 'Food & Dining',
      'supermarket|grocery|market|shop|store|mall|amazon|flipkart': 'Shopping',
      'uber|taxi|bus|fuel|petrol|diesel|transport|parking': 'Transportation',
      'electricity|water|gas|internet|phone|mobile|recharge|bill': 'Bills & Utilities',
      'movie|cinema|game|entertainment|netflix|spotify': 'Entertainment',
      'hospital|pharmacy|medical|health|doctor|clinic': 'Healthcare',
      'salary|income|payment received|payroll': 'Salary',
      'freelance|consulting|project|contract': 'Freelance',
      'dividend|interest|investment|stock|mutual fund': 'Investments',
      'rent|lease|mortgage': 'Housing',
      'school|university|course|education|tuition': 'Education',
    };

    for (const [keywords, category] of Object.entries(categoryMap)) {
      const patterns = keywords.split('|');
      if (patterns.some(keyword => text.includes(keyword))) {
        return category;
      }
    }

    return 'Other';
  }
}
