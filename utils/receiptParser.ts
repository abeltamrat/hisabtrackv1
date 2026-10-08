import type { Transaction, TransactionSplit } from '@/types/database';
import { parseLocaleAmount } from './quickAddParser';

export interface ReceiptLine { description: string; amount: number; confidence: number; category?: string; tags?: string[] }
export interface ParsedReceipt {
  merchant?: string; date?: number; lines: ReceiptLine[]; subtotal?: number; discounts: number; taxes: number; fees: number; total?: number; confidence: number; issues: string[];
}

const amountAtEnd = /([-+]?\s*(?:ETB|Birr|Br)?\s*\d[\d., ]*)$/i;
const value = (line: string) => {
  const match = line.match(amountAtEnd);
  if (!match) return null;
  const amount = parseLocaleAmount(match[1].replace(/^[-+]\s*/, ''));
  return amount == null ? null : { amount, label: line.slice(0, match.index).trim(), negative: /^-/.test(match[1].trim()) };
};
const cents = (amount: number) => Math.round(amount * 100);

export function parseReceiptText(text: string): ParsedReceipt {
  const rows = text.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  const issues: string[] = [];
  const dateMatch = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  const date = dateMatch ? (() => { const p = dateMatch[0].split(/[-/.]/).map(Number); const y = p[0] > 1900 ? p[0] : p[2]; const m = p[0] > 1900 ? p[1] : p[1]; const d = p[0] > 1900 ? p[2] : p[0]; return new Date(y, m - 1, d, 12).getTime(); })() : undefined;
  let subtotal: number | undefined; let total: number | undefined; let taxes = 0; let fees = 0; let discounts = 0;
  const lines: ReceiptLine[] = [];
  rows.forEach(row => {
    if (/^\s*(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})(?:\s+\d{1,2}:\d{2})?\s*$/.test(row)) return;
    const parsed = value(row); if (!parsed) return;
    const key = parsed.label.toLowerCase();
    if (/grand\s*total|amount\s*due|^total\b/.test(key)) total = parsed.amount;
    else if (/subtotal|sub total/.test(key)) subtotal = parsed.amount;
    else if (/vat|tax/.test(key)) taxes += parsed.amount;
    else if (/service|fee|charge/.test(key)) fees += parsed.amount;
    else if (/discount|coupon|saving/.test(key)) discounts += parsed.amount;
    else if (parsed.label && parsed.amount > 0) lines.push({ description: parsed.label, amount: parsed.negative ? -parsed.amount : parsed.amount, confidence: 0.72, tags: [] });
  });
  if (!total) issues.push('Total was not recognized. Enter or correct it before continuing.');
  if (!lines.length) issues.push('No line items were recognized. Add them manually.');
  const computed = lines.reduce((sum, line) => sum + line.amount, 0) + taxes + fees - discounts;
  if (total && cents(computed) !== cents(total)) issues.push(`Line items differ from the total by ${(total - computed).toFixed(2)}.`);
  const merchant = rows.find(row => !value(row) && !/receipt|invoice|date|time|tel|tin/i.test(row))?.slice(0, 80);
  return { merchant, date, lines, subtotal, discounts, taxes, fees, total, confidence: Math.max(0.2, Math.min(0.95, 0.45 + (total ? 0.2 : 0) + (lines.length ? 0.2 : 0) + (date ? 0.1 : 0) - issues.length * 0.08)), issues };
}

export function receiptSplits(receipt: ParsedReceipt, fallbackCategory = ''): TransactionSplit[] {
  if (!receipt.total) return [];
  const rows = receipt.lines.map((line, index) => ({ id: `receipt-item-${index}`, amount: line.amount, category: line.category || fallbackCategory, description: line.description, tags: line.tags || [] }));
  if (receipt.taxes > 0) rows.push({ id: 'receipt-tax', amount: receipt.taxes, category: 'Fees & Tax', description: 'Receipt tax', tags: ['receipt'] });
  if (receipt.fees > 0) rows.push({ id: 'receipt-fees', amount: receipt.fees, category: 'Fees & Tax', description: 'Receipt fees', tags: ['receipt'] });
  if (receipt.discounts > 0) {
    const largest = rows.reduce((best, row, index) => row.amount > rows[best].amount ? index : best, 0);
    if (rows[largest]) rows[largest].amount = Math.max(0, rows[largest].amount - receipt.discounts);
  }
  const delta = cents(receipt.total) - rows.reduce((sum, row) => sum + cents(row.amount), 0);
  if (rows.length && delta) rows[rows.length - 1].amount = Math.round((rows[rows.length - 1].amount + delta / 100) * 100) / 100;
  return rows.filter(row => row.amount > 0);
}

export function matchReceipt(receipt: ParsedReceipt, transactions: Transaction[], toleranceDays = 3) {
  if (!receipt.total) return [];
  const anchor = receipt.date || Date.now();
  return transactions.filter(tx => tx.type === 'EXPENSE' && Math.abs(tx.amount - receipt.total!) < 0.01 && Math.abs(tx.date - anchor) <= toleranceDays * 86400000)
    .map(tx => ({ transaction: tx, score: 0.7 + (receipt.merchant && `${tx.sender_receiver || ''} ${tx.description}`.toLowerCase().includes(receipt.merchant.toLowerCase()) ? 0.25 : 0), reason: 'Same amount within the receipt date window' }))
    .sort((a, b) => b.score - a.score || b.transaction.date - a.transaction.date);
}
