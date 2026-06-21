import { GoogleGenerativeAI } from '@google/generative-ai';
import { Platform } from 'react-native';

export interface FinancialData {
    totalIncome: number;
    totalExpense: number;
    balance: number;
    transactions: any[];
    budgets: any[];
    loans: any[];
    accounts: any[];
    savingsRate?: number;
    topExpenseCategory?: string;
    monthlyAverage?: number;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    provider?: AssistantProvider;
}

export interface AssistantApiKeys {
    geminiApiKey?: string;
    groqApiKey?: string;
    openRouterApiKey?: string;
    usePuterJs?: boolean;
}

export type AssistantProvider = 'gemini' | 'groq' | 'openrouter' | 'puter' | 'local' | 'none';
type LocalIntent = 'summary' | 'budget' | 'savings' | 'spending' | 'debt' | 'forecast' | 'health' | 'help';

interface LocalCategorySummary {
    category: string;
    amount: number;
    sharePercent: number;
    count: number;
}

interface LocalBudgetSummary {
    category: string;
    limit: number;
    spent: number;
    remaining: number;
    usagePercent: number;
    status: 'OVER' | 'NEAR' | 'ON_TRACK';
}

interface LocalLoanAlert {
    name: string;
    remaining: number;
    dueDate: number | null;
    interestRate: number;
    overdue: boolean;
    dueSoon: boolean;
}

interface LocalLoanSummary {
    activeBorrowed: number;
    activeLent: number;
    borrowedCount: number;
    lentCount: number;
    overdueAmount: number;
    overdueCount: number;
    dueSoonAmount: number;
    dueSoonCount: number;
    weightedBorrowedInterest: number;
    priorityLoans: LocalLoanAlert[];
}

interface LocalFinanceSnapshot {
    totalIncome: number;
    totalExpense: number;
    netBalance: number;
    savingsRate: number;
    transactionCount: number;
    incomeCount: number;
    expenseCount: number;
    transferCount: number;
    averageExpense: number;
    monthlyExpenseRunRate: number;
    topExpenseCategories: LocalCategorySummary[];
    budgetSummaries: LocalBudgetSummary[];
    budgetOverCount: number;
    budgetNearCount: number;
    budgetHealthyCount: number;
    loanSummary: LocalLoanSummary;
    runwayMonths: number | null;
    currentMonthExpense: number;
    previousMonthExpense: number;
    currentMonthIncome: number;
    previousMonthIncome: number;
    expenseTrendPercent: number | null;
    incomeTrendPercent: number | null;
    smallPurchaseCount: number;
    smallPurchaseTotal: number;
    largeExpenses: Array<{ amount: number; category: string; description: string; date: number }>;
    noData: boolean;
}

export class AIFinancialAssistant {
    private static chatHistory: ChatMessage[] = [];
    private static lastProviderUsed: AssistantProvider = 'none';
    private static readonly ONE_DAY_MS = 24 * 60 * 60 * 1000;
    private static readonly BUDGET_NEAR_THRESHOLD = 0.85;
    private static readonly GEMINI_MODEL_CANDIDATES = [
        'gemini-2.0-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash',
        'gemini-1.5-pro-latest',
    ];
    private static readonly GROQ_MODEL_CANDIDATES = [
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'mixtral-8x7b-32768',
    ];
    private static readonly OPENROUTER_MODEL_CANDIDATES = [
        'meta-llama/llama-3.1-8b-instruct:free',
        'google/gemma-2-9b-it:free',
        'mistralai/mistral-7b-instruct:free',
    ];
    private static workingGeminiModelByApiKey = new Map<string, string>();
    private static workingGroqModelByApiKey = new Map<string, string>();
    private static workingOpenRouterModelByApiKey = new Map<string, string>();
    private static puterScriptLoadPromise: Promise<void> | null = null;

    private static normalizeApiKeys(apiKeys: AssistantApiKeys | string): AssistantApiKeys {
        if (typeof apiKeys === 'string') {
            return { geminiApiKey: apiKeys.trim(), usePuterJs: true };
        }

        return {
            geminiApiKey: apiKeys.geminiApiKey?.trim(),
            groqApiKey: apiKeys.groqApiKey?.trim(),
            openRouterApiKey: apiKeys.openRouterApiKey?.trim(),
            usePuterJs: apiKeys.usePuterJs !== false,
        };
    }

    private static shouldTryNextModel(error: unknown) {
        const message = String((error as any)?.message || '').toLowerCase();
        return (
            message.includes('404') ||
            message.includes('429') ||
            message.includes('quota') ||
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('resource_exhausted') ||
            message.includes('not found') ||
            message.includes('unsupported') ||
            message.includes('api version')
        );
    }

    private static isQuotaOrRateLimitError(error: unknown) {
        const message = String((error as any)?.message || '').toLowerCase();
        return (
            message.includes('429') ||
            message.includes('quota') ||
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('resource_exhausted')
        );
    }

    private static isMissingKeyError(error: unknown) {
        const message = String((error as any)?.message || '').toLowerCase();
        return (
            message.includes('api key is missing') ||
            message.includes('no ai provider key configured') ||
            message.includes('no ai provider configured')
        );
    }

    private static getLocalChatFallback(userMessage: string, data: FinancialData): string {
        const snapshot = this.buildLocalSnapshot(data);
        const intent = this.detectLocalIntent(userMessage);

        switch (intent) {
            case 'budget':
                return this.buildLocalBudgetResponse(snapshot);
            case 'savings':
                return this.buildLocalSavingsResponse(snapshot);
            case 'spending':
                return this.buildLocalSpendingResponse(snapshot);
            case 'debt':
                return this.buildLocalDebtResponse(snapshot);
            case 'forecast':
                return this.buildLocalForecastResponse(snapshot);
            case 'health':
                return this.buildLocalHealthResponse(snapshot);
            case 'help':
                return this.buildLocalHelpResponse();
            case 'summary':
            default:
                return this.buildLocalSummaryResponse(snapshot);
        }
    }

    private static toFiniteNumber(value: unknown): number {
        const amount = Number(value);
        return Number.isFinite(amount) ? amount : 0;
    }

    private static toTimestamp(value: unknown): number | null {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric;
        }

        if (typeof value === 'string' && value.trim()) {
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return null;
    }

    private static normalizeCategory(value: unknown): string {
        return String(value || 'Uncategorized')
            .trim()
            .toLowerCase()
            .replace(/>/g, '/')
            .replace(/\s+/g, ' ');
    }

    private static categoryMatches(expenseCategory: string, budgetCategory: string): boolean {
        const expense = this.normalizeCategory(expenseCategory);
        const budget = this.normalizeCategory(budgetCategory);

        if (!budget || budget === 'uncategorized') {
            return expense === budget;
        }

        return (
            expense === budget ||
            expense.startsWith(`${budget}/`) ||
            expense.startsWith(`${budget}:`) ||
            expense.startsWith(`${budget} `)
        );
    }

    private static formatMoney(amount: number): string {
        const sign = amount < 0 ? '-' : '';
        return `${sign}$${Math.abs(amount).toFixed(2)}`;
    }

    private static formatPercent(value: number): string {
        return `${value.toFixed(1)}%`;
    }

    private static formatDate(timestamp: number | null): string {
        if (!timestamp) return 'no due date';
        try {
            return new Date(timestamp).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            });
        } catch {
            return 'invalid date';
        }
    }

    private static calculateTrend(current: number, previous: number): number | null {
        if (previous > 0) {
            return ((current - previous) / previous) * 100;
        }

        if (current === 0) {
            return 0;
        }

        return null;
    }

    private static buildLocalSnapshot(data: FinancialData): LocalFinanceSnapshot {
        const transactions = Array.isArray(data.transactions) ? data.transactions : [];
        const budgets = Array.isArray(data.budgets) ? data.budgets : [];
        const loans = Array.isArray(data.loans) ? data.loans : [];
        const now = Date.now();

        const expenseItems: Array<{ amount: number; category: string; description: string; date: number }> = [];
        const incomeItems: Array<{ amount: number; date: number }> = [];
        let transferCount = 0;
        const categoryMap = new Map<string, { amount: number; count: number }>();

        let minDate = Number.POSITIVE_INFINITY;
        let maxDate = 0;

        for (const transaction of transactions) {
            const tx = transaction as any;
            const type = String(tx?.type || '').toUpperCase();
            const amount = this.toFiniteNumber(tx?.amount);
            const date = this.toTimestamp(tx?.date) ?? now;
            const category = String(tx?.category || 'Uncategorized').trim() || 'Uncategorized';
            const description = String(tx?.description || tx?.sender_receiver || '').trim();

            minDate = Math.min(minDate, date);
            maxDate = Math.max(maxDate, date);

            if (type === 'EXPENSE') {
                expenseItems.push({ amount, category, description, date });
                const current = categoryMap.get(category) || { amount: 0, count: 0 };
                current.amount += amount;
                current.count += 1;
                categoryMap.set(category, current);
            } else if (type === 'INCOME') {
                incomeItems.push({ amount, date });
            } else if (type === 'TRANSFER') {
                transferCount += 1;
            }
        }

        const totalIncome = incomeItems.reduce((sum, item) => sum + item.amount, 0);
        const totalExpense = expenseItems.reduce((sum, item) => sum + item.amount, 0);
        const fallbackBalance = totalIncome - totalExpense;
        const netBalanceRaw = Number(data.balance);
        const netBalance = Number.isFinite(netBalanceRaw) ? netBalanceRaw : fallbackBalance;
        const savingsRate = totalIncome > 0 ? (netBalance / totalIncome) * 100 : 0;

        const transactionCount = transactions.length;
        const incomeCount = incomeItems.length;
        const expenseCount = expenseItems.length;
        const averageExpense = expenseCount > 0 ? totalExpense / expenseCount : 0;

        const activeDays = transactionCount > 1 && Number.isFinite(minDate) && maxDate > minDate
            ? Math.max(1, Math.ceil((maxDate - minDate) / this.ONE_DAY_MS) + 1)
            : 30;
        const monthlyExpenseRunRate = totalExpense > 0 ? (totalExpense / activeDays) * 30 : 0;

        const topExpenseCategories = [...categoryMap.entries()]
            .map(([category, stats]) => ({
                category,
                amount: stats.amount,
                count: stats.count,
                sharePercent: totalExpense > 0 ? (stats.amount / totalExpense) * 100 : 0,
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5);

        const nowDate = new Date(now);
        const startCurrentMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
        const startNextMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1).getTime();
        const startPreviousMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).getTime();

        const currentMonthExpense = expenseItems
            .filter((item) => item.date >= startCurrentMonth && item.date < startNextMonth)
            .reduce((sum, item) => sum + item.amount, 0);
        const previousMonthExpense = expenseItems
            .filter((item) => item.date >= startPreviousMonth && item.date < startCurrentMonth)
            .reduce((sum, item) => sum + item.amount, 0);
        const currentMonthIncome = incomeItems
            .filter((item) => item.date >= startCurrentMonth && item.date < startNextMonth)
            .reduce((sum, item) => sum + item.amount, 0);
        const previousMonthIncome = incomeItems
            .filter((item) => item.date >= startPreviousMonth && item.date < startCurrentMonth)
            .reduce((sum, item) => sum + item.amount, 0);

        const expenseTrendPercent = this.calculateTrend(currentMonthExpense, previousMonthExpense);
        const incomeTrendPercent = this.calculateTrend(currentMonthIncome, previousMonthIncome);

        const budgetSummaries: LocalBudgetSummary[] = [];
        for (const budget of budgets) {
            const rawBudget = budget as any;
            const limit = this.toFiniteNumber(rawBudget?.limit_amount ?? rawBudget?.base_limit_amount);
            if (limit <= 0) continue;

            const start = this.toTimestamp(rawBudget?.start_date) ?? startCurrentMonth;
            const end = this.toTimestamp(rawBudget?.end_date) ?? startNextMonth;
            const budgetCategory = String(rawBudget?.category || 'Uncategorized');

            const spent = expenseItems
                .filter((item) =>
                    item.date >= start &&
                    item.date <= end &&
                    this.categoryMatches(item.category, budgetCategory)
                )
                .reduce((sum, item) => sum + item.amount, 0);

            const usagePercent = (spent / limit) * 100;
            const remaining = limit - spent;
            const status: LocalBudgetSummary['status'] = usagePercent >= 100
                ? 'OVER'
                : usagePercent >= this.BUDGET_NEAR_THRESHOLD * 100
                    ? 'NEAR'
                    : 'ON_TRACK';

            budgetSummaries.push({
                category: budgetCategory,
                limit,
                spent,
                remaining,
                usagePercent,
                status,
            });
        }

        budgetSummaries.sort((a, b) => {
            const severity = { OVER: 2, NEAR: 1, ON_TRACK: 0 } as const;
            const severityGap = severity[b.status] - severity[a.status];
            if (severityGap !== 0) return severityGap;
            return b.spent - a.spent;
        });

        let activeBorrowed = 0;
        let activeLent = 0;
        let borrowedCount = 0;
        let lentCount = 0;
        let overdueAmount = 0;
        let overdueCount = 0;
        let dueSoonAmount = 0;
        let dueSoonCount = 0;
        let weightedInterestNumerator = 0;
        let weightedInterestDenominator = 0;
        const priorityLoans: LocalLoanAlert[] = [];

        for (const loan of loans) {
            const rawLoan = loan as any;
            const status = String(rawLoan?.status || '').toUpperCase();
            const type = String(rawLoan?.type || '').toUpperCase();
            if (status !== 'ACTIVE') continue;

            const remaining = this.toFiniteNumber(rawLoan?.remaining_balance ?? rawLoan?.principal_amount);
            const dueDate = this.toTimestamp(rawLoan?.due_date);
            const interestRate = this.toFiniteNumber(rawLoan?.interest_rate);
            const name = String(rawLoan?.lender_borrower_name || 'Loan').trim() || 'Loan';

            const overdue = dueDate !== null && dueDate < now;
            const dueSoon = dueDate !== null && dueDate >= now && dueDate - now <= 7 * this.ONE_DAY_MS;

            if (type === 'BORROWED') {
                borrowedCount += 1;
                activeBorrowed += remaining;
                weightedInterestNumerator += interestRate * remaining;
                weightedInterestDenominator += remaining;
                if (overdue) {
                    overdueAmount += remaining;
                    overdueCount += 1;
                } else if (dueSoon) {
                    dueSoonAmount += remaining;
                    dueSoonCount += 1;
                }
            } else if (type === 'LENT') {
                lentCount += 1;
                activeLent += remaining;
            }

            priorityLoans.push({
                name,
                remaining,
                dueDate,
                interestRate,
                overdue,
                dueSoon,
            });
        }

        priorityLoans.sort((a, b) => {
            if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
            if (a.dueSoon !== b.dueSoon) return a.dueSoon ? -1 : 1;
            if (a.interestRate !== b.interestRate) return b.interestRate - a.interestRate;
            return b.remaining - a.remaining;
        });

        const weightedBorrowedInterest = weightedInterestDenominator > 0
            ? weightedInterestNumerator / weightedInterestDenominator
            : 0;
        const runwayMonths = monthlyExpenseRunRate > 0 && netBalance > 0
            ? netBalance / monthlyExpenseRunRate
            : null;

        const smallPurchaseThreshold = 20;
        const smallPurchases = expenseItems.filter((item) => item.amount > 0 && item.amount <= smallPurchaseThreshold);
        const smallPurchaseCount = smallPurchases.length;
        const smallPurchaseTotal = smallPurchases.reduce((sum, item) => sum + item.amount, 0);

        const largeExpenseThreshold = averageExpense > 0 ? Math.max(averageExpense * 2, 50) : 100;
        const largeExpenses = expenseItems
            .filter((item) => item.amount >= largeExpenseThreshold)
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 3);

        return {
            totalIncome,
            totalExpense,
            netBalance,
            savingsRate,
            transactionCount,
            incomeCount,
            expenseCount,
            transferCount,
            averageExpense,
            monthlyExpenseRunRate,
            topExpenseCategories,
            budgetSummaries,
            budgetOverCount: budgetSummaries.filter((item) => item.status === 'OVER').length,
            budgetNearCount: budgetSummaries.filter((item) => item.status === 'NEAR').length,
            budgetHealthyCount: budgetSummaries.filter((item) => item.status === 'ON_TRACK').length,
            loanSummary: {
                activeBorrowed,
                activeLent,
                borrowedCount,
                lentCount,
                overdueAmount,
                overdueCount,
                dueSoonAmount,
                dueSoonCount,
                weightedBorrowedInterest,
                priorityLoans: priorityLoans.slice(0, 3),
            },
            runwayMonths,
            currentMonthExpense,
            previousMonthExpense,
            currentMonthIncome,
            previousMonthIncome,
            expenseTrendPercent,
            incomeTrendPercent,
            smallPurchaseCount,
            smallPurchaseTotal,
            largeExpenses,
            noData: transactionCount === 0,
        };
    }

    private static detectLocalIntent(userMessage: string): LocalIntent {
        const message = userMessage.toLowerCase();

        if (/(budget|limit|overspend|over budget|rollover)/.test(message)) {
            return 'budget';
        }
        if (/(save|saving|emergency|goal|invest|retire)/.test(message)) {
            return 'savings';
        }
        if (/(debt|loan|borrow|borrowed|lend|lent|repay|interest|overdue|due)/.test(message)) {
            return 'debt';
        }
        if (/(spend|spending|expense|category|merchant|where.*money)/.test(message)) {
            return 'spending';
        }
        if (/(forecast|projection|predict|next month|future|runway|cash flow)/.test(message)) {
            return 'forecast';
        }
        if (/(health|safe|overall|risk|finance)/.test(message)) {
            return 'health';
        }
        if (/(help|what can you do|options|commands)/.test(message)) {
            return 'help';
        }
        return 'summary';
    }

    private static buildLocalActionLines(snapshot: LocalFinanceSnapshot): string[] {
        const actions: string[] = [];

        if (snapshot.netBalance < 0) {
            actions.push(`Pause non-essential spending for 7 days to close a ${this.formatMoney(Math.abs(snapshot.netBalance))} deficit.`);
        }

        const firstOverBudget = snapshot.budgetSummaries.find((item) => item.status === 'OVER');
        if (firstOverBudget) {
            actions.push(`Recover ${this.formatMoney(Math.abs(firstOverBudget.remaining))} in ${firstOverBudget.category} to return within budget.`);
        }

        if (snapshot.totalIncome > 0 && snapshot.savingsRate < 20) {
            const targetSavings = snapshot.totalIncome * 0.2;
            const currentSavings = Math.max(snapshot.netBalance, 0);
            const gap = Math.max(targetSavings - currentSavings, 0);
            if (gap > 0) {
                actions.push(`Automate ${this.formatMoney(gap)} to savings this period to reach a 20% savings target.`);
            }
        }

        if (snapshot.loanSummary.overdueAmount > 0) {
            actions.push(`Prioritize overdue debt of ${this.formatMoney(snapshot.loanSummary.overdueAmount)} to avoid extra penalties.`);
        } else if (snapshot.loanSummary.dueSoonAmount > 0) {
            actions.push(`Prepare ${this.formatMoney(snapshot.loanSummary.dueSoonAmount)} for debt payments due within 7 days.`);
        }

        const topCategory = snapshot.topExpenseCategories[0];
        if (topCategory && topCategory.sharePercent >= 20) {
            actions.push(`Trim ${topCategory.category} by 10% to free about ${this.formatMoney(topCategory.amount * 0.1)}.`);
        }

        if (actions.length === 0) {
            actions.push('Keep logging transactions daily and review budgets weekly to stay on track.');
        }

        const uniqueActions = [...new Set(actions)];
        return uniqueActions.slice(0, 3);
    }

    private static buildNoDataResponse(): string {
        return [
            'I need transaction history to give personalized advice.',
            'Start by recording income and expenses for at least a few days.',
            'Then ask me for budget, spending, savings, debt, or forecast insights.',
        ].join('\n');
    }

    private static buildLocalSummaryResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.noData) {
            return this.buildNoDataResponse();
        }

        const topCategories = snapshot.topExpenseCategories
            .slice(0, 3)
            .map((item) => `${item.category} ${this.formatMoney(item.amount)} (${item.sharePercent.toFixed(0)}%)`)
            .join(', ');
        const actions = this.buildLocalActionLines(snapshot);

        const trendLine = snapshot.expenseTrendPercent === null
            ? 'Expense trend: not enough previous-month data.'
            : `Expense trend: ${snapshot.expenseTrendPercent >= 0 ? '+' : ''}${snapshot.expenseTrendPercent.toFixed(1)}% vs last month.`;

        const budgetLine = snapshot.budgetSummaries.length === 0
            ? 'Budgets: no active budgets configured.'
            : `Budgets: ${snapshot.budgetOverCount} over, ${snapshot.budgetNearCount} near limit, ${snapshot.budgetHealthyCount} on track.`;

        const debtLine = snapshot.loanSummary.borrowedCount === 0
            ? 'Debt: no active borrowed loans.'
            : `Debt: active borrowed ${this.formatMoney(snapshot.loanSummary.activeBorrowed)} (${snapshot.loanSummary.overdueCount} overdue, ${snapshot.loanSummary.dueSoonCount} due soon).`;

        return [
            `Summary: income ${this.formatMoney(snapshot.totalIncome)}, expenses ${this.formatMoney(snapshot.totalExpense)}, net ${this.formatMoney(snapshot.netBalance)}.`,
            `Savings rate: ${this.formatPercent(snapshot.savingsRate)}.`,
            trendLine,
            `Top spending: ${topCategories || 'no expense categories yet.'}`,
            budgetLine,
            debtLine,
            'Next actions:',
            ...actions.map((action, index) => `${index + 1}. ${action}`),
        ].join('\n');
    }

    private static buildLocalBudgetResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.noData) {
            return this.buildNoDataResponse();
        }

        if (snapshot.budgetSummaries.length === 0) {
            const suggestions = snapshot.topExpenseCategories
                .slice(0, 3)
                .map((category) => `${category.category}: ${this.formatMoney(category.amount * 0.9)}`)
                .join('; ');

            return [
                'No active budgets found.',
                'Recommended starting limits from your spending:',
                suggestions || 'Create budgets for your top recurring categories.',
                'Use a warning threshold at 85% to avoid overspending early.',
            ].join('\n');
        }

        const highlights = snapshot.budgetSummaries.slice(0, 4).map((budget) => {
            const statusText = budget.status === 'OVER'
                ? `OVER by ${this.formatMoney(Math.abs(budget.remaining))}`
                : budget.status === 'NEAR'
                    ? `NEAR limit (${this.formatMoney(budget.remaining)} left)`
                    : `ON TRACK (${this.formatMoney(budget.remaining)} left)`;
            return `- ${budget.category}: spent ${this.formatMoney(budget.spent)} of ${this.formatMoney(budget.limit)} (${budget.usagePercent.toFixed(0)}%) -> ${statusText}`;
        });

        return [
            `Budget status: ${snapshot.budgetOverCount} over, ${snapshot.budgetNearCount} near, ${snapshot.budgetHealthyCount} healthy.`,
            ...highlights,
            ...this.buildLocalActionLines(snapshot).slice(0, 2).map((action, index) => `${index + 1}. ${action}`),
        ].join('\n');
    }

    private static buildLocalSavingsResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.noData) {
            return this.buildNoDataResponse();
        }

        if (snapshot.totalIncome <= 0) {
            return [
                'I cannot calculate a reliable savings plan yet because income records are missing.',
                'Add income transactions first, then target at least 20% savings rate.',
            ].join('\n');
        }

        const targetSavings = snapshot.totalIncome * 0.2;
        const currentSavings = Math.max(snapshot.netBalance, 0);
        const savingsGap = Math.max(targetSavings - currentSavings, 0);
        const emergencyFundGoal = snapshot.monthlyExpenseRunRate > 0 ? snapshot.monthlyExpenseRunRate * 3 : snapshot.totalExpense * 3;
        const emergencyProgress = emergencyFundGoal > 0 ? (currentSavings / emergencyFundGoal) * 100 : 0;

        return [
            `Savings rate: ${this.formatPercent(snapshot.savingsRate)} (target: 20.0%).`,
            `Target savings for this period: ${this.formatMoney(targetSavings)}.`,
            savingsGap > 0
                ? `You are short by ${this.formatMoney(savingsGap)}.`
                : 'You are on or above the 20% savings target.',
            emergencyFundGoal > 0
                ? `Emergency fund goal (3 months): ${this.formatMoney(emergencyFundGoal)}. Progress: ${Math.min(emergencyProgress, 999).toFixed(0)}%.`
                : 'Emergency fund goal will be calculated after more expense history.',
            ...this.buildLocalActionLines(snapshot).slice(0, 2).map((action, index) => `${index + 1}. ${action}`),
        ].join('\n');
    }

    private static buildLocalSpendingResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.noData || snapshot.expenseCount === 0) {
            return [
                'I need more expense transactions to analyze spending patterns.',
                'Record a few expenses and ask again for detailed category insights.',
            ].join('\n');
        }

        const categoryLines = snapshot.topExpenseCategories
            .slice(0, 4)
            .map((item) => `- ${item.category}: ${this.formatMoney(item.amount)} (${item.sharePercent.toFixed(0)}%)`)
            .join('\n');

        const trendLine = snapshot.expenseTrendPercent === null
            ? 'Spending trend: not enough previous-month history.'
            : `Spending trend: ${snapshot.expenseTrendPercent >= 0 ? '+' : ''}${snapshot.expenseTrendPercent.toFixed(1)}% vs last month.`;

        const largeTxLine = snapshot.largeExpenses.length > 0
            ? `Large expenses: ${snapshot.largeExpenses.map((item) => `${item.category} ${this.formatMoney(item.amount)}`).join(', ')}.`
            : 'Large expenses: no unusual high-value expenses detected.';

        const smallTxLine = snapshot.smallPurchaseCount > 0
            ? `Small purchases (<= $20): ${snapshot.smallPurchaseCount} totaling ${this.formatMoney(snapshot.smallPurchaseTotal)}.`
            : 'Small purchases: no significant micro-spending pattern detected.';

        return [
            `Total expenses: ${this.formatMoney(snapshot.totalExpense)} across ${snapshot.expenseCount} transactions.`,
            `Average expense: ${this.formatMoney(snapshot.averageExpense)}.`,
            trendLine,
            'Top categories:',
            categoryLines,
            smallTxLine,
            largeTxLine,
            ...this.buildLocalActionLines(snapshot).slice(0, 2).map((action, index) => `${index + 1}. ${action}`),
        ].join('\n');
    }

    private static buildLocalDebtResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.loanSummary.borrowedCount === 0 && snapshot.loanSummary.lentCount === 0) {
            return [
                'No active loan records found.',
                'If you track borrowed/lent money here, I can build a payoff or collection strategy.',
            ].join('\n');
        }

        const lines: string[] = [
            `Borrowed: ${this.formatMoney(snapshot.loanSummary.activeBorrowed)} across ${snapshot.loanSummary.borrowedCount} active loan(s).`,
            `Lent out: ${this.formatMoney(snapshot.loanSummary.activeLent)} across ${snapshot.loanSummary.lentCount} active loan(s).`,
        ];

        if (snapshot.loanSummary.weightedBorrowedInterest > 0) {
            lines.push(`Weighted borrowed interest rate: ${snapshot.loanSummary.weightedBorrowedInterest.toFixed(2)}%.`);
        }

        if (snapshot.loanSummary.overdueCount > 0) {
            lines.push(`Overdue debt: ${this.formatMoney(snapshot.loanSummary.overdueAmount)} (${snapshot.loanSummary.overdueCount} loan(s)).`);
        } else if (snapshot.loanSummary.dueSoonCount > 0) {
            lines.push(`Due within 7 days: ${this.formatMoney(snapshot.loanSummary.dueSoonAmount)} (${snapshot.loanSummary.dueSoonCount} loan(s)).`);
        } else {
            lines.push('No overdue or near-due debt detected.');
        }

        if (snapshot.loanSummary.priorityLoans.length > 0) {
            lines.push('Priority loan order:');
            lines.push(...snapshot.loanSummary.priorityLoans.map((loan) => {
                const urgency = loan.overdue ? 'OVERDUE' : loan.dueSoon ? 'DUE SOON' : 'ACTIVE';
                return `- ${loan.name}: ${this.formatMoney(loan.remaining)} at ${loan.interestRate.toFixed(2)}% (${urgency}, due ${this.formatDate(loan.dueDate)}).`;
            }));
        }

        return lines.join('\n');
    }

    private static buildLocalForecastResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.noData) {
            return this.buildNoDataResponse();
        }

        const runwayLine = snapshot.runwayMonths === null
            ? 'Runway: not available yet (needs positive balance and expense history).'
            : `Runway: about ${snapshot.runwayMonths.toFixed(1)} month(s) at current run rate.`;

        const incomeTrendLine = snapshot.incomeTrendPercent === null
            ? 'Income trend: not enough previous-month data.'
            : `Income trend: ${snapshot.incomeTrendPercent >= 0 ? '+' : ''}${snapshot.incomeTrendPercent.toFixed(1)}% vs last month.`;

        const expenseTrendLine = snapshot.expenseTrendPercent === null
            ? 'Expense trend: not enough previous-month data.'
            : `Expense trend: ${snapshot.expenseTrendPercent >= 0 ? '+' : ''}${snapshot.expenseTrendPercent.toFixed(1)}% vs last month.`;

        return [
            `Cash flow run rate: expenses about ${this.formatMoney(snapshot.monthlyExpenseRunRate)} per month.`,
            runwayLine,
            incomeTrendLine,
            expenseTrendLine,
            ...this.buildLocalActionLines(snapshot).slice(0, 2).map((action, index) => `${index + 1}. ${action}`),
        ].join('\n');
    }

    private static buildLocalHealthResponse(snapshot: LocalFinanceSnapshot): string {
        if (snapshot.noData) {
            return this.buildNoDataResponse();
        }

        let health = 'Good';
        if (snapshot.netBalance < 0 || snapshot.savingsRate < 10) {
            health = 'Needs Improvement';
        } else if (snapshot.savingsRate < 20 || snapshot.budgetOverCount > 0) {
            health = 'Fair';
        }

        return [
            `Financial health: ${health}.`,
            `Income ${this.formatMoney(snapshot.totalIncome)} | Expenses ${this.formatMoney(snapshot.totalExpense)} | Net ${this.formatMoney(snapshot.netBalance)}.`,
            `Savings rate: ${this.formatPercent(snapshot.savingsRate)}.`,
            snapshot.budgetSummaries.length > 0
                ? `Budget risk: ${snapshot.budgetOverCount} over limit, ${snapshot.budgetNearCount} near limit.`
                : 'Budget risk: no active budgets to evaluate.',
            snapshot.loanSummary.borrowedCount > 0
                ? `Debt pressure: ${this.formatMoney(snapshot.loanSummary.activeBorrowed)} active borrowed.`
                : 'Debt pressure: no active borrowed loans.',
            'Priority actions:',
            ...this.buildLocalActionLines(snapshot).map((action, index) => `${index + 1}. ${action}`),
        ].join('\n');
    }

    private static buildLocalHelpResponse(): string {
        return [
            'I can answer these local offline questions:',
            '1. "Quick summary" for income, expenses, savings rate, and key actions.',
            '2. "How is my budget?" for over/near budget categories.',
            '3. "How can I save more?" for savings and emergency fund guidance.',
            '4. "Analyze my spending" for top categories and trend checks.',
            '5. "Debt status" for overdue and due-soon loan priorities.',
            '6. "Forecast next month" for runway and cash-flow outlook.',
        ].join('\n');
    }

    private static async generateWithGeminiFallback(apiKey: string, prompt: string): Promise<string> {
        const genAI = new GoogleGenerativeAI(apiKey);
        const cachedModel = this.workingGeminiModelByApiKey.get(apiKey);
        const modelCandidates = cachedModel
            ? [cachedModel, ...this.GEMINI_MODEL_CANDIDATES.filter((candidate) => candidate !== cachedModel)]
            : [...this.GEMINI_MODEL_CANDIDATES];

        let lastError: unknown;

        for (const modelName of modelCandidates) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                this.workingGeminiModelByApiKey.set(apiKey, modelName);
                return response.text();
            } catch (error) {
                lastError = error;
                if (!this.shouldTryNextModel(error)) {
                    break;
                }
            }
        }

        throw lastError || new Error('No compatible Gemini model is available for this API key.');
    }

    private static extractChatCompletionText(payload: any) {
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content.map((part: any) => part?.text || '').join('').trim();
        }
        throw new Error('AI provider response did not include message content.');
    }

    private static async generateWithGroqFallback(apiKey: string, prompt: string): Promise<string> {
        const cachedModel = this.workingGroqModelByApiKey.get(apiKey);
        const modelCandidates = cachedModel
            ? [cachedModel, ...this.GROQ_MODEL_CANDIDATES.filter((candidate) => candidate !== cachedModel)]
            : [...this.GROQ_MODEL_CANDIDATES];

        let lastError: unknown;

        for (const modelName of modelCandidates) {
            try {
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: modelName,
                        temperature: 0.3,
                        max_tokens: 400,
                        messages: [{ role: 'user', content: prompt }],
                    }),
                });

                if (!response.ok) {
                    const details = await response.text();
                    throw new Error(`Groq ${response.status}: ${details}`);
                }

                const payload = await response.json();
                const text = this.extractChatCompletionText(payload);
                this.workingGroqModelByApiKey.set(apiKey, modelName);
                return text;
            } catch (error) {
                lastError = error;
                if (!this.shouldTryNextModel(error)) {
                    break;
                }
            }
        }

        throw lastError || new Error('No compatible Groq model is available for this API key.');
    }

    private static async generateWithOpenRouterFallback(apiKey: string, prompt: string): Promise<string> {
        const cachedModel = this.workingOpenRouterModelByApiKey.get(apiKey);
        const modelCandidates = cachedModel
            ? [cachedModel, ...this.OPENROUTER_MODEL_CANDIDATES.filter((candidate) => candidate !== cachedModel)]
            : [...this.OPENROUTER_MODEL_CANDIDATES];

        let lastError: unknown;

        for (const modelName of modelCandidates) {
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                        'HTTP-Referer': 'https://hisabtrack.app',
                        'X-Title': 'HisabTrack',
                    },
                    body: JSON.stringify({
                        model: modelName,
                        temperature: 0.3,
                        max_tokens: 400,
                        messages: [{ role: 'user', content: prompt }],
                    }),
                });

                if (!response.ok) {
                    const details = await response.text();
                    throw new Error(`OpenRouter ${response.status}: ${details}`);
                }

                const payload = await response.json();
                const text = this.extractChatCompletionText(payload);
                this.workingOpenRouterModelByApiKey.set(apiKey, modelName);
                return text;
            } catch (error) {
                lastError = error;
                if (!this.shouldTryNextModel(error)) {
                    break;
                }
            }
        }

        throw lastError || new Error('No compatible OpenRouter model is available for this API key.');
    }

    private static shouldUsePuter(apiKeys: AssistantApiKeys) {
        return Platform.OS === 'web' && apiKeys.usePuterJs !== false;
    }

    private static async ensurePuterLoaded(): Promise<void> {
        if (Platform.OS !== 'web') {
            throw new Error('Puter.js is only supported on web.');
        }

        const webGlobal = globalThis as any;
        if (typeof webGlobal?.puter?.ai?.chat === 'function') {
            return;
        }

        if (this.puterScriptLoadPromise) {
            return this.puterScriptLoadPromise;
        }

        this.puterScriptLoadPromise = new Promise<void>((resolve, reject) => {
            const documentRef = webGlobal?.document as Document | undefined;
            if (!documentRef?.head) {
                reject(new Error('Puter.js requires a browser document.'));
                return;
            }

            const existingScript = documentRef.querySelector('script[data-hisabtrack-puter="1"]') as HTMLScriptElement | null;

            const handleLoaded = () => {
                if (typeof webGlobal?.puter?.ai?.chat === 'function') {
                    resolve();
                    return;
                }
                reject(new Error('Puter.js loaded but AI API is unavailable.'));
            };

            const handleError = () => {
                reject(new Error('Failed to load Puter.js SDK.'));
            };

            if (existingScript) {
                existingScript.addEventListener('load', handleLoaded, { once: true });
                existingScript.addEventListener('error', handleError, { once: true });
                // In case it already loaded before listeners were attached.
                setTimeout(handleLoaded, 0);
                return;
            }

            const script = documentRef.createElement('script');
            script.src = 'https://js.puter.com/v2/';
            script.async = true;
            script.defer = true;
            script.setAttribute('data-hisabtrack-puter', '1');
            script.addEventListener('load', handleLoaded, { once: true });
            script.addEventListener('error', handleError, { once: true });
            documentRef.head.appendChild(script);
        });

        try {
            await this.puterScriptLoadPromise;
        } catch (error) {
            this.puterScriptLoadPromise = null;
            throw error;
        }
    }

    private static extractPuterText(payload: any): string {
        const candidates: unknown[] = [
            payload?.message?.content,
            payload?.message?.text,
            payload?.content,
            payload?.text,
            payload?.response,
            payload?.result,
            payload?.choices?.[0]?.message?.content,
            payload?.choices?.[0]?.text,
        ];

        if (typeof payload === 'string' && payload.trim()) {
            return payload.trim();
        }

        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
            if (Array.isArray(candidate)) {
                const merged = candidate
                    .map((part: any) => {
                        if (typeof part === 'string') return part;
                        if (typeof part?.text === 'string') return part.text;
                        if (typeof part?.content === 'string') return part.content;
                        return '';
                    })
                    .join('')
                    .trim();
                if (merged) {
                    return merged;
                }
            }
        }

        throw new Error('Puter.js response did not include text content.');
    }

    private static async generateWithPuter(prompt: string): Promise<string> {
        await this.ensurePuterLoaded();
        const webGlobal = globalThis as any;
        const puterChat = webGlobal?.puter?.ai?.chat;

        if (typeof puterChat !== 'function') {
            throw new Error('Puter.js AI chat API is unavailable.');
        }

        let payload: any;
        try {
            payload = await puterChat(prompt, { stream: false });
        } catch {
            payload = await puterChat(prompt);
        }

        return this.extractPuterText(payload);
    }

    private static toErrorSummary(error: unknown) {
        const message = String((error as any)?.message || error || 'Unknown error');
        return message.length > 220 ? `${message.slice(0, 220)}...` : message;
    }

    private static async generateWithProviderFallback(apiKeysInput: AssistantApiKeys | string, prompt: string): Promise<string> {
        const apiKeys = this.normalizeApiKeys(apiKeysInput);
        const errors: string[] = [];
        const hasKeyProvider = !!(apiKeys.geminiApiKey || apiKeys.groqApiKey || apiKeys.openRouterApiKey);
        const shouldTryPuter = this.shouldUsePuter(apiKeys);
        this.lastProviderUsed = 'none';

        if (apiKeys.geminiApiKey) {
            try {
                const result = await this.generateWithGeminiFallback(apiKeys.geminiApiKey, prompt);
                this.lastProviderUsed = 'gemini';
                return result;
            } catch (error) {
                errors.push(`Gemini: ${this.toErrorSummary(error)}`);
            }
        }

        if (apiKeys.groqApiKey) {
            try {
                const result = await this.generateWithGroqFallback(apiKeys.groqApiKey, prompt);
                this.lastProviderUsed = 'groq';
                return result;
            } catch (error) {
                errors.push(`Groq: ${this.toErrorSummary(error)}`);
            }
        }

        if (apiKeys.openRouterApiKey) {
            try {
                const result = await this.generateWithOpenRouterFallback(apiKeys.openRouterApiKey, prompt);
                this.lastProviderUsed = 'openrouter';
                return result;
            } catch (error) {
                errors.push(`OpenRouter: ${this.toErrorSummary(error)}`);
            }
        }

        if (shouldTryPuter) {
            try {
                const result = await this.generateWithPuter(prompt);
                this.lastProviderUsed = 'puter';
                return result;
            } catch (error) {
                errors.push(`Puter.js: ${this.toErrorSummary(error)}`);
            }
        }

        if (!hasKeyProvider && !shouldTryPuter) {
            throw new Error('No AI provider configured. Add Gemini, Groq, OpenRouter, or enable Puter.js (web).');
        }

        throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
    }

    /**
     * Generate financial context for the AI
     */
    private static generateFinancialContext(data: FinancialData): string {
        const savingsRate = data.savingsRate || 0;
        const monthlyIncome = data.totalIncome;
        const monthlyExpense = data.totalExpense;

        // Calculate category breakdown
        const categoryBreakdown: Record<string, number> = {};
        data.transactions
            .filter(t => t.type === 'EXPENSE')
            .forEach(t => {
                categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
            });

        const topCategories = Object.entries(categoryBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([cat, amount]) => `${cat}: $${amount.toFixed(2)}`)
            .join(', ');

        return `
Financial Overview:
- Total Income: $${monthlyIncome.toFixed(2)}
- Total Expenses: $${monthlyExpense.toFixed(2)}
- Net Balance: $${data.balance.toFixed(2)}
- Savings Rate: ${savingsRate.toFixed(1)}%
- Number of Transactions: ${data.transactions.length}
- Active Budgets: ${data.budgets.length}
- Active Loans: ${data.loans.length}
- Bank Accounts: ${data.accounts.length}
- Top Expense Categories: ${topCategories || 'None'}
- Monthly Average Expense: $${(data.monthlyAverage || 0).toFixed(2)}
    `.trim();
    }

    /**
     * Get AI analysis of financial health
     */
    static async analyzeFinancialHealth(data: FinancialData, apiKeys: AssistantApiKeys | string): Promise<string> {
        try {
            const normalizedKeys = this.normalizeApiKeys(apiKeys);
            const context = this.generateFinancialContext(data);

            const prompt = `You are a professional financial advisor. Based on the following financial data, provide a comprehensive analysis of the user's financial health. Be encouraging but honest. Provide 3-5 specific, actionable recommendations.

${context}

Please provide:
1. Overall financial health assessment (Good/Fair/Needs Improvement)
2. Key strengths in their financial management
3. Areas of concern or improvement
4. Specific actionable recommendations
5. Encouraging closing message

Keep your response concise, friendly, and professional.`;

            return await this.generateWithProviderFallback(normalizedKeys, prompt);
        } catch (error) {
            this.lastProviderUsed = 'local';
            if (!this.isMissingKeyError(error)) {
                console.error('AI Analysis Error:', error);
            }
            return this.getFallbackAnalysis(data);
        }
    }

    /**
     * Parse transaction details from a raw SMS message using AI
     */
    static async parseSMS(
        rawMessage: string,
        apiKeys: AssistantApiKeys | string
    ): Promise<{
        amount?: number;
        type?: 'INCOME' | 'EXPENSE';
        accountNumber?: string;
        merchant?: string;
        referenceNumber?: string;
        balance?: number;
        fees?: number;
        tax?: number;
    } | null> {
        try {
            const normalizedKeys = this.normalizeApiKeys(apiKeys);
            const prompt = `You are a financial parsing engine. Extract the transaction details from the following bank SMS message.
Response must be a raw JSON object only (no markdown, no codeblocks like \`\`\`json) matching this exact format:
{
  "amount": number or null,
  "type": "INCOME" or "EXPENSE" or null,
  "accountNumber": "last 4 digits or null",
  "merchant": "sender/recipient name or null",
  "referenceNumber": "ref id or transaction id if present or null",
  "balance": number or null,
  "fees": number or null,
  "tax": number or null
}

SMS: "${rawMessage.replace(/"/g, '\\"')}"`;

            const text = await this.generateWithProviderFallback(normalizedKeys, prompt);
            
            // Clean up code block backticks if AI returns it inside a markdown block
            const cleanText = text.replace(/```json|```/gi, '').trim();
            const result = JSON.parse(cleanText);
            
            if (!result || typeof result.amount !== 'number') {
                return null;
            }
            
            return {
                amount: result.amount || undefined,
                type: result.type === 'INCOME' || result.type === 'EXPENSE' ? result.type : undefined,
                accountNumber: result.accountNumber ? String(result.accountNumber) : undefined,
                merchant: result.merchant || undefined,
                referenceNumber: result.referenceNumber || undefined,
                balance: typeof result.balance === 'number' ? result.balance : undefined,
                fees: typeof result.fees === 'number' ? result.fees : undefined,
                tax: typeof result.tax === 'number' ? result.tax : undefined
            };
        } catch (error) {
            console.error('AI SMS Parsing Error:', error);
            return null;
        }
    }

    /**
     * Chat with AI about finances
     */
    static async chat(userMessage: string, financialData: FinancialData, apiKeys: AssistantApiKeys | string): Promise<string> {
        try {
            const normalizedKeys = this.normalizeApiKeys(apiKeys);
            const context = this.generateFinancialContext(financialData);
            const conversationHistory = this.chatHistory
                .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
                .join('\n');

            const prompt = `You are a helpful, friendly financial advisor assistant. You have access to the user's financial data and can provide personalized advice.

Current Financial Context:
${context}

Previous Conversation:
${conversationHistory || 'This is the start of the conversation.'}

User's Question: ${userMessage}

Provide a helpful, concise, and actionable response. Be encouraging and supportive. If the question is about specific financial data, reference the numbers provided. Keep responses under 200 words.`;

            const assistantMessage = await this.generateWithProviderFallback(normalizedKeys, prompt);

            // Store in chat history
            this.chatHistory.push({
                id: Date.now().toString() + '-user',
                role: 'user',
                content: userMessage,
                timestamp: new Date()
            });

            this.chatHistory.push({
                id: Date.now().toString() + '-assistant',
                role: 'assistant',
                content: assistantMessage,
                timestamp: new Date(),
                provider: this.lastProviderUsed,
            });

            // Keep only last 10 messages
            if (this.chatHistory.length > 10) {
                this.chatHistory = this.chatHistory.slice(-10);
            }

            return assistantMessage;
        } catch (error) {
            this.lastProviderUsed = 'local';
            if (this.isMissingKeyError(error)) {
                return this.getLocalChatFallback(userMessage, financialData);
            }

            if (this.isQuotaOrRateLimitError(error)) {
                console.warn('AI Chat quota/rate limit reached. Falling back to local advice.');
                const local = this.getLocalChatFallback(userMessage, financialData);
                return `AI provider quota is currently reached for your configured keys. Here's local advice:\n\n${local}`;
            }

            console.error('AI Chat Error:', error);
            return this.getLocalChatFallback(userMessage, financialData);
        }
    }

    /**
     * Get spending insights
     */
    static async getSpendingInsights(data: FinancialData, apiKeys: AssistantApiKeys | string): Promise<string> {
        try {
            const normalizedKeys = this.normalizeApiKeys(apiKeys);
            const context = this.generateFinancialContext(data);

            const prompt = `As a financial advisor, analyze the spending patterns and provide insights:

${context}

Provide:
1. Spending pattern analysis
2. Unusual or concerning trends
3. Comparison to typical spending patterns
4. 2-3 specific tips to optimize spending

Keep it brief and actionable (under 150 words).`;

            return await this.generateWithProviderFallback(normalizedKeys, prompt);
        } catch (error) {
            this.lastProviderUsed = 'local';
            if (!this.isMissingKeyError(error)) {
                console.error('AI Insights Error:', error);
            }
            return this.buildLocalSpendingResponse(this.buildLocalSnapshot(data));
        }
    }

    /**
     * Get budget recommendations
     */
    static async getBudgetRecommendations(data: FinancialData, apiKeys: AssistantApiKeys | string): Promise<string> {
        try {
            const normalizedKeys = this.normalizeApiKeys(apiKeys);
            const context = this.generateFinancialContext(data);

            const prompt = `As a financial advisor, suggest budget allocations based on the 50/30/20 rule and the user's current financial situation:

${context}

Provide:
1. Recommended budget allocation (Needs/Wants/Savings)
2. Specific category budget suggestions
3. How to achieve better balance

Keep it practical and under 150 words.`;

            return await this.generateWithProviderFallback(normalizedKeys, prompt);
        } catch (error) {
            this.lastProviderUsed = 'local';
            if (!this.isMissingKeyError(error)) {
                console.error('AI Budget Error:', error);
            }
            return this.getFallbackBudgetAdvice(data);
        }
    }

    /**
     * Clear chat history
     */
    static clearChatHistory(): void {
        this.chatHistory = [];
        this.lastProviderUsed = 'none';
    }

    /**
     * Get chat history
     */
    static getChatHistory(): ChatMessage[] {
        return this.chatHistory;
    }

    static getLastProviderUsed(): AssistantProvider {
        return this.lastProviderUsed;
    }

    /**
     * Fallback analysis when AI is unavailable
     */
    private static getFallbackAnalysis(data: FinancialData): string {
        return this.buildLocalHealthResponse(this.buildLocalSnapshot(data));

        const savingsRate = data.savingsRate || 0;
        let health = 'Good';

        if (savingsRate < 10) health = 'Needs Improvement';
        else if (savingsRate < 20) health = 'Fair';

        return `**Financial Health: ${health}**

Based on your current data:
- You're ${savingsRate >= 20 ? 'doing great' : 'making progress'} with a ${savingsRate.toFixed(1)}% savings rate
- Your balance is $${data.balance.toFixed(2)}

**Recommendations:**
1. ${savingsRate < 20 ? 'Try to increase your savings rate to at least 20%' : 'Maintain your excellent savings habits'}
2. Review your top expense categories monthly
3. Set specific financial goals
4. ${data.budgets.length === 0 ? 'Create budgets for your main expense categories' : 'Keep tracking against your budgets'}

Keep up the good work! 💪`;
    }

    /**
     * Fallback budget advice
     */
    private static getFallbackBudgetAdvice(data: FinancialData): string {
        const snapshot = this.buildLocalSnapshot(data);
        if (snapshot.noData) {
            return this.buildNoDataResponse();
        }

        if (snapshot.totalIncome > 0) {
            const needs = snapshot.totalIncome * 0.5;
            const wants = snapshot.totalIncome * 0.3;
            const savings = snapshot.totalIncome * 0.2;

            return [
                `Recommended 50/30/20 split from income ${this.formatMoney(snapshot.totalIncome)}:`,
                `- Needs (50%): ${this.formatMoney(needs)} for housing, food, transport, utilities.`,
                `- Wants (30%): ${this.formatMoney(wants)} for discretionary spending.`,
                `- Savings/Debt (20%): ${this.formatMoney(savings)} for goals and debt payoff.`,
                '',
                this.buildLocalBudgetResponse(snapshot),
            ].join('\n');
        }

        return this.buildLocalBudgetResponse(snapshot);

    }
}

export default AIFinancialAssistant;
