import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';

import { saveWorkbook } from '@/utils/fileHelper';
import { Account, Budget, Loan, Transaction } from '@/types/database';

export type ReportType = 'transactions' | 'summary' | 'loans' | 'all_data';

export interface ReportSummary {
  balance?: number;
  income?: number;
  expense?: number;
  savingsRate?: number;
}

export interface ExportOptions {
  data: Transaction[];
  loans?: Loan[];
  accounts?: Account[];
  budgets?: Budget[];
  summary?: ReportSummary;
  title: string;
  type: ReportType;
  format: 'pdf' | 'excel';
  timeRange: string;
}

type SheetRow = Record<string, string | number | boolean | null>;

export class ExportService {
  static async exportReport(options: ExportOptions) {
    const fileName = `HisabTrack_${options.type}_${new Date().toISOString().split('T')[0]}`;

    if (options.format === 'pdf') {
      return this.exportToPDF(options, fileName);
    }

    return this.exportToExcel(options, fileName);
  }

  private static getPremiumStyles() {
    return `
      <style>
        @media print {
          body * { visibility: hidden; }
          #print-container, #print-container * { visibility: visible; }
          #print-container { position: absolute; left: 0; top: 0; width: 100%; }
        }

        body { font-family: Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; background-color: #fff; line-height: 1.5; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
        .logo-container { display: flex; align-items: center; }
        .logo-circle { width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1, #4f46e5); border-radius: 10px; margin-right: 12px; }
        .logo-text { font-size: 24px; font-weight: 800; color: #4f46e5; letter-spacing: -1px; }
        .report-info { text-align: right; }
        .report-title { font-size: 28px; font-weight: 700; color: #0f172a; margin: 0; }
        .report-subtitle { font-size: 14px; color: #64748b; margin: 4px 0 0 0; }

        .section-title { font-size: 18px; font-weight: 700; color: #334155; margin: 30px 0 15px 0; display: flex; align-items: center; }
        .section-title::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; margin-left: 15px; }

        .stats-grid { display: flex; gap: 20px; margin-bottom: 30px; }
        .stat-card { flex: 1; padding: 20px; border-radius: 16px; border: 1px solid #e2e8f0; background-color: #f8fafc; }
        .stat-label { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
        .stat-value { font-size: 20px; font-weight: 700; color: #0f172a; }
        .stat-value.income { color: #10b981; }
        .stat-value.expense { color: #ef4444; }

        table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px; }
        th { background-color: #f1f5f9; color: #475569; font-weight: 600; padding: 12px 15px; text-align: left; font-size: 12px; text-transform: uppercase; }
        td { padding: 12px 15px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #334155; }
        .badge { padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-block; }
        .badge-income { background-color: #dcfce7; color: #166534; }
        .badge-expense { background-color: #fee2e2; color: #991b1b; }
        .badge-transfer { background-color: #dbeafe; color: #1d4ed8; }

        .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
      </style>
    `;
  }

  private static async exportToPDF(options: ExportOptions, fileName: string) {
    try {
      if (options.type === 'all_data') {
        throw new Error('All-data export supports Excel only.');
      }

      let contentHtml = '';

      if (options.type === 'transactions') {
        contentHtml = this.generateTransactionsContent(options);
      } else if (options.type === 'summary') {
        contentHtml = this.generateSummaryContent(options);
      } else {
        contentHtml = this.generateLoansContent(options);
      }

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            ${this.getPremiumStyles()}
          </head>
          <body>
            <div id="print-container">
              <div class="header">
                <div class="logo-container">
                  <div class="logo-circle"></div>
                  <div class="logo-text">HisabTrack</div>
                </div>
                <div class="report-info">
                  <h1 class="report-title">${this.escapeHtml(options.title)}</h1>
                  <p class="report-subtitle">Generated on ${new Date().toLocaleDateString()} - ${this.escapeHtml(this.formatPeriodLabel(options.timeRange))} View</p>
                </div>
              </div>
              ${contentHtml}
              <div class="footer">
                <div>(c) ${new Date().getFullYear()} HisabTrack Financial Management</div>
                <div>Confidential Financial Document</div>
              </div>
            </div>
          </body>
        </html>
      `;

      if (Platform.OS === 'web') {
        this.printReportHtmlOnWeb(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
      }

      return true;
    } catch (error) {
      console.error('PDF export failed:', error);
      throw error;
    }
  }

  private static printReportHtmlOnWeb(html: string) {
    if (typeof window === 'undefined') {
      throw new Error('Web PDF export is not available in this environment.');
    }

    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      this.printReportHtmlInIframeOnWeb(html);
      return;
    }

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();

    let hasPrinted = false;
    const doPrint = () => {
      if (hasPrinted) {
        return;
      }
      hasPrinted = true;
      popup.print();
      popup.onafterprint = () => popup.close();
    };

    if (popup.document.readyState === 'complete') {
      doPrint();
    } else {
      popup.onload = () => {
        doPrint();
      };
      setTimeout(() => {
        doPrint();
      }, 400);
    }
  }

  private static printReportHtmlInIframeOnWeb(html: string) {
    if (typeof document === 'undefined') {
      throw new Error('Web PDF export is not available in this environment.');
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    let hasPrinted = false;
    const cleanup = () => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    const doPrint = () => {
      if (hasPrinted) {
        return;
      }

      const frameWindow = iframe.contentWindow;
      const frameDocument = iframe.contentDocument;
      if (!frameWindow || !frameDocument) {
        cleanup();
        console.error('Unable to initialize PDF print frame.');
        return;
      }

      hasPrinted = true;
      frameWindow.focus();
      frameWindow.print();
      setTimeout(() => {
        cleanup();
      }, 1000);
    };

    iframe.onload = () => {
      setTimeout(() => {
        doPrint();
      }, 100);
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  }

  private static generateTransactionsContent(options: ExportOptions) {
    return `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Transactions</div>
          <div class="stat-value">${options.data.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net Balance</div>
          <div class="stat-value ${(options.summary?.balance ?? 0) >= 0 ? 'income' : 'expense'}">
            ${this.formatAmount(options.summary?.balance ?? 0)}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Period</div>
          <div class="stat-value" style="font-size: 14px;">${this.escapeHtml(this.formatPeriodLabel(options.timeRange))}</div>
        </div>
      </div>

      <div class="section-title">Transaction History</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Details</th>
            <th>Category</th>
            <th>Tags</th>
            <th>Type</th>
            <th style="text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${options.data.map((item) => `
            <tr>
              <td>${new Date(item.date).toLocaleDateString()}</td>
              <td><div style="font-weight: 600;">${this.escapeHtml(item.description || 'No Description')}</div></td>
              <td>${this.escapeHtml(item.category || 'General')}</td>
              <td>${this.escapeHtml((item.tags || []).map((tag) => `#${tag}`).join(', '))}</td>
              <td>
                <span class="badge ${this.getBadgeClass(item.type)}">
                  ${this.escapeHtml(item.type)}
                </span>
              </td>
              <td style="text-align: right; font-weight: 700; color: ${this.getAmountColor(item.type)}">
                ${this.formatAmount(item.amount)}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private static generateSummaryContent(options: ExportOptions) {
    const expenseBreakdown = this.getExpenseBreakdown(options.data, options.summary?.expense ?? 0);

    return `
      <div class="stats-grid">
        <div class="stat-card" style="border-left: 4px solid #10b981;">
          <div class="stat-label">Total Income</div>
          <div class="stat-value income">${this.formatAmount(options.summary?.income ?? 0)}</div>
        </div>
        <div class="stat-card" style="border-left: 4px solid #ef4444;">
          <div class="stat-label">Total Expenses</div>
          <div class="stat-value expense">${this.formatAmount(options.summary?.expense ?? 0)}</div>
        </div>
        <div class="stat-card" style="border-left: 4px solid #6366f1;">
          <div class="stat-label">Savings Rate</div>
          <div class="stat-value">${(options.summary?.savingsRate ?? 0).toFixed(1)}%</div>
        </div>
      </div>

      <div class="section-title">Expense Breakdown</div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th style="text-align: right;">Total Amount</th>
            <th style="text-align: right;">% of Total</th>
          </tr>
        </thead>
        <tbody>
          ${expenseBreakdown.map((item) => `
            <tr>
              <td style="font-weight: 600;">${this.escapeHtml(item.Category)}</td>
              <td style="text-align: right; font-weight: 700;">${this.formatAmount(Number(item.Amount))}</td>
              <td style="text-align: right; color: #64748b;">${item['Percent of Total']}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private static generateLoansContent(options: ExportOptions) {
    const loans = options.loans || [];
    const lentTotal = loans.filter((loan) => loan.type === 'LENT').reduce((sum, loan) => sum + loan.remaining_balance, 0);
    const borrowedTotal = loans.filter((loan) => loan.type === 'BORROWED').reduce((sum, loan) => sum + loan.remaining_balance, 0);

    return `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Active Loans (Lent)</div>
          <div class="stat-value income">${this.formatAmount(lentTotal)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pending Debts (Borrowed)</div>
          <div class="stat-value expense">${this.formatAmount(borrowedTotal)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net Exposure</div>
          <div class="stat-value">${this.formatAmount(lentTotal - borrowedTotal)}</div>
        </div>
      </div>

      <div class="section-title">Loan Records</div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th style="text-align: right;">Remaining Balance</th>
          </tr>
        </thead>
        <tbody>
          ${loans.map((loan) => `
            <tr>
              <td style="font-weight: 600;">${this.escapeHtml(loan.lender_borrower_name)}</td>
              <td>${this.escapeHtml(loan.type)}</td>
              <td>${this.escapeHtml(loan.status)}</td>
              <td style="text-align: right; font-weight: 700;">${this.formatAmount(loan.remaining_balance)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private static async exportToExcel(options: ExportOptions, fileName: string) {
    try {
      const workbook = this.buildWorkbook(options);
      await saveWorkbook(`${fileName}.xlsx`, workbook);
      return true;
    } catch (error) {
      console.error('Excel export failed:', error);
      throw error;
    }
  }

  private static buildWorkbook(options: ExportOptions) {
    const workbook = XLSX.utils.book_new();
    const accountNameMap = this.buildAccountNameMap(options.accounts);

    if (options.type === 'all_data') {
      this.appendSheet(workbook, this.buildAccountRows(options.accounts || []), 'Accounts');
      this.appendSheet(workbook, this.buildTransactionRows(options.data, accountNameMap), 'Transactions');
      this.appendSheet(workbook, this.buildBudgetRows(options.budgets || []), 'Budgets');
      this.appendSheet(workbook, this.buildLoanRows(options.loans || []), 'Loans & Debts');
      return workbook;
    }

    if (options.type === 'summary') {
      this.appendSheet(workbook, this.buildSummaryRows(options), 'Summary');
      this.appendSheet(
        workbook,
        this.getExpenseBreakdown(options.data, options.summary?.expense ?? 0),
        'Category Breakdown'
      );
      return workbook;
    }

    if (options.type === 'loans') {
      this.appendSheet(workbook, this.buildLoanRows(options.loans || []), 'Loans & Debts');
      return workbook;
    }

    this.appendSheet(workbook, this.buildTransactionRows(options.data, accountNameMap), 'Transactions');
    return workbook;
  }

  private static appendSheet(workbook: XLSX.WorkBook, rows: SheetRow[], name: string) {
    const safeRows = rows.length > 0 ? rows : [{ Message: 'No data available' }];
    const worksheet = XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  private static buildTransactionRows(data: Transaction[], accountNameMap: Map<string, string>): SheetRow[] {
    return data.map((item) => {
      const date = new Date(item.date);
      const accountName = this.resolveAccountName(item.account_id, accountNameMap);
      const toAccountName = item.to_account_id ? this.resolveAccountName(item.to_account_id, accountNameMap) : '';

      return {
        Date: date.toLocaleDateString(),
        Time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        Account: accountName,
        'Account ID': item.account_id,
        'To Account': toAccountName,
        'To Account ID': item.to_account_id ?? '',
        Type: item.type,
        Category: item.category || 'N/A',
        Tags: (item.tags || []).join(', '),
        Description: item.description || '',
        Amount: item.amount,
        Reference: item.reference_number ?? '',
        'SMS ID': item.sms_id ?? '',
      };
    });
  }

  private static buildAccountNameMap(accounts?: Account[]) {
    const map = new Map<string, string>();
    (accounts || []).forEach((account) => {
      map.set(account.id, account.name);
    });
    return map;
  }

  private static resolveAccountName(accountId: string, accountNameMap: Map<string, string>) {
    return accountNameMap.get(accountId) || accountId;
  }

  private static buildSummaryRows(options: ExportOptions): SheetRow[] {
    return [
      { Metric: 'Title', Value: options.title },
      { Metric: 'Time Range', Value: this.formatPeriodLabel(options.timeRange) },
      { Metric: 'Total Income', Value: options.summary?.income ?? 0 },
      { Metric: 'Total Expenses', Value: options.summary?.expense ?? 0 },
      { Metric: 'Net Balance', Value: options.summary?.balance ?? 0 },
      { Metric: 'Savings Rate (%)', Value: Number((options.summary?.savingsRate ?? 0).toFixed(1)) },
      { Metric: 'Transaction Count', Value: options.data.length },
    ];
  }

  private static getExpenseBreakdown(data: Transaction[], totalExpense: number): SheetRow[] {
    const categoryTotals = new Map<string, number>();

    data
      .filter((item) => item.type === 'EXPENSE')
      .forEach((item) => {
        const current = categoryTotals.get(item.category) ?? 0;
        categoryTotals.set(item.category, current + item.amount);
      });

    return [...categoryTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({
        Category: category,
        Amount: amount,
        'Percent of Total': totalExpense > 0 ? Number(((amount / totalExpense) * 100).toFixed(1)) : 0,
      }));
  }

  private static buildLoanRows(loans: Loan[]): SheetRow[] {
    return loans.map((loan) => ({
      Name: loan.lender_borrower_name,
      Type: loan.type,
      Status: loan.status,
      Principal: loan.principal_amount,
      Interest: loan.interest_rate,
      'Start Date': new Date(loan.start_date).toLocaleDateString(),
      'Due Date': new Date(loan.due_date).toLocaleDateString(),
      'Remaining Balance': loan.remaining_balance,
    }));
  }

  private static buildAccountRows(accounts: Account[]): SheetRow[] {
    return accounts.map((account) => ({
      Name: account.name,
      Type: account.type,
      Balance: account.balance,
      Currency: account.currency,
      Locked: account.is_locked,
      'Locked Amount': account.locked_amount,
      'Account Number': account.account_number ?? '',
      'SMS Number': account.sms_number ?? '',
    }));
  }

  private static buildBudgetRows(budgets: Budget[]): SheetRow[] {
    return budgets.map((budget) => ({
      Category: budget.category,
      Period: budget.period,
      'Limit Amount': budget.limit_amount,
      'Start Date': new Date(budget.start_date).toLocaleDateString(),
      'End Date': new Date(budget.end_date).toLocaleDateString(),
    }));
  }

  private static formatPeriodLabel(timeRange: string) {
    const normalized = timeRange.trim().toLowerCase();

    switch (normalized) {
      case 'week':
      case 'weekly':
        return 'Weekly';
      case 'month':
      case 'monthly':
        return 'Monthly';
      case 'year':
      case 'yearly':
        return 'Yearly';
      case 'all':
      case 'all time':
        return 'All Time';
      default:
        return timeRange;
    }
  }

  private static formatAmount(amount: number) {
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private static getAmountColor(type: Transaction['type']) {
    if (type === 'INCOME') return '#10b981';
    if (type === 'TRANSFER') return '#2563eb';
    return '#ef4444';
  }

  private static getBadgeClass(type: Transaction['type']) {
    if (type === 'INCOME') return 'badge-income';
    if (type === 'TRANSFER') return 'badge-transfer';
    return 'badge-expense';
  }

  private static escapeHtml(value: string | number | boolean | null | undefined) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

export default ExportService;
