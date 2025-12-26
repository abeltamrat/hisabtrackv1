// SMS Parser utility for extracting transaction data from SMS messages
export interface ParsedTransaction {
  amount: number;
  type: 'income' | 'expense';
  merchant?: string;
  date: string;
  rawMessage: string;
}

// Common patterns for bank SMS messages
const SMS_PATTERNS = [
  // Debit patterns
  {
    regex: /(?:debited|spent|paid|withdrawn).*?(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
    type: 'expense' as const,
  },
  {
    regex: /(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{2})?).*?(?:debited|spent|paid|withdrawn)/i,
    type: 'expense' as const,
  },
  // Credit patterns
  {
    regex: /(?:credited|received|deposited).*?(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
    type: 'income' as const,
  },
  {
    regex: /(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{2})?).*?(?:credited|received|deposited)/i,
    type: 'income' as const,
  },
];

export const SMSParser = {
  parseTransaction(message: string): ParsedTransaction | null {
    try {
      for (const pattern of SMS_PATTERNS) {
        const match = message.match(pattern.regex);
        if (match) {
          const amountStr = match[1].replace(/,/g, '');
          const amount = parseFloat(amountStr);
          
          if (isNaN(amount)) continue;

          // Extract merchant name (simple heuristic)
          const merchant = this.extractMerchant(message);

          return {
            amount,
            type: pattern.type,
            merchant,
            date: new Date().toISOString(),
            rawMessage: message,
          };
        }
      }
      return null;
    } catch (error) {
      console.error('Error parsing SMS:', error);
      return null;
    }
  },

  extractMerchant(message: string): string | undefined {
    // Look for common merchant indicators
    const merchantPatterns = [
      /(?:at|to|from)\s+([A-Z][A-Za-z\s&]+?)(?:\s+on|\s+dated|\s+\d)/i,
      /(?:merchant|store):\s*([A-Za-z\s&]+)/i,
    ];

    for (const pattern of merchantPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  },

  // Categorize transaction based on merchant/keywords
  suggestCategory(merchant?: string, message?: string): string {
    if (!merchant && !message) return '1'; // Default to Food & Drink

    const text = `${merchant || ''} ${message || ''}`.toLowerCase();

    // Category mapping based on keywords
    const categoryMap: { [key: string]: string } = {
      'food|restaurant|cafe|swiggy|zomato|uber eats': '1', // Food & Drink
      'amazon|flipkart|shop|store|mall': '2', // Shopping
      'uber|ola|petrol|fuel|transport': '3', // Transport
      'electricity|water|gas|bill|recharge': '4', // Bills & Utilities
      'movie|cinema|game|entertainment': '5', // Entertainment
      'hospital|pharmacy|medical|health': '6', // Health
      'salary|income|payment received': '7', // Salary
      'freelance|consulting|project': '8', // Freelance
      'dividend|interest|investment': '9', // Investments
    };

    for (const [keywords, categoryId] of Object.entries(categoryMap)) {
      const patterns = keywords.split('|');
      if (patterns.some(keyword => text.includes(keyword))) {
        return categoryId;
      }
    }

    return '1'; // Default category
  },
};
