import { getDatabase } from '@/services/database';
import { generateUUID } from '@/utils/uuid';
import { sessionLocalStorage } from '@/services/SessionStorage';

import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { AuthService, normalizePhone } from '@/services/AuthService';
import { LinkedLoanService, UserLookupResult } from '@/services/LinkedLoanService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addLoan, deleteLoan, fetchLoans, updateLoan } from '@/store/slices/loansSlice';
import { addTransaction } from '@/store/slices/transactionsSlice';
import { Loan, LoanType, SharedLoan } from '@/types/database';
import LinkedLoanPendingBanner from '@/components/LinkedLoanPendingBanner';
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
import { useDispatch, useSelector } from 'react-redux';
import { NotificationService } from '@/services/NotificationService';

const SpinnerPickerSheet = ({
  show, value, mode, label, onClose, onConfirm, maximumDate,
}: {
  show: boolean; value: Date; mode: 'date' | 'time'; label: string;
  onClose: () => void; onConfirm: (d: Date) => void; maximumDate?: Date;
}) => {
  const pendingRef = React.useRef<Date>(value);
  const isDark = useColorScheme() === 'dark';
  React.useEffect(() => { if (show) pendingRef.current = value; }, [show]);
  if (!show) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? '#334155' : '#e2e8f0' }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#94a3b8', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color: isDark ? '#e2e8f0' : '#1e293b', fontWeight: '700', fontSize: 16 }}>{label}</Text>
            <TouchableOpacity onPress={() => { onClose(); onConfirm(pendingRef.current); }}>
              <Text style={{ color: '#6366f1', fontWeight: '700', fontSize: 16 }}>Done</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={value}
            mode={mode}
            display="spinner"
            maximumDate={maximumDate}
            style={{ height: 200, alignSelf: 'center', width: '100%' }}
            onChange={(_, d) => { if (d) pendingRef.current = d; }}
          />
        </View>
      </View>
    </Modal>
  );
};

const PlatformDatePicker = React.memo(({ value, onChange }: { value: Date, onChange: (date: Date) => void, placeholder?: string }) => {
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
        <SpinnerPickerSheet show={show} value={value} mode="date" label="Select Date" onClose={() => setShow(false)} onConfirm={(d) => onChange(d)} />
      )}
    </View>
  );
});

const PlatformTimePicker = React.memo(({ value, onChange }: { value: Date, onChange: (date: Date) => void }) => {
  const [show, setShow] = useState(false);
  if (Platform.OS === 'web') {
    return (
      <View className="bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
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
      }} className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl flex-row items-center justify-between border border-slate-200 dark:border-slate-700">
        <Text className="text-slate-900 dark:text-white text-base font-semibold">{value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        <FontAwesome name="clock-o" size={16} color="#64748b" />
      </TouchableOpacity>
      {Platform.OS === 'ios' && (
        <SpinnerPickerSheet show={show} value={value} mode="time" label="Select Time" onClose={() => setShow(false)} onConfirm={(d) => onChange(d)} />
      )}
    </View>
  );
});

export default function LoansDebtsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useAuth();
  const { items: loans } = useSelector((state: RootState) => state.loans);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const [activeTab, setActiveTab] = useState<LoanType>('LENT');
  const { t } = useI18n();
  const { formatCurrency, fontSize } = useAppSettings();
  const { actualTheme } = useTheme();
  const { categories } = useTransactions();
  const headerTitleSize = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';

  // Linked loan state
  const [myPhone, setMyPhone] = useState<string>('');
  const [linkedPhone, setLinkedPhone] = useState('');
  const [linkLookupResult, setLinkLookupResult] = useState<UserLookupResult | null>(null);
  const [linkLookupState, setLinkLookupState] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
  const linkLookupTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const getGradientColors = () => {
    if (actualTheme === 'dark') {
      return activeTab === 'LENT' ? ['#064e3b', '#022c22'] : ['#881337', '#4c0519'];
    } else {
      return activeTab === 'LENT' ? ['#16a34a', '#15803d'] : ['#dc2626', '#b91c1c'];
    }
  };

  // Navigation State
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // Suggestions State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Payment Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<{ loan: Loan } | null>(null);
  const [paymentAmountStr, setPaymentAmountStr] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');

  // Modal & Form State
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Loan | null>(null);
  const [formData, setFormData] = useState({
    personName: '',
    accountId: '',
    amount: '',
    paidAmount: '',
    interestRate: '',
    dueDate: '',
    reminderEnabled: true,
    reminderDaysBefore: '1',
    reminderTime: new Date(),
  });

  const [now, setNow] = useState(Date.now());
  const [globalRemindersEnabled, setGlobalRemindersEnabled] = useState(true);
  const [canEditLinkedTerms, setCanEditLinkedTerms] = useState(true);

  useEffect(() => {
    const init = async () => {
      dispatch(fetchLoans());
      dispatch(fetchAccounts());
      await loadGlobalSettings();
      await NotificationService.requestPermissions();
      // Load current user's phone for link requests
      if (user?.uid) {
        AuthService.getUserPhone(user.uid).then(p => { if (p) setMyPhone(p); });
      }
    };
    void init();
  }, [dispatch, user?.uid]);

  // Debounced phone lookup when linkedPhone changes
  useEffect(() => {
    if (linkLookupTimer.current) clearTimeout(linkLookupTimer.current);
    const trimmed = linkedPhone.trim();
    if (!trimmed) { setLinkLookupState('idle'); setLinkLookupResult(null); return; }
    setLinkLookupState('searching');
    linkLookupTimer.current = setTimeout(async () => {
      const result = await LinkedLoanService.lookupUserByPhone(trimmed).catch(() => null);
      if (result) {
        // Make sure they're not looking themselves up
        if (result.uid === user?.uid) {
          setLinkLookupState('not_found');
          setLinkLookupResult(null);
        } else {
          setLinkLookupResult(result);
          setLinkLookupState('found');
        }
      } else {
        setLinkLookupResult(null);
        setLinkLookupState('not_found');
      }
    }, 600);
    return () => { if (linkLookupTimer.current) clearTimeout(linkLookupTimer.current); };
  }, [linkedPhone, user?.uid]);

  useEffect(() => {
    let interval: any;
    if (!showAddModal && !showPaymentModal && !editingItem) {
      interval = setInterval(() => {
        setNow(Date.now());
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showAddModal, showPaymentModal, editingItem]);

  const loadGlobalSettings = async () => {
    try {
      const stored = Platform.OS === 'web'
        ? sessionLocalStorage.getItem('global_loan_reminders_enabled')
        : await AsyncStorage.getItem('@hisabtrack_global_loan_reminders_enabled');
      if (stored !== null) {
        setGlobalRemindersEnabled(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Error loading global settings:', e);
    }
  };

  const saveGlobalSettings = async (enabled: boolean) => {
    try {
      if (Platform.OS === 'web') {
        sessionLocalStorage.setItem('global_loan_reminders_enabled', JSON.stringify(enabled));
      } else {
        await AsyncStorage.setItem('@hisabtrack_global_loan_reminders_enabled', JSON.stringify(enabled));
      }
    } catch (e) {
      console.error('Error saving global settings:', e);
    }
  };

  const handleToggleGlobalReminders = async () => {
    const newValue = !globalRemindersEnabled;
    setGlobalRemindersEnabled(newValue);
    await saveGlobalSettings(newValue);

    if (!newValue) {
      // Clear only loan notifications (tricky if shared, but we can filter by data.type)
      const all = await NotificationService.getAllScheduledNotifications();
      for (const n of all) {
        if (n.content.data?.type === 'LOAN_REMINDER') {
          await NotificationService.cancelNotification(n.identifier);
        }
      }

      // Update all loans to clear their notificationId locally
      loans.forEach(loan => {
        if (loan.notificationId) {
          dispatch(updateLoan({ ...loan, notificationId: undefined }));
        }
      });
    } else {
      // Re-schedule all active reminders
      for (const loan of loans) {
        if (loan.status === 'ACTIVE' && loan.reminderEnabled) {
          const nid = await scheduleNotificationHelper(loan);
          if (nid) {
            dispatch(updateLoan({ ...loan, notificationId: nid }));
          }
        }
      }
    }
  };

  const handleToggleIndividualReminder = async (id: string) => {
    const loan = loans.find(l => l.id === id);
    if (!loan) return;

    const newEnabled = !loan.reminderEnabled;
    let nid = loan.notificationId;

    if (!newEnabled && nid) {
      await NotificationService.cancelNotification(nid);
      nid = undefined;
    } else if (newEnabled && loan.status === 'ACTIVE' && globalRemindersEnabled) {
      nid = (await scheduleNotificationHelper(loan)) || undefined;
    }

    await dispatch(updateLoan({ ...loan, reminderEnabled: newEnabled, notificationId: nid }));
  };

  const scheduleNotificationHelper = async (loan: any) => {
    if (!globalRemindersEnabled || !loan.due_date) return undefined;

    const dueDate = new Date(loan.due_date);
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - (loan.reminderDaysBefore || 0));
    const rTime = loan.reminderTime ? new Date(loan.reminderTime) : new Date();
    reminderDate.setHours(rTime.getHours(), rTime.getMinutes(), 0, 0);

    if (reminderDate.getTime() <= Date.now()) {
      return undefined;
    }

    const isLent = loan.type === 'LENT';
    return await NotificationService.scheduleOneTimeReminder(
      `${isLent ? 'Loan Collection' : 'Debt Repayment'} Reminder`,
      `${loan.lender_borrower_name}: ${isLent ? 'Collect' : 'Pay'} ${formatCurrency(loan.remaining_balance)} due on ${dueDate.toLocaleDateString()}`,
      reminderDate,
      { type: 'LOAN_REMINDER', loanId: loan.id }
    );
  };

  const getTimeRemaining = (targetDate: number, reminderDaysBefore: number, reminderTimeMs?: number) => {
    const nextDue = new Date(targetDate);
    nextDue.setDate(nextDue.getDate() - reminderDaysBefore);
    if (reminderTimeMs) {
      const rTime = new Date(reminderTimeMs);
      nextDue.setHours(rTime.getHours(), rTime.getMinutes(), 0, 0);
    } else {
      nextDue.setHours(9, 0, 0, 0); // Default to 9 AM
    }

    const diff = nextDue.getTime() - now;
    if (diff <= 0) return 'Due soon';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    if (minutes > 0) return `${minutes}m ${seconds}s left`;
    return `${seconds}s left`;
  };







  const filteredItems = loans.filter(item => item.type === activeTab);

  // Grouping Logic
  const groupedItems = React.useMemo(() => {
    const groups: Record<string, { items: Loan[], totalPrincipal: number, totalRemaining: number, count: number }> = {};
    filteredItems.forEach(item => {
      const name = item.lender_borrower_name.trim();
      if (!groups[name]) {
        groups[name] = { items: [], totalPrincipal: 0, totalRemaining: 0, count: 0 };
      }
      groups[name].items.push(item);
      groups[name].totalPrincipal += item.principal_amount;
      groups[name].totalRemaining += item.remaining_balance;
      groups[name].count += 1;
    });
    return groups;
  }, [filteredItems]);

  const groupNames = Object.keys(groupedItems).sort();

  const getTotalAmount = (type: LoanType) => {
    return loans
      .filter(item => item.type === type && item.status === 'ACTIVE')
      .reduce((sum, item) => sum + item.remaining_balance, 0);
  };

  const getLoanTotalPayable = (principal: number, rate: number, start: number, due: number) => {
    if (!start || !due || due <= start) return principal;

    const startDate = new Date(start);
    const dueDate = new Date(due);

    // Calculate months using calendar-accurate method
    let months = (dueDate.getFullYear() - startDate.getFullYear()) * 12 + (dueDate.getMonth() - startDate.getMonth());
    if (dueDate.getDate() < startDate.getDate()) {
      months -= 1;
    }
    months = Math.max(months, 1);

    const annualRate = rate / 100;
    const years = months / 12;
    const totalInterest = principal * annualRate * years;
    return principal + totalInterest;
  };

  const getProgress = (principal: number, remaining: number, rate: number, start: number, due: number) => {
    const totalPayable = getLoanTotalPayable(principal, rate, start, due);
    if (totalPayable === 0) return 0;
    const paid = totalPayable - remaining;
    return (paid / totalPayable) * 100;
  };

  const calculateMonthlyPayment = (principal: number, rate: number, start: number, due: number) => {
    if (!start || !due || due <= start) return principal;

    const startDate = new Date(start);
    const dueDate = new Date(due);

    // Calculate months using calendar-accurate method
    let months = (dueDate.getFullYear() - startDate.getFullYear()) * 12 + (dueDate.getMonth() - startDate.getMonth());
    if (dueDate.getDate() < startDate.getDate()) {
      months -= 1;
    }
    months = Math.max(months, 1);

    // Simple interest calculation
    const annualRate = rate / 100;
    const years = months / 12;
    const totalInterest = principal * annualRate * years;
    const totalPayable = principal + totalInterest;

    return totalPayable / months;
  };

  const handleAddItem = async () => {
    console.log('[Loans] handleAddItem called');
    console.log('[Loans] Form data:', formData);
    console.log('[Loans] Active tab:', activeTab);

    if (!formData.accountId) {
      console.log('[Loans] Validation failed: No account selected');
      Alert.alert('Error', 'Please select an account');
      return;
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0 || isNaN(parseFloat(formData.amount))) {
      console.log('[Loans] Validation failed: Invalid amount');
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    if (!formData.dueDate) {
      console.log('[Loans] Validation failed: No due date selected');
      Alert.alert('Error', 'Please select a due date');
      return;
    }

    try {
      const amount = parseFloat(formData.amount);
      const paid = parseFloat(formData.paidAmount || '0');
      const interestRate = parseFloat(formData.interestRate || '0');
      const startDate = Date.now();
      const dueDate = new Date(formData.dueDate).getTime() || startDate;

      const totalPayable = getLoanTotalPayable(amount, interestRate, startDate, dueDate);
      if (!Number.isFinite(paid) || paid < 0 || paid > totalPayable || !Number.isFinite(interestRate) || interestRate < 0 || dueDate <= startDate) throw new Error('Invalid loan terms or initial payment');
      const remaining = Math.max(0, totalPayable - paid);

      console.log('[Loans] Creating loan:', {
        type: activeTab,
        name: formData.personName.trim(),
        amount,
        paid,
        remaining,
        dueDate: formData.dueDate
      });

      // 1. Schedule notification first
      const notifId = await scheduleNotificationHelper({
        ...formData,
        type: activeTab,
        lender_borrower_name: formData.personName.trim(),
        remaining_balance: remaining,
        due_date: dueDate,
        reminderDaysBefore: parseInt(formData.reminderDaysBefore),
        reminderTime: formData.reminderTime.getTime(),
      });
      console.log('[Loans] Notification scheduled:', notifId);

      const created = await (await getDatabase()).createLoanWithCash({
        type: activeTab,
        lender_borrower_name: formData.personName.trim(),
        principal_amount: amount,
        interest_rate: interestRate,
        start_date: startDate,
        due_date: dueDate,
        status: remaining <= 0 ? 'PAID' : 'ACTIVE',
        remaining_balance: remaining,
        reminderEnabled: formData.reminderEnabled,
        reminderDaysBefore: parseInt(formData.reminderDaysBefore),
        reminderTime: formData.reminderEnabled ? formData.reminderTime.getTime() : undefined,
        notificationId: notifId || undefined
      }, formData.accountId, paid);
      const loanResult = { payload: created };
      await dispatch(fetchLoans()).unwrap();
      await dispatch(fetchAccounts()).unwrap();

      // Create linked loan if phone was entered and lookup succeeded
      if (linkedPhone.trim() && linkLookupResult && loanResult.payload) {
        try {
          const createdLoan = loanResult.payload as Loan;
          const sharedLoanId = await LinkedLoanService.createLinkRequest({
            initiatorUid: user!.uid,
            initiatorName: user!.displayName || user!.email || 'User',
            initiatorPhone: myPhone,
            initiatorRole: activeTab === 'BORROWED' ? 'BORROWER' : 'LENDER',
            otherPartyUid: linkLookupResult.uid,
            otherPartyPhone: normalizePhone(linkedPhone.trim()),
            otherPartyName: formData.personName.trim(),
            localLoanId: createdLoan.id,
            amount,
            description: `${activeTab === 'LENT' ? 'Loan to' : 'Loan from'} ${formData.personName.trim()}`,
            dueDate,
            startDate,
            interestRate,
          });
          // Tag the local loan with the shared loan reference
          await dispatch(updateLoan({
            ...createdLoan,
            shared_loan_id: sharedLoanId,
            link_role: activeTab === 'BORROWED' ? 'BORROWER' : 'LENDER',
            link_status: 'PENDING',
            linked_uid: linkLookupResult.uid,
            linked_name: formData.personName.trim(),
            linked_phone: normalizePhone(linkedPhone.trim()),
            is_initiator: true,
          }));
          console.log('[Loans] Link request created:', sharedLoanId);
        } catch (linkErr) {
          console.warn('[Loans] Link creation failed (loan still saved):', linkErr);
        }
      }

      resetForm();
    } catch (error) {
      console.error('[Loans] Error adding loan:', error);
      Alert.alert('Error', 'Failed to add loan. Please try again.');
    }
  };

  const handleEditItem = async () => {
    if (!editingItem) return;

    // Linked+accepted loans: only the initiator may propose term changes.
    // is_initiator === false means explicitly a non-initiator (acceptor).
    // is_initiator === undefined means an older loan without the field — fall through
    // to the existing canEditLinkedTerms async check below.
    if (editingItem.shared_loan_id && editingItem.link_status === 'ACCEPTED') {
      if (editingItem.is_initiator === false) {
        Alert.alert(
          'Cannot Edit',
          'Only the user who created this loan link can propose term changes. Use the chat in Loan Details to discuss changes with the other party.',
        );
        resetForm();
        return;
      }
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount.');
      return;
    }
    const paid = parseFloat(formData.paidAmount || '0');
    const interestRate = parseFloat(formData.interestRate || '0');
    const startDate = editingItem.start_date || Date.now();
    const dueDate = new Date(formData.dueDate).getTime() || editingItem.due_date;

    // Enforce initiator authorization for core terms changes of linked loans
    if (editingItem.shared_loan_id && editingItem.link_status === 'ACCEPTED') {
      const amountChanged = editingItem.principal_amount !== amount;
      const interestRateChanged = editingItem.interest_rate !== interestRate;
      const dueDateChanged = editingItem.due_date !== dueDate;

      if (amountChanged || interestRateChanged || dueDateChanged) {
        if (!canEditLinkedTerms) {
          Alert.alert('Error', 'Only the loan initiator can modify shared loan terms.');
          return;
        }
        try {
          const before: Partial<SharedLoan> = {
            amount: editingItem.principal_amount,
            interestRate: editingItem.interest_rate,
            dueDate: editingItem.due_date,
          };
          const updates: Partial<SharedLoan> = {
            amount,
            interestRate,
            dueDate,
          };
          await LinkedLoanService.updateSharedLoanTerms(
            editingItem.shared_loan_id,
            user!.uid,
            user!.displayName || user!.email || 'User',
            before,
            updates
          );
        } catch (err: any) {
          console.error('[Loans] Failed to update shared loan terms in Firestore:', err);
          Alert.alert('Sync Warning', 'Failed to update shared terms on the server: ' + (err?.message || ''));
        }
      }
    }

    const totalPayable = getLoanTotalPayable(amount, interestRate, startDate, dueDate);
    const remaining = Math.max(0, totalPayable - paid);

    if (editingItem.notificationId) {
      await NotificationService.cancelNotification(editingItem.notificationId);
    }
    const notifId = (await scheduleNotificationHelper({
      ...formData,
      id: editingItem.id,
      type: activeTab,
      remaining_balance: remaining,
      due_date: dueDate,
      reminderDaysBefore: parseInt(formData.reminderDaysBefore),
      reminderTime: formData.reminderTime.getTime(),
    })) || undefined;

    const result = await dispatch(updateLoan({
      ...editingItem,
      lender_borrower_name: formData.personName.trim(),
      principal_amount: amount,
      interest_rate: interestRate,
      due_date: dueDate,
      status: remaining <= 0 ? 'PAID' : 'ACTIVE',
      remaining_balance: remaining,
      reminderEnabled: formData.reminderEnabled,
      reminderDaysBefore: parseInt(formData.reminderDaysBefore),
      reminderTime: formData.reminderEnabled ? formData.reminderTime.getTime() : undefined,
      notificationId: notifId,
    }));

    if (updateLoan.rejected.match(result)) {
      Alert.alert('Error', 'Failed to update loan.');
      return;
    }
    resetForm();
  };

  const handleDeleteItem = (id: string) => {
    const loan = loans.find(l => l.id === id);
    const isLinkedAccepted = !!loan?.shared_loan_id && loan?.link_status === 'ACCEPTED';

    Alert.alert(
      'Delete Loan',
      isLinkedAccepted
        ? 'This loan is linked with another user. Deleting will disconnect the link for both parties. Are you sure?'
        : 'Are you sure you want to delete this loan?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (loan?.notificationId) {
              await NotificationService.cancelNotification(loan.notificationId);
            }
            // Detach from Firestore before local delete so the other party sees the link is gone
            if (isLinkedAccepted && loan?.shared_loan_id && user?.uid) {
              try {
                await LinkedLoanService.detachLoan(
                  loan.shared_loan_id,
                  user.uid,
                  user.displayName || user.email || 'User',
                );
              } catch (e) {
                console.warn('[Loans] detachLoan failed — deleting locally anyway:', e);
              }
            }
            const result = await dispatch(deleteLoan(id));
            if (deleteLoan.rejected.match(result)) {
              Alert.alert('Error', 'Failed to delete loan.');
            }
          },
        },
      ]
    );
  };

  // Payment Handlers
  const initiatePayment = (loan: Loan, mode: 'QUICK' | 'FULL' | 'MANUAL') => {
    let amountVal = '';
    if (mode === 'FULL') {
      amountVal = loan.remaining_balance.toString();
    } else if (mode === 'QUICK') {
      const monthly = calculateMonthlyPayment(loan.principal_amount, loan.interest_rate, loan.start_date, loan.due_date);
      amountVal = monthly.toFixed(2);
    }

    setPaymentAmountStr(amountVal);
    setPendingPayment({ loan });
    setPaymentAccountId(accounts[0]?.id || '');
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async () => {
    if (!pendingPayment || !paymentAccountId || !paymentAmountStr) return;

    const { loan } = pendingPayment;
    const amount = parseFloat(paymentAmountStr);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Invalid Amount');
      return;
    }

    const isLinked = !!loan.shared_loan_id && loan.link_status === 'ACCEPTED';

    if (isLinked) { router.push(`/loan/${loan.id}` as any); return; }
    try {
      await (await getDatabase()).recordLoanPayment(loan.id, paymentAccountId, amount, `payment-${loan.id}-${loan.remaining_balance}-${amount}`);
      await Promise.all([dispatch(fetchLoans()).unwrap(), dispatch(fetchAccounts()).unwrap()]);
    } catch (error) {
      Alert.alert('Payment not recorded', error instanceof Error ? error.message : 'Please try again');
      return;
    }

    setShowPaymentModal(false);
    setPendingPayment(null);
    setPaymentAmountStr('');
  };

  const openEditModal = (item: Loan) => {
    setEditingItem(item);
    const totalPayable = getLoanTotalPayable(item.principal_amount, item.interest_rate, item.start_date, item.due_date);
    const paid = Math.max(0, totalPayable - item.remaining_balance);
    setFormData({
      personName: item.lender_borrower_name,
      accountId: '',
      amount: item.principal_amount.toString(),
      paidAmount: paid.toFixed(2),
      interestRate: item.interest_rate.toString(),
      dueDate: new Date(item.due_date).toISOString().split('T')[0],
      reminderEnabled: item.reminderEnabled ?? true,
      reminderDaysBefore: (item.reminderDaysBefore ?? 1).toString(),
      reminderTime: item.reminderTime ? new Date(item.reminderTime) : new Date(),
    });

    setCanEditLinkedTerms(true);
    if (item.shared_loan_id && item.link_status === 'ACCEPTED') {
      LinkedLoanService.getSharedLoan(item.shared_loan_id)
        .then(shared => {
          if (shared && user) {
            setCanEditLinkedTerms(shared.initiatorUid === user.uid);
          }
        })
        .catch(err => {
          console.warn('[Loans] Failed to check initiator permission:', err);
        });
    }
  };

  const openAddModal = () => {
    setEditingItem(null);
    setFormData({
      personName: selectedGroup || '',
      accountId: accounts[0]?.id || '',
      amount: '',
      paidAmount: '',
      interestRate: '',
      dueDate: '',
      reminderEnabled: true,
      reminderDaysBefore: '1',
      reminderTime: new Date(),
    });
    setCanEditLinkedTerms(true);
    setShowAddModal(true);
  };

  const resetForm = () => {
    setShowAddModal(false);
    setEditingItem(null);
    setFormData({
      personName: '',
      accountId: '',
      amount: '',
      paidAmount: '',
      interestRate: '',
      dueDate: '',
      reminderEnabled: true,
      reminderDaysBefore: '1',
      reminderTime: new Date(),
    });
    setSuggestions([]);
    setShowSuggestions(false);
    setLinkedPhone('');
    setLinkLookupResult(null);
    setLinkLookupState('idle');
    setCanEditLinkedTerms(true);
  };

  // Accept a pending link request — creates a mirror loan on acceptor's side
  const handleAcceptLink = async (
    sharedLoan: SharedLoan & { id: string },
    iAmBorrower: boolean,
  ) => {
    if (!user) return;
    const startDate = sharedLoan.startDate || Date.now();
    const dueDate = sharedLoan.dueDate;
    const totalPayable = getLoanTotalPayable(sharedLoan.amount, sharedLoan.interestRate, startDate, dueDate);

    const loanResult = await dispatch(addLoan({
      type: iAmBorrower ? 'BORROWED' : 'LENT',
      lender_borrower_name: iAmBorrower ? sharedLoan.lenderName : sharedLoan.borrowerName,
      principal_amount: sharedLoan.amount,
      interest_rate: sharedLoan.interestRate,
      start_date: startDate,
      due_date: dueDate,
      status: 'ACTIVE',
      remaining_balance: totalPayable,
      reminderEnabled: true,
      reminderDaysBefore: 1,
    }));

    if (addLoan.rejected.match(loanResult)) {
      throw new Error('Failed to create local loan');
    }

    const newLoan = loanResult.payload as Loan;

    await LinkedLoanService.acceptLink(
      sharedLoan.id,
      user.uid,
      user.displayName || user.email || 'User',
      newLoan.id,
    );

    // Tag the new local loan
    await dispatch(updateLoan({
      ...newLoan,
      shared_loan_id: sharedLoan.id,
      link_role: iAmBorrower ? 'BORROWER' : 'LENDER',
      link_status: 'ACCEPTED',
      linked_uid: iAmBorrower ? sharedLoan.lenderUid : sharedLoan.borrowerUid,
      linked_name: iAmBorrower ? sharedLoan.lenderName : sharedLoan.borrowerName,
      linked_phone: iAmBorrower ? sharedLoan.lenderPhone : sharedLoan.borrowerPhone,
      is_initiator: false,
    }));
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      setFormData({ ...formData, dueDate: selectedDate.toISOString().split('T')[0] });
    }
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={getGradientColors() as any}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity onPress={() => selectedGroup ? setSelectedGroup(null) : router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className={`text-white ${headerTitleSize} font-bold`}>
            {selectedGroup ? selectedGroup : t('loansDebtsTitle')}
          </Text>
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={handleToggleGlobalReminders}
              className={`w-10 h-10 ${globalRemindersEnabled ? 'bg-white/20' : 'bg-red-500/40'} rounded-xl justify-center items-center mr-2`}
            >
              <FontAwesome name={globalRemindersEnabled ? 'bell' : 'bell-slash'} size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/amortization')}
              className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center mr-2"
            >
              <FontAwesome name="calculator" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openAddModal}
              className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
            >
              <FontAwesome name="plus" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats */}
        {!selectedGroup && (
          <View className="flex-row justify-between mt-4">
            <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 mr-2">
              <Text className="text-white/90 text-xs">{t('loansGiven')}</Text>
              <Text className="text-white text-xl font-bold">{formatCurrency(getTotalAmount('LENT'))}</Text>
            </View>
            <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 ml-2">
              <Text className="text-white/90 text-xs">{t('debtsOwed')}</Text>
              <Text className="text-white text-xl font-bold">{formatCurrency(getTotalAmount('BORROWED'))}</Text>
            </View>
          </View>
        )}

        {selectedGroup && (
          <View className="flex-row justify-between mt-4">
            <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 mr-2">
              <Text className="text-white/90 text-xs">{t('totalPrincipal')}</Text>
              <Text className="text-white text-xl font-bold">{formatCurrency(groupedItems[selectedGroup]?.totalPrincipal || 0)}</Text>
            </View>
            <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 ml-2">
              <Text className="text-white/90 text-xs">{t('totalRemaining')}</Text>
              <Text className="text-white text-xl font-bold">{formatCurrency(groupedItems[selectedGroup]?.totalRemaining || 0)}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {/* Tabs */}
      {!selectedGroup && (
        <View className="px-6 py-4">
          <View className="flex-row bg-white dark:bg-slate-800 p-1.5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
            <TouchableOpacity
              onPress={() => setActiveTab('LENT')}
              className={`flex-1 py-3 rounded-xl items-center flex-row justify-center ${activeTab === 'LENT' ? 'bg-green-500' : 'bg-white'
                }`}
            >
              <FontAwesome name="arrow-down" size={14} color={activeTab === 'LENT' ? '#fff' : '#000'} />
              <Text className={`ml-2 text-sm font-bold ${activeTab === 'LENT' ? 'text-white' : 'text-black'
                }`}>
                {t('loansGiven')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('BORROWED')}
              className={`flex-1 py-3 rounded-xl items-center flex-row justify-center ${activeTab === 'BORROWED' ? 'bg-red-500' : ''
                }`}
            >
              <FontAwesome name="arrow-up" size={14} color={activeTab === 'BORROWED' ? '#fff' : '#94a3b8'} />
              <Text className={`ml-2 text-sm font-bold ${activeTab === 'BORROWED' ? 'text-white' : 'text-slate-500'
                }`}>
                {t('debtsOwed')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Pending Link Requests */}
      <LinkedLoanPendingBanner onAccepted={handleAcceptLink} />

      {/* Content */}
      <ScrollView className="flex-1 px-6 mt-4" showsVerticalScrollIndicator={false}>

        {!selectedGroup ? (
          <>
            {groupNames.length === 0 ? (
              <ScreenInfoCard
                icon="users"
                title={activeTab === 'LENT' ? 'Track money you lend' : 'Track money you borrow'}
                description="Keep a clear record of who owes what, payment dates, and remaining balances."
                suggestions={[
                  'Add the person, amount, and expected due date when you lend or borrow.',
                  'Record partial payments so the remaining balance stays accurate.',
                  'Open a loan to review its payment history and progress.',
                ]}
              />
            ) : (
              groupNames.map(name => {
                const group = groupedItems[name];
                return (
                  <TouchableOpacity
                    key={name}
                    onPress={() => setSelectedGroup(name)}
                    className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700"
                    style={{ elevation: 4 }}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center">
                        <View className={`w-12 h-12 rounded-2xl justify-center items-center mr-4 ${activeTab === 'LENT' ? 'bg-green-100' : 'bg-red-100'}`}>
                          <FontAwesome name="user" size={20} color={activeTab === 'LENT' ? '#10b981' : '#ef4444'} />
                        </View>
                        <View>
                          <Text className="text-slate-900 dark:text-white font-bold text-lg">{name}</Text>
                          <Text className="text-slate-500 text-sm">{group.count} {group.count === 1 ? 'Loan' : 'Loans'}</Text>
                        </View>
                      </View>
                      <FontAwesome name="chevron-right" size={14} color="#94a3b8" />
                    </View>

                    <View className="mt-2 pt-4 border-t border-slate-100 dark:border-slate-700 flex-row justify-between">
                      <View>
                        <Text className="text-slate-500 text-xs">{t('totalPrincipal')}</Text>
                        <Text className="text-slate-900 dark:text-white font-bold">{formatCurrency(group.totalPrincipal)}</Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-slate-500 text-xs">{t('totalRemaining')}</Text>
                        <Text className={`font-bold ${activeTab === 'LENT' ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(group.totalRemaining)}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        ) : (
          /* LIST VIEW */
          <>
            {groupedItems[selectedGroup]?.items.map((item) => {
              const progress = getProgress(item.principal_amount, item.remaining_balance, item.interest_rate, item.start_date, item.due_date);
              const totalPayable = getLoanTotalPayable(item.principal_amount, item.interest_rate, item.start_date, item.due_date);
              const paidAmount = totalPayable - item.remaining_balance;
              const isPaid = item.status === 'PAID';
              const monthlyPayment = calculateMonthlyPayment(item.principal_amount, item.interest_rate, item.start_date, item.due_date);
              const isItemLinked = !!item.shared_loan_id && item.link_status === 'ACCEPTED';

              return (
                <TouchableOpacity
                  key={item.id}
                  className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700"
                  style={{ elevation: 4 }}
                  onPress={() => router.push(`/loan/${item.id}`)}
                >
                  {/* Item Details */}
                  <View className="flex-row items-center mb-4">
                    <View
                      className={`w-14 h-14 rounded-2xl justify-center items-center mr-4 ${activeTab === 'LENT' ? 'bg-green-100' : 'bg-red-100'
                        }`}
                    >
                      <FontAwesome
                        name={activeTab === 'LENT' ? 'arrow-down' : 'arrow-up'}
                        size={24}
                        color={activeTab === 'LENT' ? '#10b981' : '#ef4444'}
                      />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2 mb-1">
                        <Text className="text-slate-900 dark:text-white font-bold text-lg">
                          {item.lender_borrower_name}
                        </Text>
                        {item.shared_loan_id && item.link_status === 'ACCEPTED' && (
                          <View className="flex-row items-center bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full">
                            <FontAwesome name="link" size={9} color="#6366f1" />
                            <Text className="text-indigo-600 dark:text-indigo-400 text-[10px] font-bold ml-1">Linked</Text>
                          </View>
                        )}
                        {item.shared_loan_id && item.link_status === 'PENDING' && (
                          <View className="flex-row items-center bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">
                            <FontAwesome name="clock-o" size={9} color="#d97706" />
                            <Text className="text-amber-600 dark:text-amber-400 text-[10px] font-bold ml-1">Pending</Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-slate-500 text-xs">
                        Due: {new Date(item.due_date).toLocaleDateString()}
                      </Text>
                      <Text className="text-slate-500 text-xs dark:text-slate-400">
                        Est. Monthly: {formatCurrency(monthlyPayment)}
                      </Text>
                    </View>
                    <View className="flex-row">
                      <TouchableOpacity
                        onPress={() => handleToggleIndividualReminder(item.id)}
                        className={`w-10 h-10 ${item.reminderEnabled ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-slate-100 dark:bg-slate-800'} rounded-xl justify-center items-center mr-2`}
                      >
                        <FontAwesome name={item.reminderEnabled ? 'bell' : 'bell-slash'} size={14} color={item.reminderEnabled ? '#3b82f6' : '#94a3b8'} />
                      </TouchableOpacity>
                      {/* Non-initiators (is_initiator === false) see a lock icon on linked loans */}
                      <TouchableOpacity
                        onPress={() => isItemLinked && item.is_initiator === false
                          ? Alert.alert('Cannot Edit', 'Only the user who created this loan link can propose term changes. Use the chat in Loan Details to discuss.')
                          : openEditModal(item)
                        }
                        className={`w-10 h-10 ${isItemLinked && item.is_initiator === false ? 'bg-slate-100 dark:bg-slate-700' : 'bg-blue-50 dark:bg-blue-900/30'} rounded-xl justify-center items-center mr-2`}
                      >
                        <FontAwesome
                          name={isItemLinked && item.is_initiator === false ? 'lock' : 'edit'}
                          size={16}
                          color={isItemLinked && item.is_initiator === false ? '#94a3b8' : '#3b82f6'}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteItem(item.id)}
                        className="w-10 h-10 bg-red-50 dark:bg-red-900/30 rounded-xl justify-center items-center"
                      >
                        <FontAwesome name="trash" size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View className="mb-4">
                    <View className="flex-row justify-between mb-2">
                      <View className="flex-1">
                        <Text className="text-slate-500 text-sm">{t('paymentProgress')}</Text>
                      </View>
                      {item.reminderEnabled && item.status === 'ACTIVE' && globalRemindersEnabled && (
                        <View className="bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-full mr-2 items-end">
                          <Text className="text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                            {getTimeRemaining(item.due_date, item.reminderDaysBefore || 0, item.reminderTime)}
                          </Text>
                          {item.reminderTime && (
                            <Text className="text-blue-400 dark:text-blue-500 text-[10px]">
                              at {new Date(item.reminderTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          )}
                        </View>
                      )}
                      <Text className="text-slate-900 dark:text-white font-bold text-sm">
                        {progress.toFixed(1)}%
                      </Text>
                    </View>
                    <View className="bg-slate-100 dark:bg-slate-900 h-3 rounded-full overflow-hidden">
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${progress}%`,
                          backgroundColor: activeTab === 'LENT' ? '#10b981' : '#ef4444',
                        }}
                      />
                    </View>
                  </View>

                  <View className="flex-row justify-between mb-4">
                    <View>
                      <Text className="text-slate-500 text-xs mb-1">{t('paid')}</Text>
                      <Text className="text-slate-900 dark:text-white font-bold text-lg">
                        {formatCurrency(paidAmount)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-slate-500 text-xs mb-1">{t('remaining')}</Text>
                      <Text className={`font-bold text-lg ${activeTab === 'LENT' ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(item.remaining_balance)}
                      </Text>
                    </View>
                  </View>

                  {!isPaid && !isItemLinked && (
                    <View className="flex-row flex-wrap mt-4 gap-2">
                      <TouchableOpacity
                        onPress={() => initiatePayment(item, 'QUICK')}
                        className={`flex-1 min-w-[30%] py-3 rounded-xl ${activeTab === 'LENT' ? 'bg-green-50' : 'bg-red-50'
                          }`}
                      >
                        <Text className={`text-center font-bold text-xs ${activeTab === 'LENT' ? 'text-green-600' : 'text-red-600'
                          }`}>
                          +{formatCurrency(parseFloat(monthlyPayment.toFixed(0)))} (Mo)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => initiatePayment(item, 'MANUAL')}
                        className={`flex-1 min-w-[30%] py-3 rounded-xl bg-slate-100 dark:bg-slate-700`}
                      >
                        <Text className="text-slate-600 dark:text-slate-300 text-center font-bold text-xs">
                          {t('manual')}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => initiatePayment(item, 'FULL')}
                        className={`flex-1 min-w-[30%] py-3 rounded-xl ${activeTab === 'LENT' ? 'bg-green-500' : 'bg-red-500'
                          }`}
                      >
                        <Text className="text-white text-center font-bold text-xs">{t('fullPaid')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Linked loans: payments must go through the two-party flow in the detail screen */}
                  {!isPaid && isItemLinked && (
                    <TouchableOpacity
                      onPress={() => router.push(`/loan/${item.id}`)}
                      className={`mt-4 flex-row items-center justify-center py-3 rounded-xl gap-2 ${activeTab === 'LENT' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}
                    >
                      <FontAwesome name="exchange" size={13} color={activeTab === 'LENT' ? '#16a34a' : '#dc2626'} />
                      <Text className={`font-bold text-xs ${activeTab === 'LENT' ? 'text-green-600' : 'text-red-600'}`}>
                        Record Payment in Details
                      </Text>
                      <FontAwesome name="chevron-right" size={11} color={activeTab === 'LENT' ? '#16a34a' : '#dc2626'} />
                    </TouchableOpacity>
                  )}

                  {isPaid && (
                    <View className="mt-4 bg-green-50 dark:bg-green-900/30 px-4 py-3 rounded-xl flex-row items-center justify-center">
                      <FontAwesome name="check-circle" size={16} color="#10b981" />
                      <Text className="text-green-600 dark:text-green-400 font-bold text-sm ml-2">
                        {t('fullPaid')}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
            }
          </>
        )}
        <View className="h-8" />
      </ScrollView>

      {/* Payment Confirmation Modal */}
      <Modal
        visible={showPaymentModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPaymentModal(false)}
      >
        <View className="flex-1 bg-black/60 justify-center items-center px-6">
          <View className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm">
            <Text className="text-center text-xl font-bold text-slate-900 dark:text-white mb-4">
              {t('confirmPayment')}
            </Text>
            <Text className="text-center text-slate-500 dark:text-slate-400 mb-6">
              {t('recordPaymentAmount')}
            </Text>

            <TextInput
              className="bg-slate-50 dark:bg-slate-800 text-center text-slate-900 dark:text-white text-2xl font-bold p-4 rounded-2xl mb-6"
              placeholder={formatCurrency(0)}
              placeholderTextColor="#cbd5e1"
              keyboardType="decimal-pad"
              value={paymentAmountStr}
              onChangeText={setPaymentAmountStr}
            />

            <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">{t('selectAccount')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-6">
              {accounts.map(acc => (
                <TouchableOpacity
                  key={acc.id}
                  onPress={() => setPaymentAccountId(acc.id)}
                  className={`mr-2 px-4 py-3 rounded-xl border-2 ${paymentAccountId === acc.id
                    ? 'bg-blue-50 border-blue-500'
                    : 'bg-slate-50 dark:bg-slate-800 border-transparent'
                    }`}
                >
                  <Text className={`font-bold ${paymentAccountId === acc.id ? 'text-blue-700' : 'text-slate-600 dark:text-slate-400'
                    }`}>{acc.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setShowPaymentModal(false)}
                className="flex-1 bg-slate-100 dark:bg-slate-800 py-3 rounded-xl"
              >
                <Text className="text-slate-600 dark:text-slate-400 text-center font-bold">{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmPayment}
                className="flex-1 bg-blue-600 py-3 rounded-xl"
              >
                <Text className="text-white text-center font-bold">{t('confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        visible={showAddModal || editingItem !== null}
        transparent
        animationType="none"
        onRequestClose={resetForm}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-3xl p-6" style={{ maxHeight: '90%' }}>
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-slate-900 dark:text-white text-xl font-bold">
                {editingItem ? `Edit ${activeTab === 'LENT' ? 'Loan' : 'Debt'}` : `Add ${activeTab === 'LENT' ? 'Loan' : 'Debt'}`}
              </Text>
              <TouchableOpacity onPress={resetForm}>
                <FontAwesome name="times" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {!editingItem && (
                <View className="mb-4">
                  <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Select Account</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                    {accounts.map(acc => (
                      <TouchableOpacity
                        key={acc.id}
                        onPress={() => setFormData({ ...formData, accountId: acc.id })}
                        className={`mr-2 px-4 py-3 rounded-xl border-2 ${formData.accountId === acc.id
                          ? 'bg-emerald-50 border-emerald-500'
                          : 'bg-slate-50 dark:bg-slate-800 border-transparent'
                          }`}
                      >
                        <Text className={`font-bold ${formData.accountId === acc.id ? 'text-emerald-700' : 'text-slate-600 dark:text-slate-400'
                          }`}>{acc.name} ({formatCurrency(acc.balance)})</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Person/Institution Name */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">
                {activeTab === 'LENT' ? 'Borrower Name' : 'Lender Name'}
              </Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4 z-50 relative">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter name"
                  placeholderTextColor="#94a3b8"
                  value={formData.personName}
                  editable={canEditLinkedTerms}
                  onChangeText={(text) => {
                    setFormData({ ...formData, personName: text });
                    if (text.trim().length > 0) {
                      const matches = groupNames.filter(name =>
                        name.toLowerCase().includes(text.toLowerCase()) &&
                        name.toLowerCase() !== text.toLowerCase()
                      );
                      setSuggestions(matches);
                      setShowSuggestions(matches.length > 0);
                    } else {
                      setShowSuggestions(false);
                    }
                  }}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <View className="absolute top-14 left-0 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 overflow-hidden" style={{ elevation: 5 }}>
                    {suggestions.slice(0, 5).map((item, index) => (
                      <TouchableOpacity
                        key={index}
                        onPress={() => {
                          setFormData({ ...formData, personName: item });
                          setShowSuggestions(false);
                        }}
                        className="p-3 border-b border-slate-100 dark:border-slate-700"
                      >
                        <Text className="text-slate-700 dark:text-slate-300 font-bold">{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Link by phone (add only) */}
              {!editingItem && (
                <View className="mb-4">
                  <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">
                    {activeTab === 'LENT' ? "Borrower's Phone (optional — to link)" : "Lender's Phone (optional — to link)"}
                  </Text>
                  <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 flex-row items-center border border-slate-200 dark:border-slate-700">
                    <FontAwesome name="phone" size={14} color="#94a3b8" style={{ marginRight: 8 }} />
                    <TextInput
                      className="flex-1 text-slate-900 dark:text-white text-base h-14"
                      placeholder="e.g. 0912345678"
                      placeholderTextColor="#94a3b8"
                      keyboardType="phone-pad"
                      value={linkedPhone}
                      onChangeText={setLinkedPhone}
                    />
                    {linkLookupState === 'searching' && (
                      <Text className="text-slate-500 text-xs dark:text-slate-400">Searching...</Text>
                    )}
                    {linkLookupState === 'found' && (
                      <View className="flex-row items-center">
                        <FontAwesome name="check-circle" size={14} color="#16a34a" />
                        <Text className="text-green-600 text-xs font-bold ml-1">{linkLookupResult?.displayName}</Text>
                      </View>
                    )}
                    {linkLookupState === 'not_found' && (
                      <View className="flex-row items-center">
                        <FontAwesome name="times-circle" size={14} color="#ef4444" />
                        <Text className="text-red-500 text-xs ml-1">Not found</Text>
                      </View>
                    )}
                  </View>
                  {linkLookupState === 'found' && (
                    <Text className="text-green-600 text-xs mt-1 ml-1">
                      HisabTrack user found — a link request will be sent on save.
                    </Text>
                  )}
                </View>
              )}

              {/* Total Amount */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Total Amount</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={formData.amount}
                  editable={canEditLinkedTerms}
                  onChangeText={(text) => setFormData({ ...formData, amount: text })}
                />
              </View>

              {/* Paid Amount */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Paid Amount</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter paid amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={formData.paidAmount}
                  editable={canEditLinkedTerms}
                  onChangeText={(text) => setFormData({ ...formData, paidAmount: text })}
                />
              </View>

              {/* Interest Rate */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Interest Rate (%)</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter interest rate"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={formData.interestRate}
                  editable={canEditLinkedTerms}
                  onChangeText={(text) => setFormData({ ...formData, interestRate: text })}
                />
              </View>

              {/* Due Date */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Due Date</Text>
              {Platform.OS === 'web' ? (
                <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 mb-4">
                  {createElement('input', {
                    type: 'date',
                    value: formData.dueDate,
                    disabled: !canEditLinkedTerms,
                    onChange: (e: any) => {
                      if (e.target.value) {
                        setFormData({ ...formData, dueDate: e.target.value });
                      }
                    },
                    style: {
                      padding: 16,
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: actualTheme === 'dark' ? '#ffffff' : '#334155',
                      fontSize: 16,
                      width: '100%',
                      fontFamily: 'inherit',
                      outline: 'none'
                    },
                  })}
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => {
                      if (Platform.OS === 'android') {
                        DateTimePickerAndroid.open({
                          value: formData.dueDate ? new Date(formData.dueDate) : new Date(),
                          mode: 'date',
                          display: 'default',
                          onChange: (event: any, selectedDate?: Date) => {
                            if (event.type === 'set' && selectedDate) {
                              setFormData(prev => ({ ...prev, dueDate: selectedDate.toISOString().split('T')[0] }));
                            }
                          },
                        });
                      } else {
                        setShowDatePicker(true);
                      }
                    }}
                    disabled={!canEditLinkedTerms}
                    className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 justify-center h-14 mb-4"
                  >
                    <Text className={`text-base ${formData.dueDate ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>
                      {formData.dueDate || 'Select Due Date (YYYY-MM-DD)'}
                    </Text>
                  </TouchableOpacity>

                  {Platform.OS === 'ios' && showDatePicker && (
                    <DateTimePicker
                      value={formData.dueDate ? new Date(formData.dueDate) : new Date()}
                      mode="date"
                      display="spinner"
                      onChange={onDateChange}
                    />
                  )}
                </>
              )}

              {/* Reminder Settings */}
              <View className="mb-6 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-800">
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, reminderEnabled: !formData.reminderEnabled })}
                  className="flex-row items-center mb-3"
                >
                  <View className={`w-6 h-6 rounded border-2 mr-3 justify-center items-center ${formData.reminderEnabled ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
                    }`}>
                    {formData.reminderEnabled && <FontAwesome name="check" size={14} color="#fff" />}
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold">🔔 Enable Payment Reminder</Text>
                  </View>
                </TouchableOpacity>

                {formData.reminderEnabled && (
                  <View>
                    <Text className="text-slate-600 dark:text-slate-400 text-sm font-semibold mb-2">
                      Remind me (days before due date)
                    </Text>
                    <View className="flex-row gap-2 mb-4">
                      {['0', '1', '2', '3'].map((days) => (
                        <TouchableOpacity
                          key={days}
                          onPress={() => setFormData({ ...formData, reminderDaysBefore: days })}
                          className={`flex-1 py-3 rounded-xl border-2 ${formData.reminderDaysBefore === days
                            ? 'bg-blue-500 border-blue-500'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                            }`}
                        >
                          <Text
                            className={`text-center font-semibold ${formData.reminderDaysBefore === days ? 'text-white' : 'text-slate-600 dark:text-slate-400'
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
                      value={formData.reminderTime}
                      onChange={(date) => setFormData({ ...formData, reminderTime: date })}
                    />
                  </View>
                )}
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                onPress={editingItem ? handleEditItem : handleAddItem}
                disabled={!formData.personName || !formData.amount || (!editingItem && !formData.accountId)}
                className={`h-14 rounded-2xl justify-center items-center ${activeTab === 'LENT' ? 'bg-green-500' : 'bg-red-500'
                  } ${(!formData.personName || !formData.amount || (!editingItem && !formData.accountId)) ? 'opacity-50' : ''}`}
              >
                <Text className="text-white text-base font-bold">
                  {editingItem ? 'Update' : 'Add'} {activeTab === 'LENT' ? 'Loan' : 'Debt'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
            <FloatingCalculator onUseAmount={(value) => setFormData({ ...formData, amount: value })} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
