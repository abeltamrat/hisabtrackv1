import { Account, Budget, Loan, Transaction } from '@/types/database';
import { saveCSV, saveWorkbook } from '@/utils/fileHelper';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';

export class ExportService {
  /**
   * Export transactions to Excel
   */
  static async exportTransactionsToExcel(transactions: Transaction[], filename: string = 'transactions.xlsx') {
    const data = transactions.map(t => ({
      Date: new Date(t.date).toLocaleDateString(),
      Type: t.type,
      Category: t.category,
      Amount: t.amount,
      Description: t.description || '',
      'Sender/Receiver': t.sender_receiver || '',
      Reference: t.reference_number || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

    await saveWorkbook(filename, wb);
  }

  /**
   * Export transactions to CSV
   */
  static async exportTransactionsToCSV(transactions: Transaction[], filename: string = 'transactions.csv') {
    const data = transactions.map(t => ({
      Date: new Date(t.date).toLocaleDateString(),
      Type: t.type,
      Category: t.category,
      Amount: t.amount,
      Description: t.description || '',
      'Sender/Receiver': t.sender_receiver || '',
      Reference: t.reference_number || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    
    if (Platform.OS === 'web') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      await saveCSV(filename, csv);
    } else {
      // On native, save as Excel for better compatibility/sharing
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
      await saveWorkbook(filename.replace(/\.csv$/, '.xlsx'), wb);
    }
  }

  /**
   * Export budgets to Excel
   */
  static async exportBudgetsToExcel(budgets: Budget[], filename: string = 'budgets.xlsx') {
    const data = budgets.map(b => ({
      Category: b.category,
      'Limit Amount': b.limit_amount,
      Period: b.period,
      'Start Date': new Date(b.start_date).toLocaleDateString(),
      'End Date': new Date(b.end_date).toLocaleDateString(),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Budgets');

    await saveWorkbook(filename, wb);
  }

  /**
   * Export loans to Excel
   */
  static async exportLoansToExcel(loans: Loan[], filename: string = 'loans.xlsx') {
    const data = loans.map(l => ({
      Type: l.type,
      'Lender/Borrower': l.lender_borrower_name,
      'Principal Amount': l.principal_amount,
      'Interest Rate': l.interest_rate + '%',
      'Start Date': new Date(l.start_date).toLocaleDateString(),
      'Due Date': new Date(l.due_date).toLocaleDateString(),
      Status: l.status,
      'Remaining Balance': l.remaining_balance,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Loans');

    await saveWorkbook(filename, wb);
  }

  /**
   * Export all data to a comprehensive Excel file
   */
  static async exportAllData(
    transactions: Transaction[],
    budgets: Budget[],
    loans: Loan[],
    accounts: Account[],
    filename: string = 'hisabtrack_export.xlsx'
  ) {
    const wb = XLSX.utils.book_new();

    // Transactions sheet
    const transactionsData = transactions.map(t => ({
      Date: new Date(t.date).toLocaleDateString(),
      Type: t.type,
      Category: t.category,
      Amount: t.amount,
      Description: t.description || '',
      'Sender/Receiver': t.sender_receiver || '',
      Reference: t.reference_number || '',
    }));
    const wsTransactions = XLSX.utils.json_to_sheet(transactionsData);
    XLSX.utils.book_append_sheet(wb, wsTransactions, 'Transactions');

    // Budgets sheet
    const budgetsData = budgets.map(b => ({
      Category: b.category,
      'Limit Amount': b.limit_amount,
      Period: b.period,
      'Start Date': new Date(b.start_date).toLocaleDateString(),
      'End Date': new Date(b.end_date).toLocaleDateString(),
    }));
    const wsBudgets = XLSX.utils.json_to_sheet(budgetsData);
    XLSX.utils.book_append_sheet(wb, wsBudgets, 'Budgets');

    // Loans sheet
    const loansData = loans.map(l => ({
      Type: l.type,
      'Lender/Borrower': l.lender_borrower_name,
      'Principal Amount': l.principal_amount,
      'Interest Rate': l.interest_rate + '%',
      'Start Date': new Date(l.start_date).toLocaleDateString(),
      'Due Date': new Date(l.due_date).toLocaleDateString(),
      Status: l.status,
      'Remaining Balance': l.remaining_balance,
    }));
    const wsLoans = XLSX.utils.json_to_sheet(loansData);
    XLSX.utils.book_append_sheet(wb, wsLoans, 'Loans');

    // Accounts sheet
    const accountsData = accounts.map(a => ({
      Name: a.name,
      Type: a.type,
      Balance: a.balance,
      Currency: a.currency,
      'Is Locked': a.is_locked ? 'Yes' : 'No',
      'Locked Amount': a.locked_amount,
      'Created At': new Date(a.created_at).toLocaleDateString(),
    }));
    const wsAccounts = XLSX.utils.json_to_sheet(accountsData);
    XLSX.utils.book_append_sheet(wb, wsAccounts, 'Accounts');

    await saveWorkbook(filename, wb);
  }

  /**
   * Generate a summary report
   */
  static async generateSummaryReport(transactions: Transaction[], filename: string = 'summary_report.xlsx') {
    const wb = XLSX.utils.book_new();

    // Calculate summary statistics
    const totalIncome = transactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpense = transactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpense;

    // Summary sheet
    const summaryData = [
      { Metric: 'Total Income', Value: totalIncome },
      { Metric: 'Total Expense', Value: totalExpense },
      { Metric: 'Net Balance', Value: balance },
      { Metric: 'Total Transactions', Value: transactions.length },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Category breakdown
    const categoryBreakdown: { [key: string]: number } = {};
    transactions
      .filter(t => t.type === 'EXPENSE')
      .forEach(t => {
        categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
      });

    const categoryData = Object.entries(categoryBreakdown)
      .map(([category, amount]) => ({ Category: category, Amount: amount }))
      .sort((a, b) => b.Amount - a.Amount);

    const wsCategory = XLSX.utils.json_to_sheet(categoryData);
    XLSX.utils.book_append_sheet(wb, wsCategory, 'Category Breakdown');

    await saveWorkbook(filename, wb);
  }
}