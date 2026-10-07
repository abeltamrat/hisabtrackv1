import { advanceDate } from '@/utils/finance';
import { sessionLocalStorage } from '@/services/SessionStorage';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { NotificationService } from '@/services/NotificationService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import { generateUUID } from '@/utils/uuid';
import ScreenInfoCard from '@/components/ScreenInfoCard';
import FloatingCalculator from '@/components/FloatingCalculator';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@/services/SessionStorage';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { createElement, useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';

import { useDispatch, useSelector } from 'react-redux';

import { RecurringFrequency, RecurringTransaction } from '@/types/database';
import { themeTokens } from '@/constants/theme';

type ViewMode = 'LIST' | 'CALENDAR';

// Shared bottom-sheet date/time picker for Android (avoids the display="default" double-fire bug)
const SpinnerPickerSheet = ({
  show, value, mode, label, onClose, onConfirm,
}: {
  show: boolean; value: Date; mode: 'date' | 'time'; label: string;
  onClose: () => void; onConfirm: (d: Date) => void;
}) => {
  const pendingRef = React.useRef<Date>(value);
  const isDark = useColorScheme() === 'dark';
  const theme = themeTokens(isDark);
  // Reset ref to current value whenever the sheet opens
  React.useEffect(() => { if (show) pendingRef.current = value; }, [show]);
  if (!show) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{label}</Text>
            <TouchableOpacity onPress={() => { onClose(); onConfirm(pendingRef.current); }}>
              <Text style={{ color: '#6366f1', fontWeight: '700', fontSize: 16 }}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={value}
            mode={mode}
            display="spinner"
            style={{ height: 200, alignSelf: 'center', width: '100%' }}
            onChange={(_, d) => { if (d) pendingRef.current = d; }}
          />
        </View>
      </View>
    </Modal>
  );
};

// --- Helper Components for Cross-Platform Pickers ---
const PlatformDatePicker = ({ value, onChange }: { value: Date, onChange: (date: Date) => void, placeholder?: string }) => {
  const [show, setShow] = useState(false);
  if (Platform.OS === 'web') {
    return (
      <View className="bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        {createElement('input', {
          type: 'date',
          value: value.toISOString().split('T')[0],
          onChange: (e: any) => e.target.value && onChange(new Date(e.target.value)),
          style: { padding: 16, backgroundColor: 'transparent', border: 'none', color: '#334155', fontSize: 16, width: '100%', fontFamily: 'inherit', outline: 'none' },
        })}
      </View>
    );
  }
  return (
    <View>
      <TouchableOpacity onPress={() => {
        if (Platform.OS === 'android') {
          DateTimePickerAndroid.open({
            value,
            mode: 'date',
            display: 'default',
            onChange: (event: any, selectedDate?: Date) => {
              if (event.type === 'set' && selectedDate) {
                onChange(selectedDate);
              }
            },
          });
        } else {
          setShow(true);
        }
      }} className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl flex-row items-center justify-between border border-slate-200 dark:border-slate-700">
        <Text className="text-slate-900 dark:text-white text-base">{value.toLocaleDateString()}</Text>
        <FontAwesome name="calendar" size={16} color="#64748b" />
      </TouchableOpacity>
      {Platform.OS === 'ios' && (
        <SpinnerPickerSheet show={show} value={value} mode="date" label="Select Date" onClose={() => setShow(false)} onConfirm={(d) => { setShow(false); onChange(d); }} />
      )}
    </View>
  );
};

const PlatformTimePicker = ({ value, onChange }: { value: Date, onChange: (date: Date) => void }) => {
  const [show, setShow] = useState(false);
  if (Platform.OS === 'web') {
    return (
      <View className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
        {createElement('input', {
          type: 'time',
          value: value.toTimeString().substring(0, 5),
          onChange: (e: any) => {
            if (e.target.value) {
              const [h, m] = e.target.value.split(':');
              const newDate = new Date(value);
              newDate.setHours(parseInt(h), parseInt(m));
              onChange(newDate);
            }
          },
          style: { padding: 16, backgroundColor: 'transparent', border: 'none', color: '#334155', fontSize: 16, width: '100%', fontFamily: 'inherit', outline: 'none' },
        })}
      </View>
    );
  }
  return (
    <View>
      <TouchableOpacity onPress={() => {
        if (Platform.OS === 'android') {
          DateTimePickerAndroid.open({
            value,
            mode: 'time',
            display: 'default',
            is24Hour: true,
            onChange: (event: any, selectedDate?: Date) => {
              if (event.type === 'set' && selectedDate) {
                onChange(selectedDate);
              }
            },
          });
        } else {
          setShow(true);
        }
      }} className="bg-white dark:bg-slate-800 p-4 rounded-xl flex-row items-center justify-between border border-slate-200 dark:border-slate-700">
        <Text className="text-slate-900 dark:text-white text-base font-semibold">{value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        <FontAwesome name="clock-o" size={16} color="#64748b" />
      </TouchableOpacity>
      {Platform.OS === 'ios' && (
        <SpinnerPickerSheet show={show} value={value} mode="time" label="Select Time" onClose={() => setShow(false)} onConfirm={(d) => { setShow(false); onChange(d); }} />
      )}
    </View>
  );
};


// --- Main Component ---

export default function RecurringTransactionsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const { categories } = useTransactions();
  const { formatCurrency } = useAppSettings();

  const [showAddModal, setShowAddModal] = useState(false);
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // View Mode
  const [viewMode, setViewMode] = useState<ViewMode>('LIST');
  // Edit filter state
  const [selectedFilterMonths, setSelectedFilterMonths] = useState<string[]>([]);


  // Form state
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'INCOME' | 'EXPENSE' | 'TRANSFER'>('EXPENSE');
  const [category, setCategory] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('MONTHLY');

  const [startDate, setStartDate] = useState(new Date());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState(new Date());

  const [hasRepetitions, setHasRepetitions] = useState(false);
  const [totalRepetitions, setTotalRepetitions] = useState('');
  const [description, setDescription] = useState('');

  const [selectedAccountId, setSelectedAccountId] = useState('');

  // Reminder State
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDaysBefore, setReminderDaysBefore] = useState('1');
  const [reminderTime, setReminderTime] = useState(new Date());

  useEffect(() => {
    void loadRecurringTransactions();
    NotificationService.requestPermissions();
    dispatch(fetchAccounts());
  }, []);

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId && !editingId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts]);

  useEffect(() => {
    if (!showAddModal || editingId) return;
    const filtered = categories.filter(c => c.type.toLowerCase() === type.toLowerCase());
    if (filtered.length > 0 && !filtered.find(c => c.name === category)) {
      setCategory(filtered[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddModal, type, categories]);

  // Calendar Projection Data
  const monthlyProjections = useMemo(() => {
    if (viewMode !== 'CALENDAR') return {};

    const limitDate = new Date();
    limitDate.setFullYear(limitDate.getFullYear() + 1); // 1 year out

    const grouped: Record<string, { totalIncome: number, totalExpense: number, items: any[] }> = {};

    recurringTransactions.forEach(t => {
      if (!t.isActive) return;

      let current = new Date(t.nextDate);
      let count = 0;

      while (current <= limitDate && count < 365) {
        if (t.endDate && current.getTime() > t.endDate) break;
        if (t.totalRepetitions) {
          if (t.completedRepetitions + count >= t.totalRepetitions) break;
        }

        const monthKey = current.toLocaleString('default', { month: 'long', year: 'numeric' });
        if (!grouped[monthKey]) {
          grouped[monthKey] = { totalIncome: 0, totalExpense: 0, items: [] };
        }

        grouped[monthKey].items.push({
          ...t,
          projectedDate: new Date(current),
        });

        if (t.type === 'INCOME') grouped[monthKey].totalIncome += t.amount;
        else if (t.type === 'EXPENSE') grouped[monthKey].totalExpense += t.amount;

        current = new Date(advanceDate(t.frequency, current.getTime(), t.startDate));
        count++;
      }
    });

    Object.keys(grouped).forEach(key => {
      grouped[key].items.sort((a, b) => a.projectedDate.getTime() - b.projectedDate.getTime());
    });

    return grouped;
  }, [recurringTransactions, viewMode]);

  // All available months (unfiltered)
  const allAvailableMonths = useMemo(() => {
    return Object.keys(monthlyProjections).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateA.getTime() - dateB.getTime();
    });
  }, [monthlyProjections]);

  // Sorted month keys for rendering (filtered)
  const filteredMonthKeys = useMemo(() => {
    let keys = [...allAvailableMonths];
    if (selectedFilterMonths.length > 0) {
      keys = keys.filter(k => selectedFilterMonths.includes(k));
    }
    return keys;
  }, [allAvailableMonths, selectedFilterMonths]);

  const monthlySummary = useMemo(() => {
    const monthlyFactor: Record<RecurringFrequency, number> = {
      DAILY: 30.4375,
      WEEKLY: 52 / 12,
      MONTHLY: 1,
      YEARLY: 1 / 12,
    };
    return recurringTransactions.reduce((summary, item) => {
      if (!item.isActive) return summary;
      const monthlyAmount = item.amount * monthlyFactor[item.frequency];
      if (item.type === 'INCOME') summary.income += monthlyAmount;
      else summary.expense += monthlyAmount;
      summary.activeCount += 1;
      if (!summary.nextDate || item.nextDate < summary.nextDate) summary.nextDate = item.nextDate;
      return summary;
    }, { income: 0, expense: 0, activeCount: 0, nextDate: 0 });
  }, [recurringTransactions]);

  const toggleMonthFilter = (month: string) => {
    setSelectedFilterMonths(prev => {
      if (prev.includes(month)) {
        return prev.filter(m => m !== month);
      } else {
        return [...prev, month];
      }
    });
  };

  const loadRecurringTransactions = async () => {
    try {
      let loaded: RecurringTransaction[] = [];
      if (Platform.OS === 'web') {
        const stored = sessionLocalStorage.getItem('recurring_transactions');
        if (stored) loaded = JSON.parse(stored);
      } else {
        const stored = await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
        if (stored) loaded = JSON.parse(stored);
      }
      setRecurringTransactions(loaded);
      // Fix #4: catch up any periods missed while the app was closed
      await processOverdueRecurring(loaded);
    } catch (error) {
      console.error('Error loading recurring transactions:', error);
    }
  };

  const saveRecurringTransactions = async (transactions: RecurringTransaction[]) => {
    try {
      if (Platform.OS === 'web') {
        sessionLocalStorage.setItem('recurring_transactions', JSON.stringify(transactions));
      } else {
        await AsyncStorage.setItem('@hisabtrack_recurring_transactions', JSON.stringify(transactions));
      }
      setRecurringTransactions(transactions);
      try { (await import('@/services/LocalChangeEmitter')).default.emit(); } catch (e) { /* ignore */ }
    } catch (error) {
      console.error('Error saving recurring transactions:', error);
      throw error;
    }
  };

  /**
   * Fix #4: Catch-up processor for overdue recurring transactions.
   *
   * On each app open, checks every active recurring transaction.
   * If its nextDate is in the past, creates one transaction per missed interval
   * (capped at MAX_CATCH_UP to guard against runaway loops), then advances
   * nextDate so it falls in the future again.
   */
  const processOverdueRecurring = async (items: RecurringTransaction[]) => {
    const MAX_CATCH_UP = 12;
    const now = Date.now();
    let anyUpdated = false;

    let dbTransactions: any[] = [];
    try {
      const { getDatabase } = await import('@/services/database');
      const db = await getDatabase();
      dbTransactions = await db.getTransactions();
    } catch (dbErr) {
      console.warn('[Recurring catch-up] Failed to load database transactions for duplicate checking:', dbErr);
    }

    const updated = await Promise.all(
      items.map(async (rt) => {
        if (!rt.isActive || rt.nextDate > now) return rt;

        let current = { ...rt };
        let catchUpCount = 0;

        while (current.nextDate <= now && catchUpCount < MAX_CATCH_UP) {
          if (current.endDate && current.nextDate > current.endDate) break;
          if (current.totalRepetitions && current.completedRepetitions >= current.totalRepetitions) {
            current = { ...current, isActive: false };
            break;
          }

          const operationId = `recurring-${current.id}-${current.nextDate}`;
          const isDuplicate = dbTransactions.some(tx => tx.operation_id === operationId);
          if (current.type === 'TRANSFER' && !current.toAccountId) return current;
          if (!isDuplicate) {
            try {
              if (current.type === 'TRANSFER' && current.toAccountId) {
                await dispatch(addTransaction({
                  account_id: current.accountId,
                  operation_id: operationId,
                  to_account_id: current.toAccountId,
                  type: 'TRANSFER',
                  amount: current.amount,
                  fees: current.fees,
                  tax: current.tax,
                  category: current.category,
                  tags: current.tags,
                  description: `${current.name} (Recurring - catch-up)`,
                  splits: current.splits,
                  date: current.nextDate,
                })).unwrap();
              } else if (current.type !== 'TRANSFER') {
                await dispatch(addTransaction({
                  account_id: current.accountId,
                  operation_id: operationId,
                  type: current.type,
                  amount: current.amount,
                  category: current.category,
                  tags: current.tags,
                  description: `${current.name} (Recurring - catch-up)`,
                  splits: current.splits,
                  date: current.nextDate,
                })).unwrap();
              }
            } catch (err) {
              console.warn('[Recurring catch-up] Failed to create transaction:', err);
              return current;
            }
          } else {
          }

          current = {
            ...current,
            nextDate: advanceDate(current.frequency, current.nextDate, current.startDate),
            completedRepetitions: current.completedRepetitions + 1,
          };
          catchUpCount++;
          anyUpdated = true;
        }

        return current;
      })
    );

    if (anyUpdated) {
      const raw = JSON.stringify(updated);
      if (Platform.OS === 'web') {
        sessionLocalStorage.setItem('recurring_transactions', raw);
      } else {
        await AsyncStorage.setItem('@hisabtrack_recurring_transactions', raw);
      }
      setRecurringTransactions(updated);
      dispatch(fetchAccounts());
      dispatch(fetchTransactions());
    }
  };

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim() || !amount) {
      setFormError('Please fill in name and amount');
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Amount must be a valid number greater than zero');
      return;
    }
    if (!selectedAccountId) {
      setFormError('Please select an account');
      return;
    }

    const transactionData: RecurringTransaction = {
      id: editingId || generateUUID(),
      name: name.trim(),
      amount: parseFloat(amount),
      type,
      category,
      frequency,
      startDate: startDate.getTime(),
      endDate: hasEndDate ? endDate.getTime() : undefined,
      nextDate: editingId ? (recurringTransactions.find(t => t.id === editingId)?.nextDate || startDate.getTime()) : startDate.getTime(),
      isActive: true,
      accountId: selectedAccountId,
      description: description.trim() || undefined,
      totalRepetitions: hasRepetitions && totalRepetitions ? parseInt(totalRepetitions) : undefined,
      completedRepetitions: editingId ? (recurringTransactions.find(t => t.id === editingId)?.completedRepetitions || 0) : 0,
      reminderEnabled,
      reminderDaysBefore: parseInt(reminderDaysBefore) || 1,
      reminderTime: reminderEnabled ? reminderTime.getTime() : undefined,
    };

    const scheduleNotification = async (data: RecurringTransaction) => {
      if (data.reminderEnabled) {
        const nextDue = new Date(data.nextDate);
        nextDue.setDate(nextDue.getDate() - data.reminderDaysBefore);
        const rTime = data.reminderTime ? new Date(data.reminderTime) : new Date();
        nextDue.setHours(rTime.getHours(), rTime.getMinutes(), 0, 0);

        // Ensure we don't schedule in the past
        if (nextDue.getTime() <= Date.now()) {
          return undefined;
        }

        return await NotificationService.scheduleOneTimeReminder(
          `💰 ${data.type === 'INCOME' ? 'Income' : 'Expense'} Reminder`,
          `[${data.category}] ${data.name}: ${data.type === 'INCOME' ? '+' : '-'}${formatCurrency(data.amount)} due soon`,
          nextDue,
          { recurringId: data.id }
        );
      }
      return undefined;
    };

    if (editingId) {
      const old = recurringTransactions.find(t => t.id === editingId);
      await Promise.all([...new Set([...(old?.notificationIds || []), ...(old?.notificationId ? [old.notificationId] : [])])].map(id => NotificationService.cancelNotification(id)));
    }

    const notifId = await scheduleNotification(transactionData);
    transactionData.notificationId = notifId || undefined;

    let updatedTransactions;
    if (editingId) {
      updatedTransactions = recurringTransactions.map(t => t.id === editingId ? transactionData : t);
    } else {
      updatedTransactions = [...recurringTransactions, transactionData];
    }

    try {
      await saveRecurringTransactions(updatedTransactions);
    } catch {
      Alert.alert('Error', 'Failed to save recurring transaction.');
      return;
    }

    setShowAddModal(false);
    resetForm();
    Alert.alert('Success', editingId ? 'Recurring transaction updated!' : 'Recurring transaction added!');
  };

  const handleEdit = (recurring: RecurringTransaction) => {
    setEditingId(recurring.id);
    setName(recurring.name);
    setAmount(recurring.amount.toString());
    setType(recurring.type);
    setFrequency(recurring.frequency);
    setCategory(recurring.category);
    setStartDate(new Date(recurring.startDate));
    setHasEndDate(!!recurring.endDate);
    setEndDate(recurring.endDate ? new Date(recurring.endDate) : new Date());
    setHasRepetitions(!!recurring.totalRepetitions);
    setTotalRepetitions(recurring.totalRepetitions ? recurring.totalRepetitions.toString() : '');
    setDescription(recurring.description || '');
    setSelectedAccountId(recurring.accountId);
    setReminderEnabled(recurring.reminderEnabled);
    setReminderDaysBefore(recurring.reminderDaysBefore.toString());
    if (recurring.reminderTime) {
      setReminderTime(new Date(recurring.reminderTime));
    }
    setShowAddModal(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setAmount('');
    setCategory('');
    setDescription('');
    setStartDate(new Date());
    setEndDate(new Date());
    setTotalRepetitions('');
    setHasEndDate(false);
    setHasRepetitions(false);
    setReminderTime(new Date());
    setFormError(null);
    if (accounts.length > 0) setSelectedAccountId(accounts[0].id);
  };

  const handleToggleActive = async (id: string) => {
    const updated = recurringTransactions.map(rt =>
      rt.id === id ? { ...rt, isActive: !rt.isActive } : rt
    );
    await saveRecurringTransactions(updated);
  };

  const handleDelete = (id: string) => {
    const doDelete = async () => {
      const deleted = recurringTransactions.find(rt => rt.id === id);
      await Promise.all([...new Set([...(deleted?.notificationIds || []), ...(deleted?.notificationId ? [deleted.notificationId] : [])])].map(notificationId => NotificationService.cancelNotification(notificationId)));
      const updated = recurringTransactions.filter(rt => rt.id !== id);
      await saveRecurringTransactions(updated);
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to delete this recurring transaction?')) {
        void doDelete();
      }
    } else {
      Alert.alert(
        'Delete Recurring Transaction',
        'Are you sure you want to delete this recurring transaction?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { void doDelete(); } },
        ]
      );
    }
  };

  const handleExecuteNow = async (recurring: RecurringTransaction) => {
    try {
      const txResult = await dispatch(addTransaction({
        account_id: recurring.accountId,
        to_account_id: recurring.toAccountId,
        operation_id: `recurring-${recurring.id}-${recurring.nextDate}`,
        type: recurring.type,
        amount: recurring.amount,
        fees: recurring.fees,
        tax: recurring.tax,
        category: recurring.category,
        description: `${recurring.name} (Recurring)`,
        splits: recurring.splits,
        date: Date.now(),
      }));
      if (addTransaction.rejected.match(txResult)) {
        Alert.alert('Error', 'Failed to create transaction');
        return;
      }

      const updated = await Promise.all(recurringTransactions.map(async rt => {
        if (rt.id === recurring.id) {
          const nextDate = advanceDate(recurring.frequency, rt.nextDate, rt.startDate);
          const completedRepetitions = rt.completedRepetitions + 1;
          const updatedRt = { ...rt, nextDate, completedRepetitions, isActive: (!rt.totalRepetitions || completedRepetitions < rt.totalRepetitions) && (!rt.endDate || nextDate <= rt.endDate) };

          // Reschedule notification for the next date
          if (updatedRt.notificationId) {
            await NotificationService.cancelNotification(updatedRt.notificationId);
          }

          // Reuse the logic from handleSave (we can extract this if needed, but for now let's keep it simple)
          if (updatedRt.reminderEnabled) {
            const nextDue = new Date(updatedRt.nextDate);
            nextDue.setDate(nextDue.getDate() - updatedRt.reminderDaysBefore);
            const rTime = updatedRt.reminderTime ? new Date(updatedRt.reminderTime) : new Date();
            nextDue.setHours(rTime.getHours(), rTime.getMinutes(), 0, 0);

            if (nextDue.getTime() > Date.now()) {
              const nid = await NotificationService.scheduleOneTimeReminder(
                `💰 ${updatedRt.type === 'INCOME' ? 'Income' : 'Expense'} Reminder`,
                `[${updatedRt.category}] ${updatedRt.name}: ${updatedRt.type === 'INCOME' ? '+' : '-'}${formatCurrency(updatedRt.amount)} due soon`,
                nextDue,
                { recurringId: updatedRt.id }
              );
              updatedRt.notificationId = nid || undefined;
            } else {
              updatedRt.notificationId = undefined;
            }
          }

          return updatedRt;
        }
        return rt;
      }));
      await saveRecurringTransactions(updated);

      Alert.alert('Success', 'Transaction created!');

      dispatch(fetchTransactions());
    } catch (error) {
      Alert.alert('Error', 'Failed to create transaction');
    }
  };

  const getFrequencyIcon = (freq: RecurringFrequency) => {
    switch (freq) {
      case 'DAILY': return 'calendar';
      case 'WEEKLY': return 'calendar-o';
      case 'MONTHLY': return 'calendar-check-o';
      case 'YEARLY': return 'calendar-plus-o';
      default: return 'calendar';
    }
  };

  const frequencies: RecurringFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient colors={['#9333ea', '#7e22ce']} className="px-6 pt-6 pb-2 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Recurring Transactions</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add"
            onPress={() => { resetForm(); setShowAddModal(true); }}
            className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
          >
            <FontAwesome name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <View className="flex-row bg-white/10 p-1 rounded-xl mb-6">
          <TouchableOpacity
            onPress={() => setViewMode('LIST')}
            className={`flex-1 py-2 rounded-lg ${viewMode === 'LIST' ? 'bg-white' : ''}`}
          >
            <Text className={`text-center font-bold ${viewMode === 'LIST' ? 'text-purple-700' : 'text-white'}`}>Active List</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setViewMode('CALENDAR')}
            className={`flex-1 py-2 rounded-lg ${viewMode === 'CALENDAR' ? 'bg-white' : ''}`}
          >
            <Text className={`text-center font-bold ${viewMode === 'CALENDAR' ? 'text-purple-700' : 'text-white'}`}>Monthly View</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 mt-4" showsVerticalScrollIndicator={false}>

        {recurringTransactions.length === 0 ? (
          <ScreenInfoCard
            icon="repeat"
            title="Make regular money movements easier"
            description="Recurring transactions automatically remind you about income, bills, subscriptions, and transfers that happen on a schedule."
            suggestions={[
              'Add rent, salary, subscriptions, or regular family support payments.',
              'Choose a frequency and next date so the app can project upcoming months.',
              'Use Execute Now when a scheduled transaction happens earlier than planned.',
            ]}
          />
        ) : (
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-5 shadow-lg border border-slate-100 dark:border-slate-700">
            <View className="flex-row items-center justify-between mb-4">
              <View>
                <Text className="text-slate-900 dark:text-white font-bold text-lg">Monthly outlook</Text>
                <Text className="text-slate-500 dark:text-slate-400 text-xs mt-1">Based on {monthlySummary.activeCount} active recurring item{monthlySummary.activeCount === 1 ? '' : 's'}</Text>
              </View>
              <FontAwesome name="line-chart" size={20} color="#6366f1" />
            </View>
            <View className="flex-row">
              <View className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-2xl p-3 mr-2">
                <Text className="text-red-600 dark:text-red-300 text-xs">Expected out</Text>
                <Text className="text-red-700 dark:text-red-200 font-bold mt-1">{formatCurrency(monthlySummary.expense)}</Text>
              </View>
              <View className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl p-3 mr-2">
                <Text className="text-emerald-600 dark:text-emerald-300 text-xs">Expected in</Text>
                <Text className="text-emerald-700 dark:text-emerald-200 font-bold mt-1">{formatCurrency(monthlySummary.income)}</Text>
              </View>
              <View className="flex-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl p-3">
                <Text className="text-indigo-600 dark:text-indigo-300 text-xs">Net / month</Text>
                <Text className={`font-bold mt-1 ${monthlySummary.income - monthlySummary.expense >= 0 ? 'text-indigo-700 dark:text-indigo-200' : 'text-rose-600 dark:text-rose-300'}`}>{formatCurrency(monthlySummary.income - monthlySummary.expense)}</Text>
              </View>
            </View>
            {monthlySummary.nextDate > 0 && (
              <Text className="text-slate-500 dark:text-slate-400 text-xs mt-4">Next scheduled item: {new Date(monthlySummary.nextDate).toLocaleDateString()}</Text>
            )}
          </View>
        )}

        {viewMode === 'LIST' ? (
          <>
            {recurringTransactions.length === 0 ? (
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-8 items-center shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
                <FontAwesome name="repeat" size={48} color="#cbd5e1" />
                <Text className="text-slate-500 text-center mt-4 mb-2 dark:text-slate-400">No active recurring transactions</Text>
              </View>
            ) : (
              recurringTransactions.map((recurring) => (
                <View
                  key={recurring.id}
                  className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700"
                  style={{ elevation: 4 }}
                >
                  <View className="flex-row items-center mb-4">
                    <View
                      className={`w-12 h-12 rounded-2xl justify-center items-center mr-4 ${recurring.type === 'INCOME' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30' }`}
                    >
                      <FontAwesome
                        name={getFrequencyIcon(recurring.frequency)}
                        size={20}
                        color={recurring.type === 'INCOME' ? '#10b981' : '#ef4444'}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold text-lg">
                        {recurring.name}
                      </Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-sm">{recurring.category}</Text>
                    </View>
                    <View className="items-end">
                      <View className="flex-row gap-2 mb-1">
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit" onPress={() => handleEdit(recurring)} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                          <FontAwesome name="pencil" size={12} color="#3b82f6" />
                        </TouchableOpacity>
                      </View>
                      <Text
                        className={`font-bold text-xl ${recurring.type === 'INCOME' ? 'text-green-600' : 'text-red-600' }`}
                      >
                        {recurring.type === 'INCOME' ? '+' : '-'}{formatCurrency(recurring.amount)}
                      </Text>
                      <Text className="text-slate-500 dark:text-slate-400 text-xs">{recurring.frequency}</Text>
                    </View>
                  </View>

                  <View className="border-t border-slate-100 dark:border-slate-700 pt-4">
                    <View className="flex-row items-center mb-3">
                      <FontAwesome name="calendar" size={14} color="#64748b" />
                      <Text className="text-slate-500 dark:text-slate-400 text-sm ml-2">
                        Next: {new Date(recurring.nextDate).toLocaleDateString()}
                      </Text>
                    </View>

                    <View className="flex-row gap-2">
                      <TouchableOpacity
                        onPress={() => handleToggleActive(recurring.id)}
                        className={`flex-1 py-3 rounded-xl ${recurring.isActive ? 'bg-slate-100 dark:bg-slate-700' : 'bg-green-100 dark:bg-green-900/30' }`}
                      >
                        <Text
                          className={`text-center font-semibold ${recurring.isActive ? 'text-slate-600' : 'text-green-600' }`}
                        >
                          {recurring.isActive ? 'Pause' : 'Resume'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleExecuteNow(recurring)}
                        className="flex-1 bg-purple-100 dark:bg-purple-900/30 py-3 rounded-xl"
                      >
                        <Text className="text-purple-600 text-center font-semibold">Execute Now</Text>
                      </TouchableOpacity>

                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete"
                        onPress={() => handleDelete(recurring.id)}
                        className="bg-red-100 dark:bg-red-900/30 px-4 py-3 rounded-xl"
                      >
                        <FontAwesome name="trash" size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))
            )}
          </>
        ) : (
          // Calendar/Monthly View
          <View>
            {allAvailableMonths.length > 0 && (
              <View className="mb-4">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setSelectedFilterMonths([])}
                    className={`px-4 py-2 rounded-full border ${selectedFilterMonths.length === 0 ? 'bg-purple-600 border-purple-600' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={selectedFilterMonths.length === 0 ? 'text-white font-bold' : 'text-slate-600'}>All</Text>
                  </TouchableOpacity>

                  {allAvailableMonths.map(month => (
                    <TouchableOpacity
                      key={month}
                      onPress={() => toggleMonthFilter(month)}
                      className={`px-4 py-2 rounded-full border ${selectedFilterMonths.includes(month) ? 'bg-purple-600 border-purple-600' : 'bg-white border-slate-200'} ml-2`}
                    >
                      <Text className={selectedFilterMonths.includes(month) ? 'text-white font-bold' : 'text-slate-600'}>{month}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {filteredMonthKeys.length === 0 ? (
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-8 items-center">
                <Text className="text-slate-500 dark:text-slate-400">No upcoming recurring projections found.</Text>
              </View>
            ) : (
              filteredMonthKeys.map(month => (
                <View key={month} className="mb-6">
                  <View className="flex-row justify-between items-end mb-3 px-2">
                    <Text className="text-slate-600 dark:text-slate-300 font-bold text-lg uppercase">{month}</Text>
                    <View>
                      {monthlyProjections[month].totalExpense > 0 && <Text className="text-red-500 text-xs font-bold text-right">EXP: {formatCurrency(monthlyProjections[month].totalExpense)}</Text>}
                      {monthlyProjections[month].totalIncome > 0 && <Text className="text-green-500 text-xs font-bold text-right">INC: {formatCurrency(monthlyProjections[month].totalIncome)}</Text>}
                    </View>
                  </View>

                  {monthlyProjections[month].items.map((item: any, idx: number) => (
                    <View key={idx} className="bg-white dark:bg-slate-800 p-4 rounded-xl mb-2 flex-row items-center justify-between border border-slate-100 dark:border-slate-700">
                      <View className="flex-row items-center">
                        <View className={`w-10 h-10 rounded-full justify-center items-center mr-3 ${item.type === 'INCOME' ? 'bg-green-100' : 'bg-red-100'}`}>
                          <Text className={`font-bold text-xs ${item.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}`}>
                            {item.projectedDate.getDate()}
                          </Text>
                        </View>
                        <View>
                          <Text className="text-slate-900 dark:text-white font-bold">{item.name}</Text>
                          <Text className="text-slate-500 dark:text-slate-400 text-xs">{item.category}</Text>
                        </View>
                      </View>
                      <Text className={`font-bold ${item.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(item.amount)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        )}

        <View className="h-8" />
      </ScrollView>

      {/* Add Modal */}
      <FormSheet
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        variant="center"
        cardClassName="max-w-md shadow-2xl dark:bg-slate-800"
        scrollable={false}
        accessibilityLabel={editingId ? 'Edit recurring transaction' : 'New recurring transaction'}
      >
            <View className="flex-row justify-between items-center px-6 pt-6 pb-4">
              <Text className="text-slate-900 dark:text-white text-xl font-bold">
                {editingId ? 'Edit Recurring' : 'New Recurring'}
              </Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setShowAddModal(false)}>
                <FontAwesome name="times" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              className="px-6"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {/* Error Message */}
              {formError && (
                <View className="bg-red-50 dark:bg-red-900/20 p-3 rounded-xl mb-4 border border-red-200 dark:border-red-800">
                  <Text className="text-red-600 dark:text-red-400 font-semibold text-center">{formError}</Text>
                </View>
              )}

              {/* Account Selection */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Affected Account</Text>
                {accounts && accounts.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-3">
                    {accounts.map((acc: any) => (
                      <TouchableOpacity
                        key={acc.id}
                        onPress={() => setSelectedAccountId(acc.id)}
                        className={`px-4 py-3 rounded-xl border-2 ${selectedAccountId === acc.id ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
                      >
                        <Text className={selectedAccountId === acc.id ? 'text-indigo-600 font-bold' : 'text-slate-600'}>
                          {acc.name}
                        </Text>
                        <Text className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(acc.balance)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl border border-yellow-200 dark:border-yellow-700">
                    <Text className="text-yellow-700 dark:text-yellow-400 text-sm">No accounts found. Please create an account in the Accounts tab (Home) first.</Text>
                  </View>
                )}
              </View>

              {/* Name */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Name</Text>
                <TextInput
                  className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                  placeholder="e.g. Netflix Subscription"
                  placeholderTextColor="#94a3b8"
                  value={name}
                  onChangeText={setName}
                />
              </View>

              {/* Amount */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Amount</Text>
                <TextInput
                  className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                  placeholder="0.00"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                />
              </View>

              {/* Type */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Type</Text>
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setType('EXPENSE')}
                    className={`flex-1 py-3 rounded-xl border-2 ${type === 'EXPENSE' ? 'bg-red-50 dark:bg-red-900/20 border-red-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
                  >
                    <Text
                      className={`text-center font-semibold ${type === 'EXPENSE' ? 'text-red-600' : 'text-slate-600' }`}
                    >
                      Expense
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setType('INCOME')}
                    className={`flex-1 py-3 rounded-xl border-2 ${type === 'INCOME' ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
                  >
                    <Text
                      className={`text-center font-semibold ${type === 'INCOME' ? 'text-green-600' : 'text-slate-600' }`}
                    >
                      Income
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Selection */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Category</Text>
                <ScrollView showsVerticalScrollIndicator={false} className="max-h-40" nestedScrollEnabled={true}>
                  {(() => {
                    const filteredCategories = categories.filter(c => c.type.toLowerCase() === type.toLowerCase());
                    const rootCategories = filteredCategories.filter(c => !c.parentId);
                    const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

                    return rootCategories.map((cat) => (
                      <View key={cat.id} className="mb-2">
                        {/* Parent Category */}
                        <TouchableOpacity
                          className={`w-full items-center p-3 rounded-xl border-2 ${category === cat.name ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
                          onPress={() => setCategory(cat.name)}
                        >
                          <View className="flex-row items-center w-full">
                            <View
                              className="w-8 h-8 rounded-xl justify-center items-center mr-3"
                              style={{ backgroundColor: cat.color + '20' }}
                            >
                              <FontAwesome name={cat.icon as any} size={16} color={cat.color} />
                            </View>
                            <View className="flex-1">
                              <Text className="text-slate-900 dark:text-white text-sm font-semibold text-left">
                                {cat.name}
                              </Text>
                            </View>
                            {category === cat.name && (
                              <FontAwesome name="check" size={14} color="#9333ea" />
                            )}
                          </View>
                        </TouchableOpacity>

                        {/* Child Categories */}
                        {getChildCategories(cat.id).map((childCat) => (
                          <TouchableOpacity
                            key={childCat.id}
                            className={`w-full items-center p-2 rounded-lg ml-6 mt-1 border-2 ${category === childCat.name ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500' : 'bg-slate-100 dark:bg-slate-700 border-transparent' }`}
                            onPress={() => setCategory(childCat.name)}
                          >
                            <View className="flex-row items-center w-full">
                              <View className="w-1 h-3 bg-slate-300 dark:bg-slate-600 mr-2 rounded-full" />
                              <View
                                className="w-6 h-6 rounded-lg justify-center items-center mr-3"
                                style={{ backgroundColor: childCat.color + '20' }}
                              >
                                <FontAwesome name={childCat.icon as any} size={12} color={childCat.color} />
                              </View>
                              <View className="flex-1">
                                <Text className="text-slate-700 dark:text-slate-300 text-xs font-medium text-left">
                                  {childCat.name}
                                </Text>
                              </View>
                              {category === childCat.name && (
                                <FontAwesome name="check" size={10} color="#9333ea" />
                              )}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ));
                  })()}
                </ScrollView>
              </View>

              {/* Frequency */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Frequency</Text>
                <View className="flex-row flex-wrap gap-2">
                  {frequencies.map((freq) => (
                    <TouchableOpacity
                      key={freq}
                      onPress={() => setFrequency(freq)}
                      className={`px-4 py-3 rounded-xl border-2 ${frequency === freq ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500' : 'bg-slate-50 dark:bg-slate-900 border-transparent' }`}
                    >
                      <Text
                        className={`font-semibold ${frequency === freq ? 'text-purple-600' : 'text-slate-600' }`}
                      >
                        {freq}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Start Date */}
              <View className="mb-4">
                <Text className="text-slate-500 dark:text-slate-400 text-sm font-bold mb-2">Start Date</Text>
                {/* Use the helper component */}
                <PlatformDatePicker
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Select Start Date"
                />
              </View>

              {/* End Date Option */}
              <View className="mb-4">
                <TouchableOpacity
                  onPress={() => setHasEndDate(!hasEndDate)}
                  className="flex-row items-center mb-2"
                >
                  <View className={`w-6 h-6 rounded border-2 mr-3 justify-center items-center ${hasEndDate ? 'bg-purple-500 border-purple-500' : 'border-slate-300' }`}>
                    {hasEndDate && <FontAwesome name="check" size={14} color="#fff" />}
                  </View>
                  <Text className="text-slate-700 dark:text-slate-300 font-semibold">Set End Date</Text>
                </TouchableOpacity>
                {hasEndDate && (
                  <PlatformDatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="Select End Date"
                  />
                )}
              </View>

              {/* Reminder Settings */}
              <View className="mb-6 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-800">
                <TouchableOpacity
                  onPress={() => setReminderEnabled(!reminderEnabled)}
                  className="flex-row items-center mb-3"
                >
                  <View className={`w-6 h-6 rounded border-2 mr-3 justify-center items-center ${reminderEnabled ? 'bg-blue-500 border-blue-500' : 'border-slate-300' }`}>
                    {reminderEnabled && <FontAwesome name="check" size={14} color="#fff" />}
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold">🔔 Enable Reminders</Text>
                    <Text className="text-slate-500 dark:text-slate-400 text-xs">Get notified before payment is due</Text>
                  </View>
                </TouchableOpacity>

                {reminderEnabled && (
                  <View>
                    <Text className="text-slate-600 dark:text-slate-400 text-sm font-semibold mb-2">
                      Remind me (days before)
                    </Text>
                    <View className="flex-row gap-2 mb-4">
                      {['0', '1', '2', '3'].map((days) => (
                        <TouchableOpacity
                          key={days}
                          onPress={() => setReminderDaysBefore(days)}
                          className={`flex-1 py-3 rounded-xl border-2 ${reminderDaysBefore === days ? 'bg-blue-500 border-blue-500' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' }`}
                        >
                          <Text
                            className={`text-center font-semibold ${reminderDaysBefore === days ? 'text-white' : 'text-slate-600 dark:text-slate-400' }`}
                          >
                            {days === '0' ? 'Same Day' : `${days}d`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text className="text-slate-600 dark:text-slate-400 text-sm font-semibold mb-2">
                      Notification Time
                    </Text>
                    <PlatformTimePicker
                      value={reminderTime}
                      onChange={setReminderTime}
                    />
                  </View>
                )}
              </View>

              {/* Buttons */}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowAddModal(false)}
                  className="flex-1 bg-slate-100 dark:bg-slate-700 h-12 rounded-xl justify-center items-center"
                >
                  <Text className="text-slate-700 dark:text-slate-300 font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  className="flex-1 bg-purple-500 h-12 rounded-xl justify-center items-center"
                >
                  <Text className="text-white font-bold">
                    {editingId ? 'Save Changes' : 'Add'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
            <FloatingCalculator onUseAmount={setAmount} />
      </FormSheet>
    </View>
  );
}
