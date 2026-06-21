import { useAppSettings } from '@/contexts/AppSettingsContext';
import BudgetService from '@/services/BudgetService';
import { RootState } from '@/store';
import { Budget, Loan, Transaction } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type LocalAssistantRole = 'user' | 'assistant';

interface LocalAssistantMessage {
  id: string;
  role: LocalAssistantRole;
  content: string;
}

interface AssistantSnapshot {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  savingsRate: number;
  transactionCount: number;
  topExpenseCategory: string | null;
  topExpenseAmount: number;
  overBudgetCount: number;
  dueSoonLoanCount: number;
}

interface FinanceAssistantOverlayProps {
  hidden?: boolean;
}

const QUICK_PROMPTS = [
  'Give me a quick summary',
  'How am I doing on budget?',
  'Where am I spending the most?',
  'How can I save more this month?',
];

const TIP_MUTE_STORAGE_KEY = 'finance_assistant_tip_mute_until';
const TIP_DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TIP_ASK_COOLDOWN_MS = 4 * 60 * 60 * 1000;

const cleanText = (value: string) => value.replace(/\s+/g, ' ').trim();

const buildSnapshot = (transactions: Transaction[], budgets: Budget[], loans: Loan[]): AssistantSnapshot => {
  const totalIncome = transactions
    .filter((transaction) => transaction.type === 'INCOME')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpense = transactions
    .filter((transaction) => transaction.type === 'EXPENSE')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const balance = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

  const categoryTotals = new Map<string, number>();
  transactions
    .filter((transaction) => transaction.type === 'EXPENSE')
    .forEach((transaction) => {
      const category = transaction.category?.trim() || 'General';
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + transaction.amount);
    });

  const topCategoryEntry = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  const now = Date.now();
  const activeBudgets = budgets.filter((budget) => budget.start_date <= now && budget.end_date >= now);
  const metrics = activeBudgets.length > 0
    ? BudgetService.calculateBudgetCollectionMetrics(activeBudgets, budgets, transactions)
    : [];
  const overBudgetCount = metrics.filter((metric) => metric.remaining < 0).length;

  const dueSoonThreshold = now + 7 * 24 * 60 * 60 * 1000;
  const dueSoonLoanCount = loans.filter((loan) =>
    loan.status === 'ACTIVE' && loan.due_date >= now && loan.due_date <= dueSoonThreshold
  ).length;

  return {
    totalIncome,
    totalExpense,
    balance,
    savingsRate,
    transactionCount: transactions.length,
    topExpenseCategory: topCategoryEntry?.[0] ?? null,
    topExpenseAmount: topCategoryEntry?.[1] ?? 0,
    overBudgetCount,
    dueSoonLoanCount,
  };
};

const getProactiveTip = (snapshot: AssistantSnapshot, formatCurrency: (amount: number) => string) => {
  if (snapshot.transactionCount === 0) {
    return 'Track your first transaction to unlock smart spending guidance.';
  }
  if (snapshot.overBudgetCount > 0) {
    return `You are over budget in ${snapshot.overBudgetCount} ${snapshot.overBudgetCount === 1 ? 'category' : 'categories'}.`;
  }
  if (snapshot.balance < 0) {
    return `Your net balance is negative (${formatCurrency(snapshot.balance)}). Consider reducing non-essential spending.`;
  }
  if (snapshot.savingsRate < 10 && snapshot.totalIncome > 0) {
    return `Your savings rate is ${snapshot.savingsRate.toFixed(1)}%. Aim for at least 20% if possible.`;
  }
  if (snapshot.dueSoonLoanCount > 0) {
    return `You have ${snapshot.dueSoonLoanCount} ${snapshot.dueSoonLoanCount === 1 ? 'loan' : 'loans'} due within 7 days.`;
  }
  if (snapshot.topExpenseCategory && snapshot.topExpenseAmount > 0) {
    return `Top expense this period is ${snapshot.topExpenseCategory} (${formatCurrency(snapshot.topExpenseAmount)}).`;
  }
  return 'Your financial activity looks steady. Keep tracking consistently.';
};

const generateReply = (
  input: string,
  snapshot: AssistantSnapshot,
  formatCurrency: (amount: number) => string
) => {
  const normalizedInput = input.toLowerCase();

  if (normalizedInput.includes('summary') || normalizedInput.includes('quick')) {
    return cleanText(
      `Income: ${formatCurrency(snapshot.totalIncome)}.
       Expenses: ${formatCurrency(snapshot.totalExpense)}.
       Balance: ${formatCurrency(snapshot.balance)}.
       Savings rate: ${snapshot.savingsRate.toFixed(1)}%.`
    );
  }

  if (normalizedInput.includes('budget')) {
    if (snapshot.overBudgetCount > 0) {
      return `You are currently over budget in ${snapshot.overBudgetCount} categories. Focus on those categories first this week.`;
    }
    return 'You are currently within budget on active budgets. Keep monitoring weekly to stay on track.';
  }

  if (normalizedInput.includes('spend') || normalizedInput.includes('category')) {
    if (!snapshot.topExpenseCategory) {
      return 'I need more expense data to identify top categories. Add a few expense transactions first.';
    }
    return `Your highest expense category is ${snapshot.topExpenseCategory} at ${formatCurrency(snapshot.topExpenseAmount)}.`;
  }

  if (normalizedInput.includes('save') || normalizedInput.includes('saving')) {
    if (snapshot.totalIncome <= 0) {
      return 'Add income transactions first, then I can suggest a personalized savings target.';
    }
    if (snapshot.savingsRate >= 20) {
      return `Great work. Your savings rate is ${snapshot.savingsRate.toFixed(1)}%, which is already strong.`;
    }
    return `Your savings rate is ${snapshot.savingsRate.toFixed(1)}%. Try reducing top discretionary expenses by 10-15%.`;
  }

  if (normalizedInput.includes('loan') || normalizedInput.includes('debt') || normalizedInput.includes('due')) {
    if (snapshot.dueSoonLoanCount > 0) {
      return `You have ${snapshot.dueSoonLoanCount} loan payments due within 7 days. Prioritize those to avoid penalties.`;
    }
    return 'No active loan due in the next 7 days based on your current records.';
  }

  if (normalizedInput.includes('hello') || normalizedInput.includes('hi') || normalizedInput.includes('hey')) {
    return `Hello. ${getProactiveTip(snapshot, formatCurrency)}`;
  }

  return cleanText(
    `I can help with summary, budget status, spending categories, savings, and debt reminders.
     Ask: "quick summary", "budget status", or "how can I save more?"`
  );
};

const createAssistantMessage = (content: string): LocalAssistantMessage => ({
  id: `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role: 'assistant',
  content,
});

const createUserMessage = (content: string): LocalAssistantMessage => ({
  id: `user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role: 'user',
  content,
});

export default function FinanceAssistantOverlay({ hidden = false }: FinanceAssistantOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { formatCurrency, assistantOverlay } = useAppSettings();
  const transactions = useSelector((state: RootState) => state.transactions.items);
  const budgets = useSelector((state: RootState) => state.budgets.items);
  const loans = useSelector((state: RootState) => state.loans.items);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [tipMuteLoaded, setTipMuteLoaded] = useState(false);
  const [tipMutedUntil, setTipMutedUntil] = useState(0);
  const [messages, setMessages] = useState<LocalAssistantMessage[]>([
    createAssistantMessage('Hello. I am your finance assistant. Ask for a summary, budget status, or savings tips.'),
  ]);
  const scrollRef = useRef<ScrollView>(null);

  const snapshot = useMemo(
    () => buildSnapshot(transactions, budgets, loans),
    [budgets, loans, transactions]
  );

  const proactiveTip = useMemo(
    () => getProactiveTip(snapshot, formatCurrency),
    [formatCurrency, snapshot]
  );

  useEffect(() => {
    let mounted = true;

    const loadMuteState = async () => {
      try {
        const raw = await AsyncStorage.getItem(TIP_MUTE_STORAGE_KEY);
        const parsed = raw ? Number(raw) : 0;
        if (!mounted) return;
        setTipMutedUntil(Number.isFinite(parsed) ? parsed : 0);
      } catch (error) {
        console.warn('Failed to load assistant tip mute state:', error);
      } finally {
        if (mounted) {
          setTipMuteLoaded(true);
        }
      }
    };

    void loadMuteState();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isSheetOpen) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 60);
    }
  }, [isSheetOpen, messages]);

  const isDashboardRoute = (
    pathname === '/' ||
    pathname === '/index' ||
    pathname === '/(tabs)' ||
    pathname === '/(tabs)/index'
  );
  const isTransactionsRoute = pathname === '/transactions' || pathname === '/(tabs)/transactions';
  const isReportsRoute = pathname === '/reports' || pathname === '/(tabs)/reports';
  const isAllowedRoute =
    (assistantOverlay.showOnDashboard && isDashboardRoute) ||
    (assistantOverlay.showOnTransactions && isTransactionsRoute) ||
    (assistantOverlay.showOnReports && isReportsRoute);

  const showOverlay = assistantOverlay.enabled && !hidden && isAllowedRoute;
  const isTipMuted = Date.now() < tipMutedUntil;
  const canShowTip = showOverlay && assistantOverlay.tipsEnabled && tipMuteLoaded && !isSheetOpen && proactiveTip.length > 0 && !isTipMuted;
  const bottomOffset = insets.bottom + 74;
  const sheetHeight = Math.max(
    360,
    Math.min(windowHeight - insets.top - 12, Math.floor(windowHeight * 0.86))
  );

  const muteTips = (durationMs: number) => {
    const mutedUntil = Date.now() + durationMs;
    setTipMutedUntil(mutedUntil);
    void AsyncStorage.setItem(TIP_MUTE_STORAGE_KEY, String(mutedUntil));
  };

  useEffect(() => {
    if (!showOverlay && isSheetOpen) {
      setIsSheetOpen(false);
    }
  }, [isSheetOpen, showOverlay]);

  const sendMessage = (rawText: string) => {
    const text = rawText.trim();
    if (!text || isTyping) {
      return;
    }

    const nextUserMessage = createUserMessage(text);
    setMessages((previous) => [...previous, nextUserMessage]);
    setInputText('');
    setIsTyping(true);

    setTimeout(() => {
      const reply = generateReply(text, snapshot, formatCurrency);
      setMessages((previous) => [...previous, createAssistantMessage(reply)]);
      setIsTyping(false);
    }, 300);
  };

  return (
    <>
      {canShowTip ? (
        <View
          className="absolute left-4 right-20 bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700"
          style={{ bottom: bottomOffset, elevation: 6, zIndex: 1400 }}
        >
          <View className="flex-row items-start">
            <View className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 items-center justify-center mr-2 mt-0.5">
              <FontAwesome name="lightbulb-o" size={15} color="#6366f1" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-semibold text-sm">AI Tip</Text>
              <Text className="text-slate-600 dark:text-slate-300 text-xs mt-0.5">{proactiveTip}</Text>
              <View className="flex-row mt-2">
                <TouchableOpacity
                  onPress={() => {
                    setIsSheetOpen(true);
                    muteTips(TIP_ASK_COOLDOWN_MS);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 mr-2"
                >
                  <Text className="text-white text-xs font-semibold">Ask</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => muteTips(TIP_DISMISS_COOLDOWN_MS)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700"
                >
                  <Text className="text-slate-700 dark:text-slate-200 text-xs font-semibold">Dismiss 24h</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {showOverlay ? (
        <TouchableOpacity
          onPress={() => setIsSheetOpen(true)}
          className="absolute w-14 h-14 rounded-full bg-indigo-600 items-center justify-center"
          style={{ right: 16, bottom: bottomOffset, elevation: 8, zIndex: 1401 }}
        >
          <FontAwesome name="comments" size={22} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <Modal
        visible={isSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsSheetOpen(false)}
      >
        <View className="flex-1 justify-end">
          <Pressable
            className="absolute inset-0 bg-black/40"
            onPress={() => setIsSheetOpen(false)}
          />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={insets.bottom}
          >
            <View
              className="bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-700 overflow-hidden"
              style={{ height: sheetHeight }}
            >
              <View className="items-center pt-2">
                <View className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              </View>

              <View className="px-5 pt-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1 pr-2">
                    <View className="w-9 h-9 rounded-xl bg-indigo-600 items-center justify-center mr-3">
                      <FontAwesome name="android" size={18} color="#fff" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold text-base">Finance Assistant</Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-xs">Free local guidance</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={() => router.push('/aiassistant' as any)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 mr-2"
                    >
                      <Text className="text-slate-700 dark:text-slate-200 text-xs font-semibold">Full AI</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setIsSheetOpen(false)} className="p-1">
                      <FontAwesome name="close" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <ScrollView
                  ref={scrollRef}
                  style={{ flex: 1 }}
                  className="px-4 py-3"
                  contentContainerStyle={{ paddingBottom: 16 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {messages.map((message) => (
                    <View
                      key={message.id}
                      className={`mb-3 ${message.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <View className={`${message.role === 'user' ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-800'} px-3 py-2.5 rounded-2xl max-w-[88%]`}>
                        <Text className={`${message.role === 'user' ? 'text-white' : 'text-slate-800 dark:text-slate-100'} text-sm`}>
                          {message.content}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {isTyping ? (
                    <View className="items-start mb-3">
                      <View className="bg-slate-100 dark:bg-slate-800 px-3 py-2.5 rounded-2xl flex-row items-center">
                        <ActivityIndicator size="small" color="#6366f1" />
                        <Text className="text-slate-600 dark:text-slate-300 text-sm ml-2">Thinking...</Text>
                      </View>
                    </View>
                  ) : null}

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-1">
                    <View className="flex-row pr-3">
                      {QUICK_PROMPTS.map((prompt) => (
                        <TouchableOpacity
                          key={prompt}
                          onPress={() => sendMessage(prompt)}
                          className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 mr-2 border border-slate-200 dark:border-slate-700"
                        >
                          <Text className="text-slate-700 dark:text-slate-200 text-xs font-medium">{prompt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </ScrollView>
              </View>

              <View className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <View className="flex-row items-center">
                  <TextInput
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder="Ask about budget, savings, debt..."
                    placeholderTextColor="#94a3b8"
                    className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-2xl px-4 py-3 mr-2"
                    multiline
                    maxLength={280}
                    onSubmitEditing={() => sendMessage(inputText)}
                  />
                  <TouchableOpacity
                    onPress={() => sendMessage(inputText)}
                    disabled={isTyping || !inputText.trim()}
                    className={`w-12 h-12 rounded-xl items-center justify-center ${isTyping || !inputText.trim() ? 'bg-slate-300 dark:bg-slate-700' : 'bg-indigo-600'}`}
                  >
                    <FontAwesome name="send" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}
