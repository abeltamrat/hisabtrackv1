export interface Bank {
  id: string;
  name: string;
  logo?: string;
  logoSrc?: any; // For native: require() result; for web: same as logo
  color?: string;
  website?: string;
  phone?: string;
  smsNumber?: string;
  country?: string;
  isBundled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BankAccount {
  id: string;
  bankId: string;
  accountNumber?: string;
  accountType: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'LOAN';
  balance: number;
  currency: string;
  nickname?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}
