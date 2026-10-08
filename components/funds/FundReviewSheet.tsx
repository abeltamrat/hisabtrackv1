import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch } from 'react-redux';

import CategoryTreeSelect from '@/components/CategoryTreeSelect';
import FormSheet from '@/components/FormSheet';
import FundPostingService, { custodianFundFields } from '@/services/FundPostingService';
import FundSyncService from '@/services/FundSyncService';
import { fundErrorMessage, SharedFundService } from '@/services/SharedFundService';
import type { AppDispatch } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction, fetchTransactions } from '@/store/slices/transactionsSlice';
import type { Account, FundEntry, SharedFund, Transaction } from '@/types/database';
import { Alert } from '@/utils/alert';
import { entryHeadline, formatDay, formatTime, setCustodianAccount, setOwnerReturnAccount } from './fundUi';

type OwnCategory = { id: string; name: string; parentId?: string; color?: string; icon?: string; type: string };

const NOT_INCOME = ['Loan repayment received', 'Borrowed money', 'Gift', 'Other money held'];

/** Everything about one entry, and what this person may do with it. */
export default function FundReviewSheet({
  entry, fund, myUid, accounts, ownCategories, defaultAccountId, formatCurrency, onClose, onDone,
}: {
  entry: FundEntry | null;
  fund: SharedFund;
  myUid: string;
  accounts: Account[];
  ownCategories: OwnCategory[];
  defaultAccountId?: string;
  formatCurrency: (value: number) => string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const isOwner = fund.ownerUid === myUid;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [counts, setCounts] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!entry) return;
    setProblem('');
    setText('');
    setBusy(false);
    setCategory(entry.ownerCategory || (entry.kind === 'SPEND' ? entry.category || '' : ''));
    setCounts(entry.ownerPurpose ? entry.ownerPurpose === 'OPERATING' : entry.kind === 'SPEND');
    setAccountId(entry.ownerAccountId || (isOwner ? '' : defaultAccountId || ''));
    setRemember(true);
  }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const myAccounts = useMemo(() => accounts.filter(account => account.fund_id !== fund.id), [accounts, fund.id]);
  const expenseTree = useMemo(() => ownCategories.filter(item => item.type === 'expense'), [ownCategories]);
  const incomeTree = useMemo(() => ownCategories.filter(item => item.type === 'income'), [ownCategories]);

  if (!entry) return null;
  const open = entry.status !== 'VOIDED';
  const thirdParty = entry.kind === 'DEPOSIT' && entry.source === 'THIRD_PARTY';
  const ownerSentIt = entry.kind === 'DEPOSIT' && (entry.source === 'OWNER' || entry.source === 'OWNER_UNRECORDED');
  const canAck = !isOwner && open && entry.kind === 'DEPOSIT' && entry.recordedByRole === 'OWNER' && !entry.ackAt;
  const canUnack = !isOwner && open && !!entry.ackAt && entry.ackByUid === myUid;
  const canVoid = open && (isOwner || entry.recordedByUid === myUid);

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setProblem('');
    try {
      await work();
      onDone(message);
    } catch (error) {
      setProblem(fundErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshBooks = async () => {
    await FundSyncService.refresh(fund);
    void dispatch(fetchTransactions());
    void dispatch(fetchAccounts());
  };

  const classify = () => run(async () => {
    if (entry.kind === 'SPEND') {
      await SharedFundService.classify(fund.id, entry.id, { ownerCategory: category || null, ownerPurpose: counts ? 'OPERATING' : 'FINANCING' });
    } else if (thirdParty) {
      await SharedFundService.classify(fund.id, entry.id, { ownerCategory: category || (counts ? 'Other income' : 'Other money held'), ownerPurpose: counts ? 'OPERATING' : 'FINANCING' });
    } else {
      if (!accountId) throw new Error('Choose one of your accounts.');
      await SharedFundService.classify(fund.id, entry.id, { ownerAccountId: accountId });
      if (entry.kind === 'RETURN' && remember) await setOwnerReturnAccount(fund.id, accountId);
    }
    await refreshBooks();
  }, 'Your books are updated.');

  const acknowledge = () => run(async () => {
    if (!accountId) throw new Error('Choose where the money arrived.');
    const local = {
      type: 'INCOME', account_id: accountId, amount: entry.amount, date: Date.now(), category: 'Fund deposit',
      description: `For ${fund.ownerName}${entry.payerName ? ` from ${entry.payerName}` : ''}`,
      sender_receiver: entry.payerName || fund.ownerName,
      ...custodianFundFields(fund.id, entry.id),
    } as Omit<Transaction, 'id'>;
    await FundPostingService.submit({ id: entry.id, uid: myUid, fundId: fund.id, fundName: fund.name, kind: 'ack', evidence: {} }, () => dispatch(addTransaction(local)).unwrap());
    await setCustodianAccount(fund.id, accountId);
    void dispatch(fetchAccounts());
  }, `Confirmed. ${fund.ownerName} can see it arrived.`);

  const confirm = (title: string, message: string, label: string, onYes: () => void) => {
    Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: onYes }]);
  };

  const voidIt = () => confirm('Void this entry?', 'It stays in the history, crossed out, and stops counting for both of you.', 'Void', () => run(async () => {
    if (isOwner) {
      await SharedFundService.void(fund.id, entry.id, text.trim() || undefined);
      await refreshBooks();
    } else {
      await FundPostingService.undo(fund.id, entry.id, 'record', text.trim() || undefined);
      void dispatch(fetchTransactions());
      void dispatch(fetchAccounts());
    }
  }, 'Entry voided.'));

  const undoAck = () => confirm('Undo confirmation?', 'The deposit goes back to "expected" and leaves your account.', 'Undo', () => run(async () => {
    await FundPostingService.undo(fund.id, entry.id, 'ack');
    void dispatch(fetchTransactions());
    void dispatch(fetchAccounts());
  }, 'Confirmation undone.'));

  const accountChips = (list: Account[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
      {list.map(account => (
        <TouchableOpacity
          key={account.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: accountId === account.id }}
          onPress={() => setAccountId(account.id)}
          className={`mr-2 px-3 py-2.5 rounded-xl border ${accountId === account.id ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
        >
          <Text className={`text-xs font-bold ${accountId === account.id ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`} numberOfLines={1}>{account.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const rows: Array<[string, string | undefined]> = [
    ['When', `${formatDay(entry.date)} · ${formatTime(entry.date)}`],
    ['Recorded by', entry.recordedByUid === myUid ? 'You' : entry.recordedByRole === 'OWNER' ? fund.ownerName : fund.custodianName || 'Custodian'],
    ['From', entry.kind === 'DEPOSIT' ? entry.payerName || fund.ownerName : undefined],
    ['Paid to', entry.recipient],
    ['Category', entry.category],
    ['In your books as', isOwner && entry.ownerCategory ? `${entry.ownerCategory}${entry.ownerPurpose === 'FINANCING' ? ' (not income/expense)' : ''}` : undefined],
    ['Description', entry.description],
    ['Note', entry.note],
    ['Bank reference', entry.reference_number],
    ['Tags', entry.tags?.length ? entry.tags.map(tag => `#${tag}`).join(' ') : undefined],
    ['Status', entry.status === 'PENDING' ? 'Expected, not yet received' : entry.status === 'VOIDED' ? `Voided${entry.voidReason ? `: ${entry.voidReason}` : ''}` : entry.ackAt ? 'Received ✓' : 'Counted'],
  ];

  return (
    <FormSheet visible={!!entry} onClose={onClose} accessibilityLabel="Fund entry" maxHeight="92%">
      <View className="flex-row items-start mb-4">
        <View className="flex-1 mr-3">
          <Text className="text-slate-900 dark:text-white text-lg font-bold" numberOfLines={2}>{entryHeadline(entry, fund)}</Text>
          <Text className={`text-2xl font-bold mt-1 ${entry.kind === 'DEPOSIT' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} adjustsFontSizeToFit numberOfLines={1}>
            {entry.kind === 'DEPOSIT' ? '+' : '−'}{formatCurrency(entry.amount)}
          </Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 items-center justify-center">
          <FontAwesome name="times" size={14} color="#64748b" />
        </TouchableOpacity>
      </View>

      <View className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4 mb-4">
        {rows.filter(([, value]) => !!value).map(([label, value]) => (
          <View key={label} className="flex-row py-1.5">
            <Text className="text-slate-500 dark:text-slate-400 text-xs w-28">{label}</Text>
            <Text className="flex-1 text-slate-900 dark:text-white text-xs font-semibold text-right" numberOfLines={3}>{value}</Text>
          </View>
        ))}
        {entry.splits && entry.splits.length > 0 && (
          <View className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            {entry.splits.map(split => (
              <View key={split.id} className="flex-row justify-between py-1">
                <Text className="text-slate-700 dark:text-slate-300 text-xs">{split.category}{split.description ? ` · ${split.description}` : ''}</Text>
                <Text className="text-slate-900 dark:text-white text-xs font-semibold">{formatCurrency(split.amount)}</Text>
              </View>
            ))}
          </View>
        )}
        {entry.receipt_url ? (
          <TouchableOpacity accessibilityRole="link" accessibilityLabel="View receipt" onPress={() => { void Linking.openURL(entry.receipt_url!).catch(() => undefined); }} className="flex-row items-center mt-3">
            <FontAwesome name="external-link" size={12} color="#0d9488" />
            <Text className="text-teal-700 dark:text-teal-300 text-xs font-bold ml-2">View receipt</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {entry.flag && (
        <View className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 mb-4">
          <Text className="text-amber-800 dark:text-amber-200 text-xs font-bold mb-1">{fund.ownerName} asked</Text>
          <Text className="text-amber-900 dark:text-amber-100 text-sm">{entry.flag.note}</Text>
          {entry.flag.reply ? (
            <>
              <Text className="text-amber-800 dark:text-amber-200 text-xs font-bold mt-3 mb-1">{fund.custodianName || 'Custodian'} answered</Text>
              <Text className="text-amber-900 dark:text-amber-100 text-sm">{entry.flag.reply}</Text>
            </>
          ) : null}
          {entry.flag.resolved ? <Text className="text-emerald-700 dark:text-emerald-300 text-xs font-bold mt-2">Resolved ✓</Text> : null}
        </View>
      )}

      {problem ? <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-xs font-semibold mb-3">{problem}</Text> : null}

      {/* ── Owner: how it counts in my books ── */}
      {isOwner && open && entry.status === 'ACTIVE' && (
        <View className="mb-4">
          <Text className="text-slate-900 dark:text-white text-sm font-bold mb-2">In your books</Text>
          {(entry.kind === 'SPEND' || thirdParty) && (
            <>
              <View className="flex-row gap-2 mb-3">
                {[true, false].map(option => (
                  <TouchableOpacity
                    key={String(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: counts === option }}
                    onPress={() => { setCounts(option); if (thirdParty) setCategory(''); }}
                    className={`flex-1 py-2.5 px-2 rounded-xl border items-center ${counts === option ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                  >
                    <Text className={`text-xs font-bold text-center ${counts === option ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                      {entry.kind === 'SPEND' ? (option ? 'My expense' : 'Not an expense') : option ? 'Income' : 'Not income'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {entry.kind === 'SPEND' || counts ? (
                <CategoryTreeSelect
                  categories={entry.kind === 'SPEND' ? expenseTree : incomeTree}
                  value={category}
                  onChange={setCategory}
                  placeholder={entry.kind === 'SPEND' ? 'Category in my books' : 'Income category'}
                  accessibilityLabel="Category in my books"
                />
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {NOT_INCOME.map(option => (
                    <TouchableOpacity key={option} accessibilityRole="radio" accessibilityState={{ selected: category === option }} onPress={() => setCategory(option)}
                      className={`px-3 py-2 rounded-xl border ${category === option ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                      <Text className={`text-xs font-semibold ${category === option ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
          {(ownerSentIt || entry.kind === 'RETURN') && (
            <>
              <Text className="text-slate-500 dark:text-slate-400 text-xs mb-2">{entry.kind === 'RETURN' ? 'Which of your accounts received it?' : 'Which of your accounts did it come from?'}</Text>
              {accountChips(myAccounts)}
              {entry.kind === 'RETURN' && (
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: remember }} onPress={() => setRemember(!remember)} className="flex-row items-center mb-2">
                  <FontAwesome name={remember ? 'check-square' : 'square-o'} size={16} color={remember ? '#0d9488' : '#94a3b8'} />
                  <Text className="text-slate-700 dark:text-slate-300 text-xs ml-2">Use this account for future returns</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={classify} className="mt-3 rounded-xl py-3 items-center bg-teal-600">
            <Text className="text-white font-bold text-sm">Save to my books</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Custodian: confirm money that arrived ── */}
      {canAck && (
        <View className="mb-4">
          <Text className="text-slate-900 dark:text-white text-sm font-bold mb-2">Did it arrive? Where?</Text>
          {accountChips(myAccounts)}
          <View className="flex-row gap-2">
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={acknowledge} className="flex-1 rounded-xl py-3 items-center bg-teal-600">
              <Text className="text-white font-bold text-sm">Yes, received</Text>
            </TouchableOpacity>
            {entry.status === 'PENDING' && (
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => run(() => SharedFundService.reject(fund.id, entry.id, 'Not received'), 'Marked as not received.')} className="flex-1 rounded-xl py-3 items-center bg-slate-100 dark:bg-slate-800">
                <Text className="text-slate-700 dark:text-slate-300 font-bold text-sm">Not received</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Questions ── */}
      {open && isOwner && (!entry.flag || entry.flag.resolved) && (
        <View className="mb-3">
          <TextInput value={text} onChangeText={setText} placeholder="Ask about this entry" placeholderTextColor="#94a3b8" className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-3 text-slate-900 dark:text-white text-sm mb-2" />
          <TouchableOpacity accessibilityRole="button" disabled={busy || !text.trim()} onPress={() => run(() => SharedFundService.flag(fund.id, entry.id, text.trim()), `${fund.custodianName || 'The custodian'} will see your question.`)} className={`rounded-xl py-3 items-center ${text.trim() ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
            <Text className={`font-bold text-sm ${text.trim() ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>Ask a question</Text>
          </TouchableOpacity>
        </View>
      )}
      {open && isOwner && entry.flag && !entry.flag.resolved && (
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => run(() => SharedFundService.resolve(fund.id, entry.id), 'Question resolved.')} className="rounded-xl py-3 items-center bg-emerald-600 mb-3">
          <Text className="text-white font-bold text-sm">Mark resolved</Text>
        </TouchableOpacity>
      )}
      {open && !isOwner && entry.flag && !entry.flag.resolved && (
        <View className="mb-3">
          <TextInput value={text} onChangeText={setText} placeholder="Your answer" placeholderTextColor="#94a3b8" className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-3 text-slate-900 dark:text-white text-sm mb-2" />
          <TouchableOpacity accessibilityRole="button" disabled={busy || !text.trim()} onPress={() => run(() => SharedFundService.reply(fund.id, entry.id, text.trim()), 'Answer sent.')} className={`rounded-xl py-3 items-center ${text.trim() ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
            <Text className={`font-bold text-sm ${text.trim() ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>Send answer</Text>
          </TouchableOpacity>
        </View>
      )}

      {canUnack && (
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={undoAck} className="rounded-xl py-3 items-center bg-slate-100 dark:bg-slate-800 mb-3">
          <Text className="text-slate-700 dark:text-slate-300 font-bold text-sm">Undo "received"</Text>
        </TouchableOpacity>
      )}
      {canVoid && (
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={voidIt} className="rounded-xl py-3 items-center border border-rose-200 dark:border-rose-900">
          <Text className="text-rose-600 dark:text-rose-400 font-bold text-sm">Void entry</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}
