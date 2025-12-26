import { useTransactions } from '@/context/TransactionContext';
import { NotificationService } from '@/services/NotificationService';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import { generateUUID } from '@/utils/uuid';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { createElement, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

import { RecurringFrequency, RecurringTransaction } from '@/types/database';

type ViewMode = 'LIST' | 'CALENDAR';

// --- Helper Components for Cross-Platform Pickers ---
const PlatformDatePicker = ({ value, onChange, placeholder }: { value: Date, onChange: (date: Date) => void, placeholder: string }) => {
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
      <TouchableOpacity onPress={() => setShow(true)} className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl flex-row items-center justify-between border border-slate-200 dark:border-slate-700">
        <Text className="text-slate-900 dark:text-white text-base">{value.toLocaleDateString()}</Text>
        <FontAwesome name="calendar" size={16} color="#64748b" />
      </TouchableOpacity>
      {show && <DateTimePicker value={value} mode="date" display="default" onChange={(event, selectedDate) => { setShow(false); if (selectedDate) onChange(selectedDate); }} />}
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
      <TouchableOpacity onPress={() => setShow(true)} className="bg-white dark:bg-slate-800 p-4 rounded-xl flex-row items-center justify-between border border-slate-200 dark:border-slate-700">
        <Text className="text-slate-900 dark:text-white text-base font-semibold">{value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        <FontAwesome name="clock-o" size={16} color="#64748b" />
      </TouchableOpacity>
      {show && <DateTimePicker value={value} mode="time" display="default" onChange={(event, selectedDate) => { setShow(false); if (selectedDate) onChange(selectedDate); }} />}
    </View>
  );
};

// --- Main Component ---

export default function RecurringTransactionsScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  // @ts-ignore
  const { items: accounts } = useSelector((state: any) => state.accounts);
  const { categories } = useTransactions();

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
  const [type, setType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [category, setCategory] = useState('Food & Dining');
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
    // @ts-ignore
    dispatch(fetchAccounts());
  }, []);

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId && !editingId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts]);

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
        else grouped[monthKey].totalExpense += t.amount;

        switch (t.frequency) {
          case 'DAILY': current.setDate(current.getDate() + 1); break;
          case 'WEEKLY': current.setDate(current.getDate() + 7); break;
          case 'MONTHLY': current.setMonth(current.getMonth() + 1); break;
          case 'YEARLY': current.setFullYear(current.getFullYear() + 1); break;
        }
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
      if (Platform.OS === 'web') {
        const stored = localStorage.getItem('recurring_transactions');
        if (stored) setRecurringTransactions(JSON.parse(stored));
      } else {
        const stored = await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
        if (stored) setRecurringTransactions(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading recurring transactions:', error);
    }
  };

  const saveRecurringTransactions = async (transactions: RecurringTransaction[]) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem('recurring_transactions', JSON.stringify(transactions));
      } else {
        await AsyncStorage.setItem('@hisabtrack_recurring_transactions', JSON.stringify(transactions));
      }
      setRecurringTransactions(transactions);
      try { (await import('@/services/LocalChangeEmitter')).default.emit(); } catch (e) { /* ignore */ }
    } catch (error) {
      console.error('Error saving recurring transactions:', error);
    }
  };

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim() || !amount) {
      setFormError('Please fill in name and amount');
      return;
    }
    if (isNaN(parseFloat(amount))) {
      setFormError('Amount must be a valid number');
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
          console.log('Notification date is in the past, skipping scheduling');
          return undefined;
        }

        return await NotificationService.scheduleOneTimeReminder(
          `💰 ${data.type === 'INCOME' ? 'Income' : 'Expense'} Reminder`,
          `[${data.category}] ${data.name}: ${data.type === 'INCOME' ? '+' : '-'}$${data.amount.toFixed(2)} due soon`,
          nextDue,
          { recurringId: data.id }
        );
      }
      return undefined;
    };

    if (editingId) {
      const old = recurringTransactions.find(t => t.id === editingId);
      if (old?.notificationId) {
        await NotificationService.cancelNotification(old.notificationId);
      }
    }

    const notifId = await scheduleNotification(transactionData);
    transactionData.notificationId = notifId || undefined;

    let updatedTransactions;
    if (editingId) {
      updatedTransactions = recurringTransactions.map(t => t.id === editingId ? transactionData : t);
    } else {
      updatedTransactions = [...recurringTransactions, transactionData];
    }

    await saveRecurringTransactions(updatedTransactions);

    setShowAddModal(false);
    resetForm();
    if (Platform.OS === 'web') {
      window.alert(editingId ? 'Recurring transaction updated!' : 'Recurring transaction added!');
    } else {
      Alert.alert('Success', editingId ? 'Recurring transaction updated!' : 'Recurring transaction added!');
    }
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

  const incrementDate = (freq: RecurringFrequency, dateMs: number): number => {
    const date = new Date(dateMs);
    switch (freq) {
      case 'DAILY': date.setDate(date.getDate() + 1); break;
      case 'WEEKLY': date.setDate(date.getDate() + 7); break;
      case 'MONTHLY': date.setMonth(date.getMonth() + 1); break;
      case 'YEARLY': date.setFullYear(date.getFullYear() + 1); break;
    }
    return date.getTime();
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
      if (deleted?.notificationId) {
        await NotificationService.cancelNotification(deleted.notificationId);
      }
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
      // @ts-ignore
      await dispatch(addTransaction({
        account_id: recurring.accountId,
        type: recurring.type,
        amount: recurring.amount,
        category: recurring.category,
        description: `${recurring.name} (Recurring)`,
        date: Date.now(),
      }));

      const updated = await Promise.all(recurringTransactions.map(async rt => {
        if (rt.id === recurring.id) {
          const nextDate = incrementDate(recurring.frequency, rt.nextDate);
          const updatedRt = { ...rt, nextDate };

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
                `[${updatedRt.category}] ${updatedRt.name}: ${updatedRt.type === 'INCOME' ? '+' : '-'}$${updatedRt.amount.toFixed(2)} due soon`,
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

      if (Platform.OS === 'web') {
        window.alert('Success: Transaction executed and created!');
      } else {
        Alert.alert('Success', 'Transaction created!');
      }

      // @ts-ignore
      dispatch(fetchTransactions());
    } catch (error) {
      if (Platform.OS === 'web') {
        window.alert('Error: Failed to create transaction');
      } else {
        Alert.alert('Error', 'Failed to create transaction');
      }
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
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Recurring Transactions</Text>
          <TouchableOpacity
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

        {viewMode === 'LIST' ? (
          <>
            {recurringTransactions.length === 0 ? (
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-8 items-center shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
                <FontAwesome name="repeat" size={48} color="#cbd5e1" />
                <Text className="text-slate-400 text-center mt-4 mb-2">No active recurring transactions</Text>
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
                      className={`w-12 h-12 rounded-2xl justify-center items-center mr-4 ${recurring.type === 'INCOME' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
                        }`}
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
                      <Text className="text-slate-500 text-sm">{recurring.category}</Text>
                    </View>
                    <View className="items-end">
                      <View className="flex-row gap-2 mb-1">
                        <TouchableOpacity onPress={() => handleEdit(recurring)} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                          <FontAwesome name="pencil" size={12} color="#3b82f6" />
                        </TouchableOpacity>
                      </View>
                      <Text
                        className={`font-bold text-xl ${recurring.type === 'INCOME' ? 'text-green-600' : 'text-red-600'
                          }`}
                      >
                        {recurring.type === 'INCOME' ? '+' : '-'}${recurring.amount.toFixed(2)}
                      </Text>
                      <Text className="text-slate-500 text-xs">{recurring.frequency}</Text>
                    </View>
                  </View>

                  <View className="border-t border-slate-100 dark:border-slate-700 pt-4">
                    <View className="flex-row items-center mb-3">
                      <FontAwesome name="calendar" size={14} color="#64748b" />
                      <Text className="text-slate-500 text-sm ml-2">
                        Next: {new Date(recurring.nextDate).toLocaleDateString()}
                      </Text>
                    </View>

                    <View className="flex-row gap-2">
                      <TouchableOpacity
                        onPress={() => handleToggleActive(recurring.id)}
                        className={`flex-1 py-3 rounded-xl ${recurring.isActive
                          ? 'bg-slate-100 dark:bg-slate-700'
                          : 'bg-green-100 dark:bg-green-900/30'
                          }`}
                      >
                        <Text
                          className={`text-center font-semibold ${recurring.isActive ? 'text-slate-600' : 'text-green-600'
                            }`}
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

                      <TouchableOpacity
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
                <Text className="text-slate-400">No upcoming recurring projections found.</Text>
              </View>
            ) : (
              filteredMonthKeys.map(month => (
                <View key={month} className="mb-6">
                  <View className="flex-row justify-between items-end mb-3 px-2">
                    <Text className="text-slate-600 dark:text-slate-300 font-bold text-lg uppercase">{month}</Text>
                    <View>
                      {monthlyProjections[month].totalExpense > 0 && <Text className="text-red-500 text-xs font-bold text-right">EXP: ${monthlyProjections[month].totalExpense.toFixed(0)}</Text>}
                      {monthlyProjections[month].totalIncome > 0 && <Text className="text-green-500 text-xs font-bold text-right">INC: ${monthlyProjections[month].totalIncome.toFixed(0)}</Text>}
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
                          <Text className="text-slate-500 text-xs">{item.category}</Text>
                        </View>
                      </View>
                      <Text className={`font-bold ${item.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}`}>
                        ${item.amount.toFixed(2)}
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
      {showAddModal && (
        <View className="absolute inset-0 bg-black/50 justify-center items-center px-6">
          <View
            className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md shadow-2xl"
            style={{ maxHeight: '90%' }}
          >
            <View className="flex-row justify-between items-center px-6 pt-6 pb-4">
              <Text className="text-slate-900 dark:text-white text-xl font-bold">
                {editingId ? 'Edit Recurring' : 'New Recurring'}
              </Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
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
                <Text className="text-slate-500 text-sm font-bold mb-2">Affected Account</Text>
                {accounts && accounts.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-3">
                    {accounts.map((acc: any) => (
                      <TouchableOpacity
                        key={acc.id}
                        onPress={() => setSelectedAccountId(acc.id)}
                        className={`px-4 py-3 rounded-xl border-2 ${selectedAccountId === acc.id
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500'
                          : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                          }`}
                      >
                        <Text className={selectedAccountId === acc.id ? 'text-indigo-600 font-bold' : 'text-slate-600'}>
                          {acc.name}
                        </Text>
                        <Text className="text-xs text-slate-400">${acc.balance}</Text>
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
                <Text className="text-slate-500 text-sm font-bold mb-2">Name</Text>
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
                <Text className="text-slate-500 text-sm font-bold mb-2">Amount</Text>
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
                <Text className="text-slate-500 text-sm font-bold mb-2">Type</Text>
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setType('EXPENSE')}
                    className={`flex-1 py-3 rounded-xl border-2 ${type === 'EXPENSE'
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                  >
                    <Text
                      className={`text-center font-semibold ${type === 'EXPENSE' ? 'text-red-600' : 'text-slate-600'
                        }`}
                    >
                      Expense
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setType('INCOME')}
                    className={`flex-1 py-3 rounded-xl border-2 ${type === 'INCOME'
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                  >
                    <Text
                      className={`text-center font-semibold ${type === 'INCOME' ? 'text-green-600' : 'text-slate-600'
                        }`}
                    >
                      Income
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Selection */}
              <View className="mb-4">
                <Text className="text-slate-500 text-sm font-bold mb-2">Category</Text>
                <ScrollView showsVerticalScrollIndicator={false} className="max-h-40">
                  {(() => {
                    const filteredCategories = categories.filter(c => c.type.toLowerCase() === type.toLowerCase());
                    const rootCategories = filteredCategories.filter(c => !c.parentId);
                    const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

                    return rootCategories.map((cat) => (
                      <View key={cat.id} className="mb-2">
                        {/* Parent Category */}
                        <TouchableOpacity
                          className={`w-full items-center p-3 rounded-xl border-2 ${category === cat.name
                            ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
                            : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                            }`}
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
                            className={`w-full items-center p-2 rounded-lg ml-6 mt-1 border-2 ${category === childCat.name
                              ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
                              : 'bg-slate-100 dark:bg-slate-700 border-transparent'
                              }`}
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
                <Text className="text-slate-500 text-sm font-bold mb-2">Frequency</Text>
                <View className="flex-row flex-wrap gap-2">
                  {frequencies.map((freq) => (
                    <TouchableOpacity
                      key={freq}
                      onPress={() => setFrequency(freq)}
                      className={`px-4 py-3 rounded-xl border-2 ${frequency === freq
                        ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-500'
                        : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                        }`}
                    >
                      <Text
                        className={`font-semibold ${frequency === freq ? 'text-purple-600' : 'text-slate-600'
                          }`}
                      >
                        {freq}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Start Date */}
              <View className="mb-4">
                <Text className="text-slate-500 text-sm font-bold mb-2">Start Date</Text>
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
                  <View className={`w-6 h-6 rounded border-2 mr-3 justify-center items-center ${hasEndDate ? 'bg-purple-500 border-purple-500' : 'border-slate-300'
                    }`}>
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
                  <View className={`w-6 h-6 rounded border-2 mr-3 justify-center items-center ${reminderEnabled ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
                    }`}>
                    {reminderEnabled && <FontAwesome name="check" size={14} color="#fff" />}
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold">🔔 Enable Reminders</Text>
                    <Text className="text-slate-500 text-xs">Get notified before payment is due</Text>
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
                          className={`flex-1 py-3 rounded-xl border-2 ${reminderDaysBefore === days
                            ? 'bg-blue-500 border-blue-500'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                            }`}
                        >
                          <Text
                            className={`text-center font-semibold ${reminderDaysBefore === days ? 'text-white' : 'text-slate-600 dark:text-slate-400'
                              }`}
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
          </View>
        </View>
      )}
    </View>
  );
}
