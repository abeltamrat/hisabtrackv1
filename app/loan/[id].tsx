import { getDatabase } from '@/services/database';
import LinkedPaymentService from '@/services/LinkedPaymentService';
import { generateUUID } from '@/utils/uuid';
import { flatLoanSchedule, money, sumMoney } from '@/utils/finance';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { LinkedLoanService } from '@/services/LinkedLoanService';
import { AppDispatch, RootState } from '@/store';
import { LinkedChangelogEntry, LinkedChatMessage, LinkedRepayment, SharedLoan } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { useDispatch, useSelector } from 'react-redux';
import { updateLoan } from '@/store/slices/loansSlice';
import { addTransaction } from '@/store/slices/transactionsSlice';

type Tab = 'schedule' | 'chat' | 'log';

interface AmortizationRow {
  period: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export default function LoanDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { formatCurrency } = useAppSettings();
  const { actualTheme } = useTheme();
  const { user } = useAuth();
  const isDark = actualTheme === 'dark';

  const loan = useSelector((state: RootState) =>
    state.loans.items.find(l => l.id === id),
  );
  const accounts = useSelector((state: RootState) => state.accounts.items);

  const loanRef = useRef(loan);
  useEffect(() => {
    loanRef.current = loan;
  }, [loan]);

  const [activeTab, setActiveTab] = useState<Tab>('schedule');
  const [schedule, setSchedule] = useState<AmortizationRow[]>([]);

  // Linked-loan state
  const [sharedLoan, setSharedLoan] = useState<(SharedLoan & { id: string }) | null>(null);
  const [repayments, setRepayments] = useState<(LinkedRepayment & { id: string })[]>([]);
  const [chatMessages, setChatMessages] = useState<(LinkedChatMessage & { id: string })[]>([]);
  const [changelog, setChangelog] = useState<(LinkedChangelogEntry & { id: string })[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  // Payment recording state
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recordPaymentAmount, setRecordPaymentAmount] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);
  const recordOperation = useRef(generateUUID());
  const [recordAccountId, setRecordAccountId] = useState('');

  // Confirmation-with-account state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalData, setConfirmModalData] = useState<{ repaymentId: string; amount: number } | null>(null);
  const [confirmAccountId, setConfirmAccountId] = useState('');
  const [confirmingWithAccount, setConfirmingWithAccount] = useState(false);

  // ── Amortization ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loan) return;
    const P = loan.principal_amount;
    const annualRate = loan.interest_rate / 100;
    const start = new Date(loan.start_date);
    const due = new Date(loan.due_date);
    if (due <= start) { setSchedule([]); return; }

    let months =
      (due.getFullYear() - start.getFullYear()) * 12 +
      (due.getMonth() - start.getMonth());
    if (due.getDate() < start.getDate()) months -= 1;
    months = Math.max(months, 1);

    const rows = flatLoanSchedule(P, loan.interest_rate, months);
    setSchedule(rows);
  }, [loan]);

  // Default account picker selections to first account when accounts load
  useEffect(() => {
    if (accounts.length > 0) {
      if (!recordAccountId) setRecordAccountId(accounts[0].id);
      if (!confirmAccountId) setConfirmAccountId(accounts[0].id);
    }
  }, [accounts]);

  // ── Firestore listeners (only when linked) ─────────────────────────────────
  // Helper to compute total payable
  const getLoanTotalPayable = (principal: number, rate: number, start: number, due: number) => {
    if (!start || !due || due <= start) return principal;
    const startDate = new Date(start);
    const dueDate = new Date(due);
    let months = (dueDate.getFullYear() - startDate.getFullYear()) * 12 + (dueDate.getMonth() - startDate.getMonth());
    if (dueDate.getDate() < startDate.getDate()) {
      months -= 1;
    }
    months = Math.max(months, 1);
    const annualRate = rate / 100;
    const years = months / 12;
    const totalInterest = money(principal * annualRate * years);
    return sumMoney([principal, totalInterest]);
  };

  useEffect(() => {
    if (!loan?.shared_loan_id) return;
    const id = loan.shared_loan_id;

    // Always listen to the SharedLoan document so that the sync effect below can
    // detect a PENDING → ACCEPTED transition and update the local SQLite record.
    const unsub1 = LinkedLoanService.listenToSharedLoan(id, setSharedLoan);

    if (loan.link_status !== 'ACCEPTED') {
      return () => { unsub1(); };
    }

    // Full sub-collection listeners only needed once the link is accepted.
    const unsub2 = LinkedLoanService.listenToRepayments(id, setRepayments);
    const unsub3 = LinkedLoanService.listenToChat(id, msgs => {
      setChatMessages(msgs);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
      // mark unread messages read
      if (user?.uid) {
        const unread = msgs.filter(m => !m.readBy.includes(user.uid!));
        if (unread.length > 0) {
          LinkedLoanService.markMessagesRead(id, unread.map(m => m.id!), user.uid);
        }
      }
    });
    const unsub4 = LinkedLoanService.listenToChangelog(id, setChangelog);

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [loan?.shared_loan_id, loan?.link_status, user?.uid]);

  // Synchronize remote state with local store
  useEffect(() => {
    const currentLoan = loanRef.current;
    if (!sharedLoan || !currentLoan) return;

    void getDatabase().then(db => db.allocateLinkedInterest(currentLoan.shared_loan_id!, repayments)).catch(() => undefined);
    const totalPayable = getLoanTotalPayable(sharedLoan.amount, sharedLoan.interestRate, sharedLoan.startDate, sharedLoan.dueDate);
    const confirmedPaid = sumMoney(repayments
      .filter(r => r.status === 'CONFIRMED')
      .map(r => r.amount));
    const computedRemainingBalance = Math.max(0, money(totalPayable - confirmedPaid));
    const computedStatus = computedRemainingBalance === 0 ? 'PAID' : sharedLoan.status;

    if (
      currentLoan.remaining_balance !== computedRemainingBalance ||
      currentLoan.status !== computedStatus ||
      currentLoan.principal_amount !== sharedLoan.amount ||
      currentLoan.interest_rate !== sharedLoan.interestRate ||
      currentLoan.due_date !== sharedLoan.dueDate ||
      currentLoan.link_status !== sharedLoan.linkStatus
    ) {
      dispatch(updateLoan({
        ...currentLoan,
        remaining_balance: computedRemainingBalance,
        status: computedStatus,
        principal_amount: sharedLoan.amount,
        interest_rate: sharedLoan.interestRate,
        due_date: sharedLoan.dueDate,
        link_status: sharedLoan.linkStatus,
      }));
    }
  }, [sharedLoan, repayments, dispatch]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getPaidMonths = () => {
    if (!loan || schedule.length === 0) return 0;
    const totalPayable = sumMoney([
      loan.principal_amount,
      money(loan.principal_amount * (loan.interest_rate / 100) * (schedule.length / 12)),
    ]);
    const paidAmount = money(totalPayable - loan.remaining_balance);
    const monthly = schedule[0]?.payment || 0;
    return monthly === 0 ? 0 : Math.floor(paidAmount / monthly);
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || !loan?.shared_loan_id || !user) return;
    setSendingChat(true);
    try {
      await LinkedLoanService.sendChatMessage(loan.shared_loan_id, {
        senderUid: user.uid,
        senderName: user.displayName || user.email || 'User',
        text: chatInput.trim(),
        timestamp: Date.now(),
        readBy: [user.uid],
      });
      setChatInput('');
    } catch {
      Alert.alert('Error', 'Failed to send message.');
    } finally {
      setSendingChat(false);
    }
  };

  const handleConfirmRepayment = (repaymentId: string) => {
    const repayment = repayments.find(r => r.id === repaymentId);
    if (!repayment) return;
    setConfirmModalData({ repaymentId, amount: repayment.amount });
    setShowConfirmModal(true);
  };

  const handleFinalConfirm = async () => {
    if (!confirmModalData || !loan?.shared_loan_id || !user) return;
    if (!confirmAccountId) {
      Alert.alert('Error', 'Please select an account.');
      return;
    }
    setConfirmingWithAccount(true);
    try {
      await LinkedPaymentService.save({
        id: `repayment-confirm-${loan.shared_loan_id}-${confirmModalData.repaymentId}-${user.uid}`,
        repaymentId: confirmModalData.repaymentId, sharedLoanId: loan.shared_loan_id,
        uid: user.uid, name: user.displayName || user.email || 'User', kind: 'confirm',
        role: loan.link_role!, amount: confirmModalData.amount, date: Date.now(),
        transaction: { loan_id: loan.id, account_id: confirmAccountId, type: isLent ? 'INCOME' : 'EXPENSE', amount: confirmModalData.amount,
          category: 'Loan Repayment', description: `Confirmed repayment with ${loan.lender_borrower_name}`, date: Date.now() },
      });
      setShowConfirmModal(false);
      setConfirmModalData(null);
    } catch {
      Alert.alert('Error', 'Failed to confirm repayment.');
    } finally {
      setConfirmingWithAccount(false);
    }
  };

  const handleRecordRepayment = async () => {
    if (!loan?.shared_loan_id || !user || !loan.link_role) return;
    const amount = parseFloat(recordPaymentAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Enter a valid payment amount.');
      return;
    }
    if (!recordAccountId) {
      Alert.alert('Error', 'Please select an account.');
      return;
    }
    setRecordingPayment(true);
    try {
      if (amount > loan.remaining_balance) throw new Error('Payment exceeds remaining balance');
      await LinkedPaymentService.save({
        id: `repayment-record-${recordOperation.current}`, repaymentId: recordOperation.current,
        sharedLoanId: loan.shared_loan_id, uid: user.uid, name: user.displayName || user.email || 'User',
        kind: 'record', role: loan.link_role, amount, date: Date.now(),
        transaction: { loan_id: loan.id, account_id: recordAccountId, type: iAmLender ? 'INCOME' : 'EXPENSE', amount,
          category: 'Loan Repayment', description: `Repayment with ${loan.lender_borrower_name}`, date: Date.now() },
      });
      recordOperation.current = generateUUID();
      setShowRecordPayment(false);
      setRecordPaymentAmount('');
      Alert.alert(
        'Payment Recorded',
        loan.link_role === 'LENDER'
          ? 'Payment claim sent. The borrower must confirm it.'
          : 'Payment recorded. The lender will confirm receipt.',
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to record payment.');
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleRejectRepayment = (repaymentId: string) => {
    if (!loan?.shared_loan_id || !user) return;
    Alert.alert(
      'Reject Repayment',
      'Reject this repayment claim and open chat to discuss?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject & Chat',
          style: 'destructive',
          onPress: async () => {
            setConfirmingId(repaymentId);
            try {
              await LinkedLoanService.rejectRepayment(
                loan.shared_loan_id!,
                repaymentId,
                user.uid,
                user.displayName || user.email || 'User',
              );
              setActiveTab('chat');
            } catch {
              Alert.alert('Error', 'Failed to reject repayment.');
            } finally {
              setConfirmingId(null);
            }
          },
        },
      ],
    );
  };

  if (!loan) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#94a3b8', fontSize: 16 }}>Loan not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16, backgroundColor: '#4f46e5', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLent = loan.type === 'LENT';
  const isLinked = !!loan.shared_loan_id && loan.link_status === 'ACCEPTED';
  const iAmBorrower = loan.link_role === 'BORROWER';
  const iAmLender = loan.link_role === 'LENDER';

  const pendingRepaymentsToConfirm = isLinked && user && sharedLoan
    ? repayments.filter(r => r.status === 'PENDING_CONFIRMATION' && r.recordedByUid !== user.uid)
    : [];

  const gradientColors: [string, string] = isLent
    ? (isDark ? ['#064e3b', '#022c22'] : ['#16a34a', '#15803d'])
    : (isDark ? ['#881337', '#4c0519'] : ['#dc2626', '#b91c1c']);

  const tabColor = isLent ? '#16a34a' : '#dc2626';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: isDark ? '#0f172a' : '#f8fafc' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <LinearGradient colors={gradientColors} style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, elevation: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Loan Details</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Name + phone */}
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
            {isLent ? 'Borrower' : 'Lender'}
          </Text>
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center' }}>
            {loan.lender_borrower_name}
          </Text>
          {loan.linked_phone && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <FontAwesome name="link" size={11} color="rgba(255,255,255,0.6)" />
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginLeft: 5 }}>
                {loan.linked_phone}
              </Text>
              {isLinked && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Linked</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Principal / Remaining */}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 16, padding: 16 }}>
          <View style={{ flex: 1, alignItems: 'center', borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.1)' }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 }}>Principal</Text>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{formatCurrency(loan.principal_amount)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 }}>Remaining</Text>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{formatCurrency(loan.remaining_balance)}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
        <View style={{ flex: 1, backgroundColor: isDark ? '#1e293b' : '#fff', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#334155' : '#f1f5f9' }}>
          <Text style={{ color: '#94a3b8', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 }}>Interest</Text>
          <Text style={{ color: isDark ? '#fff' : '#0f172a', fontSize: 18, fontWeight: '700' }}>{loan.interest_rate}%</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: isDark ? '#1e293b' : '#fff', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#334155' : '#f1f5f9' }}>
          <Text style={{ color: '#94a3b8', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 }}>Due Date</Text>
          <Text style={{ color: isDark ? '#fff' : '#0f172a', fontSize: 13, fontWeight: '700' }}>{new Date(loan.due_date).toLocaleDateString()}</Text>
        </View>
      </View>

      {/* Tab bar (only if linked) */}
      {isLinked && (
        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderRadius: 14, padding: 4 }}>
          {(['schedule', 'chat', 'log'] as Tab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center',
                backgroundColor: activeTab === tab ? tabColor : 'transparent',
              }}
            >
              <Text style={{ color: activeTab === tab ? '#fff' : '#94a3b8', fontWeight: '700', fontSize: 13, textTransform: 'capitalize' }}>
                {tab === 'schedule' ? 'Schedule' : tab === 'chat' ? 'Chat' : 'Log'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── SCHEDULE TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'schedule' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Pending repayment confirmations */}
          {pendingRepaymentsToConfirm.length > 0 && (
            <View style={{ backgroundColor: isDark ? '#1e3a2f' : '#f0fdf4', borderColor: '#86efac', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 }}>
              <Text style={{ color: isDark ? '#86efac' : '#166534', fontWeight: '700', fontSize: 13, marginBottom: 10 }}>
                Pending Repayment Confirmation
              </Text>
              {pendingRepaymentsToConfirm.map(r => {
                const otherPartyName = r.recordedBy === 'BORROWER' ? sharedLoan?.borrowerName : sharedLoan?.lenderName;
                return (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ color: isDark ? '#fff' : '#15803d', fontWeight: '700', fontSize: 15 }}>{formatCurrency(r.amount)}</Text>
                      <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                        Recorded by {otherPartyName} on {new Date(r.date).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => handleRejectRepayment(r.id!)}
                        disabled={confirmingId === r.id}
                        style={{ backgroundColor: isDark ? '#3f1e1e' : '#fee2e2', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 }}
                      >
                        <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 12 }}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleConfirmRepayment(r.id!)}
                        disabled={confirmingId === r.id}
                        style={{ backgroundColor: '#16a34a', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, alignItems: 'center', minWidth: 70 }}
                      >
                        {confirmingId === r.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Confirm</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Record Payment button — linked loans only */}
          {isLinked && loan.status !== 'PAID' && (
            <TouchableOpacity
              onPress={() => setShowRecordPayment(true)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: tabColor, borderRadius: 14, paddingVertical: 13, marginBottom: 16,
              }}
            >
              <FontAwesome name="plus-circle" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                {iAmLender ? 'Record Payment Received' : 'Record Payment Made'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Repayment history */}
          {isLinked && repayments.length > 0 && (
            <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#334155' : '#f1f5f9', marginBottom: 16, overflow: 'hidden' }}>
              <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: isDark ? '#334155' : '#f1f5f9' }}>
                <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '700', fontSize: 14 }}>Repayment History</Text>
              </View>
              {repayments.map(r => {
                const statusColor = r.status === 'CONFIRMED' ? '#10b981' : r.status === 'REJECTED' ? '#ef4444' : '#f59e0b';
                const statusLabel = r.status === 'CONFIRMED' ? 'Confirmed' : r.status === 'REJECTED' ? 'Rejected' : 'Pending';
                const byMe = r.recordedByUid === user?.uid;
                return (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                    <View>
                      <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '700', fontSize: 14 }}>{formatCurrency(r.amount)}</Text>
                      <Text style={{ color: '#94a3b8', fontSize: 11 }}>{new Date(r.date).toLocaleDateString()} · {byMe ? 'You recorded' : 'Other party recorded'}</Text>
                    </View>
                    <View style={{ backgroundColor: statusColor + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                      <Text style={{ color: statusColor, fontWeight: '700', fontSize: 11 }}>{statusLabel}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Amortization table */}
          <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#334155' : '#f1f5f9', overflow: 'hidden' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: isDark ? '#334155' : '#f1f5f9' }}>
              <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '700', fontSize: 15 }}>Amortization Schedule</Text>
            </View>
            {schedule.length > 0 ? (
              <View>
                <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderBottomWidth: 1, borderBottomColor: isDark ? '#334155' : '#f1f5f9' }}>
                  {['#', 'Payment', 'Principal', 'Balance', ''].map((h, i) => (
                    <Text key={i} style={{ flex: i === 0 ? 0.7 : i === 4 ? 0.5 : 2, color: '#94a3b8', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', textAlign: i > 0 ? 'right' : 'left' }}>{h}</Text>
                  ))}
                </View>
                {schedule.map(row => {
                  const isPaid = row.period <= getPaidMonths();
                  return (
                    <View key={row.period} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', opacity: isPaid ? 0.4 : 1 }}>
                      <Text style={{ flex: 0.7, fontSize: 12, fontWeight: '700', color: '#94a3b8' }}>{row.period}</Text>
                      <Text style={{ flex: 2, fontSize: 12, fontWeight: '600', color: isDark ? '#e2e8f0' : '#0f172a', textAlign: 'right' }}>{formatCurrency(row.payment)}</Text>
                      <View style={{ flex: 2, alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#475569' }}>{formatCurrency(row.principal)}</Text>
                        <Text style={{ fontSize: 9, color: '#94a3b8' }}>Int: {formatCurrency(row.interest)}</Text>
                      </View>
                      <Text style={{ flex: 2, fontSize: 12, fontWeight: '700', color: '#6366f1', textAlign: 'right' }}>{formatCurrency(row.balance)}</Text>
                      <View style={{ flex: 0.5, alignItems: 'flex-end' }}>
                        {isPaid && <FontAwesome name="check-circle" size={12} color="#10b981" />}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>Schedule calculation unavailable</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── CHAT TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={chatScrollRef}
            style={{ flex: 1, paddingHorizontal: 16 }}
            contentContainerStyle={{ paddingVertical: 12 }}
            onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}
          >
            {chatMessages.length === 0 && (
              <View style={{ alignItems: 'center', marginTop: 60 }}>
                <FontAwesome name="comments" size={40} color={isDark ? '#334155' : '#e2e8f0'} />
                <Text style={{ color: '#94a3b8', marginTop: 12, fontSize: 14 }}>No messages yet. Start the conversation.</Text>
              </View>
            )}
            {chatMessages.map(msg => {
              const isMe = msg.senderUid === user?.uid;
              return (
                <View key={msg.id} style={{ alignItems: isMe ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                  {!isMe && (
                    <Text style={{ color: '#94a3b8', fontSize: 10, marginBottom: 3, marginLeft: 4 }}>{msg.senderName}</Text>
                  )}
                  <View style={{
                    maxWidth: '78%',
                    backgroundColor: isMe ? (isLent ? '#16a34a' : '#dc2626') : (isDark ? '#1e293b' : '#f1f5f9'),
                    borderRadius: 16,
                    borderBottomRightRadius: isMe ? 4 : 16,
                    borderBottomLeftRadius: isMe ? 16 : 4,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                  }}>
                    <Text style={{ color: isMe ? '#fff' : (isDark ? '#e2e8f0' : '#0f172a'), fontSize: 14 }}>{msg.text}</Text>
                  </View>
                  <Text style={{ color: '#94a3b8', fontSize: 10, marginTop: 3, marginHorizontal: 4 }}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          {/* Chat input */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
            paddingBottom: Platform.OS === 'ios' ? 24 : 10,
            backgroundColor: isDark ? '#1e293b' : '#fff',
            borderTopWidth: 1, borderTopColor: isDark ? '#334155' : '#f1f5f9',
          }}>
            <TextInput
              style={{
                flex: 1, backgroundColor: isDark ? '#0f172a' : '#f8fafc',
                borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
                color: isDark ? '#fff' : '#0f172a', fontSize: 14,
                borderWidth: 1, borderColor: isDark ? '#334155' : '#e2e8f0',
                maxHeight: 100,
              }}
              placeholder="Type a message..."
              placeholderTextColor="#94a3b8"
              value={chatInput}
              onChangeText={setChatInput}
              multiline
            />
            <TouchableOpacity
              onPress={handleSendChat}
              disabled={sendingChat || !chatInput.trim()}
              style={{
                width: 42, height: 42, borderRadius: 21, marginLeft: 10,
                backgroundColor: chatInput.trim() ? tabColor : (isDark ? '#334155' : '#e2e8f0'),
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {sendingChat
                ? <ActivityIndicator size="small" color="#fff" />
                : <FontAwesome name="send" size={16} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── LOG TAB ────────────────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
          {changelog.length === 0 && (
            <View style={{ alignItems: 'center', marginTop: 60 }}>
              <FontAwesome name="history" size={40} color={isDark ? '#334155' : '#e2e8f0'} />
              <Text style={{ color: '#94a3b8', marginTop: 12, fontSize: 14 }}>No activity recorded yet.</Text>
            </View>
          )}
          {changelog.map((entry, idx) => (
            <View key={entry.id ?? idx} style={{ flexDirection: 'row', marginBottom: 16 }}>
              {/* Timeline line */}
              <View style={{ alignItems: 'center', marginRight: 12, width: 24 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tabColor, marginTop: 4 }} />
                {idx < changelog.length - 1 && (
                  <View style={{ flex: 1, width: 2, backgroundColor: isDark ? '#334155' : '#e2e8f0', marginTop: 4 }} />
                )}
              </View>
              <View style={{ flex: 1, backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: isDark ? '#334155' : '#f1f5f9', marginBottom: 2 }}>
                <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '600', fontSize: 14 }}>{entry.action}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: '#6366f1', fontSize: 11, fontWeight: '600' }}>{entry.actorName}</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 11 }}>{new Date(entry.timestamp).toLocaleString()}</Text>
                </View>
                {entry.before && entry.after && (
                  <View style={{ marginTop: 8, backgroundColor: isDark ? '#0f172a' : '#f8fafc', borderRadius: 8, padding: 8 }}>
                    {Object.keys(entry.after).map(k => (
                      <Text key={k} style={{ color: '#94a3b8', fontSize: 11 }}>
                        {k}: <Text style={{ color: '#ef4444', textDecorationLine: 'line-through' }}>{String((entry.before as any)[k])}</Text>
                        {' → '}
                        <Text style={{ color: '#16a34a' }}>{String((entry.after as any)[k])}</Text>
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      {/* ── Record Payment Modal ───────────────────────────────────────────── */}
      <Modal
        visible={showRecordPayment}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRecordPayment(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 380 }}>
            <Text style={{ color: isDark ? '#fff' : '#0f172a', fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
              {iAmLender ? 'Record Payment Received' : 'Record Payment Made'}
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
              {iAmLender
                ? 'This will notify the borrower to confirm the repayment.'
                : 'This will notify the lender to confirm they received payment.'}
            </Text>

            <Text style={{ color: isDark ? '#cbd5e1' : '#475569', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Amount</Text>
            <TextInput
              style={{
                backgroundColor: isDark ? '#0f172a' : '#f8fafc',
                borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '700',
                color: isDark ? '#fff' : '#0f172a',
                borderWidth: 1, borderColor: isDark ? '#334155' : '#e2e8f0',
                marginBottom: 16,
              }}
              placeholder="0.00"
              placeholderTextColor="#94a3b8"
              value={recordPaymentAmount}
              onChangeText={setRecordPaymentAmount}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text style={{ color: isDark ? '#cbd5e1' : '#475569', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Account</Text>
            {accounts.length === 0 ? (
              <Text style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>No accounts set up. Please add an account first.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 130, marginBottom: 20 }} showsVerticalScrollIndicator={false}>
                {accounts.map(acc => (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => setRecordAccountId(acc.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      padding: 11, borderRadius: 10, marginBottom: 6,
                      backgroundColor: recordAccountId === acc.id ? (tabColor + '22') : (isDark ? '#0f172a' : '#f8fafc'),
                      borderWidth: 1,
                      borderColor: recordAccountId === acc.id ? tabColor : (isDark ? '#334155' : '#e2e8f0'),
                    }}
                  >
                    <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '600', fontSize: 14 }}>{acc.name}</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>{formatCurrency(acc.balance)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => { setShowRecordPayment(false); setRecordPaymentAmount(''); }}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: isDark ? '#0f172a' : '#f1f5f9', alignItems: 'center' }}
              >
                <Text style={{ color: isDark ? '#94a3b8' : '#475569', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRecordRepayment}
                disabled={recordingPayment}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: tabColor, alignItems: 'center' }}
              >
                {recordingPayment
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* ── Confirm Payment Modal ─────────────────────────────────────────── */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowConfirmModal(false); setConfirmModalData(null); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 380 }}>
            <Text style={{ color: isDark ? '#fff' : '#0f172a', fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
              Confirm Repayment
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>
              Amount: <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '700' }}>{formatCurrency(confirmModalData?.amount ?? 0)}</Text>
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
              {isLent
                ? 'Select the account where you received this payment.'
                : 'Select the account from which this payment was sent.'}
            </Text>

            <Text style={{ color: isDark ? '#cbd5e1' : '#475569', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>Account</Text>
            {accounts.length === 0 ? (
              <Text style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>No accounts set up.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 140, marginBottom: 20 }} showsVerticalScrollIndicator={false}>
                {accounts.map(acc => (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => setConfirmAccountId(acc.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      padding: 11, borderRadius: 10, marginBottom: 6,
                      backgroundColor: confirmAccountId === acc.id ? '#16a34a22' : (isDark ? '#0f172a' : '#f8fafc'),
                      borderWidth: 1,
                      borderColor: confirmAccountId === acc.id ? '#16a34a' : (isDark ? '#334155' : '#e2e8f0'),
                    }}
                  >
                    <Text style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: '600', fontSize: 14 }}>{acc.name}</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 12 }}>{formatCurrency(acc.balance)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => { setShowConfirmModal(false); setConfirmModalData(null); }}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: isDark ? '#0f172a' : '#f1f5f9', alignItems: 'center' }}
              >
                <Text style={{ color: isDark ? '#94a3b8' : '#475569', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleFinalConfirm}
                disabled={confirmingWithAccount || accounts.length === 0}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#16a34a', alignItems: 'center', opacity: accounts.length === 0 ? 0.5 : 1 }}
              >
                {confirmingWithAccount
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm & Record</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
