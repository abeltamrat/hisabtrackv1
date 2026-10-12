import FormSheet from '@/components/FormSheet';
import PhoneContactPicker from '@/components/PhoneContactPicker';
import type { DeviceContact } from '@/services/DeviceContactsService';
import RecipientIdentityService, { DEFAULT_PERSON_GROUPS, type RecipientProfile } from '@/services/RecipientIdentityService';
import HisabUserBadge from '@/components/HisabUserBadge';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTransactions } from '@/context/TransactionContext';
import type { Transaction } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import PeopleFinancialService, { type PeopleDossier, type PeopleMovement } from '@/services/PeopleFinancialService';
import FundSyncService from '@/services/FundSyncService';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';

type Direction = 'ALL' | 'SENT' | 'RECEIVED';
type Period = 'ALL' | 'MONTH' | '30_DAYS';

const allocationForCategory = (transaction: Transaction, categoryScope?: Set<string>) => {
  if (!categoryScope) return transaction.amount;
  if (transaction.splits?.length) return transaction.splits.filter(split => categoryScope.has(split.category)).reduce((sum, split) => sum + split.amount, 0);
  return categoryScope.has(transaction.category) ? transaction.amount : 0;
};

export default function PersonStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const { categories } = useTransactions();
  const [movements, setMovements] = useState<PeopleMovement[]>([]);
  const [dossier, setDossier] = useState<PeopleDossier>({ movements: [], loans: [], recurring: [], communities: [], funds: [] });
  const [person, setPerson] = useState<RecipientProfile>();
  const [allPeople, setAllPeople] = useState<RecipientProfile[]>([]);
  const [direction, setDirection] = useState<Direction>('ALL');
  const [period, setPeriod] = useState<Period>('ALL');
  const [category, setCategory] = useState('All');
  const [tag, setTag] = useState('All');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [customGroup, setCustomGroup] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [phoneContactsOpen, setPhoneContactsOpen] = useState(false);

  const load = React.useCallback(async () => {
    const [items, recurring] = await Promise.all([RecipientIdentityService.getAll(), RecurringTransactionService.getAll()]);
    const found = items.find(item => item.id === id);
    const relationship = found
      ? await PeopleFinancialService.getDossier(found, items, undefined, FundSyncService.getSnapshot().funds, recurring)
      : { movements: [], loans: [], recurring: [], communities: [], funds: [] };
    setAllPeople(items); setMovements(relationship.movements); setDossier(relationship);
    setPerson(found); setName(found?.displayName || ''); setGroups(found?.groups || []); setPhone(found?.phone || ''); setEmail(found?.email || ''); setNotes(found?.notes || '');
  }, [id]);
  useEffect(() => { void load(); const unsubscribe = LocalChangeEmitter.subscribe(load); return () => { unsubscribe(); }; }, [load]);
  useEffect(() => FundSyncService.subscribe(() => { void load(); }), [load]);
  const history = useMemo(() => person ? RecipientIdentityService.unifiedHistory(person, movements, allPeople).filter(tx => tx.type !== 'TRANSFER') : [], [allPeople, person, movements]);
  const tags = useMemo(() => ['All', ...new Set(history.flatMap(tx => [...(tx.tags || []), ...(tx.splits || []).flatMap(split => split.tags || [])]))], [history]);
  const categoryNames = useMemo(() => ['All', ...new Set([...categories.map(item => item.name), ...history.flatMap(tx => [tx.category, ...(tx.splits || []).map(split => split.category)])])], [categories, history]);
  const categoryScope = useMemo(() => {
    if (category === 'All') return undefined;
    const selected = categories.find(item => item.name === category);
    if (!selected) return new Set([category]);
    const ids = new Set([selected.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of categories) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; }
    }
    return new Set(categories.filter(item => ids.has(item.id)).map(item => item.name));
  }, [categories, category]);
  const filtered = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const thirtyDays = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return history.filter(tx => {
      if (direction === 'SENT' && tx.type !== 'EXPENSE') return false;
      if (direction === 'RECEIVED' && tx.type !== 'INCOME') return false;
      if (period === 'MONTH' && tx.date < monthStart) return false;
      if (period === '30_DAYS' && tx.date < thirtyDays) return false;
      if (allocationForCategory(tx, categoryScope) <= 0) return false;
      if (tag !== 'All' && ![...(tx.tags || []), ...(tx.splits || []).flatMap(split => split.tags || [])].includes(tag)) return false;
      return true;
    }).sort((a, b) => b.date - a.date);
  }, [categoryScope, direction, history, period, tag]);
  const sent = filtered.filter(tx => tx.type === 'EXPENSE').reduce((sum, tx) => sum + allocationForCategory(tx, categoryScope), 0);
  const received = filtered.filter(tx => tx.type === 'INCOME').reduce((sum, tx) => sum + allocationForCategory(tx, categoryScope), 0);
  const balance = received - sent;

  const save = async () => {
    if (!person || !name.trim()) return;
    try {
      let next = await RecipientIdentityService.update(person.id, { displayName: name, phone, email, notes, groups: [...groups, ...(customGroup.trim() ? [customGroup.trim()] : [])] });
      try { next = await RecipientIdentityService.refreshLinkedAccount(person.id); } catch { /* Keep edits when offline; linking retries on the next edit. */ }
      setPerson(next); setGroups(next.groups || []); setCustomGroup(''); setEditing(false);
    } catch (error: any) { Alert.alert('Could not update person', error?.message || 'Try again.'); }
  };

  const usePhoneContact = (contact: DeviceContact) => {
    setName(contact.name);
    setPhone(contact.phone || '');
    setEmail(contact.email || '');
    setPhoneContactsOpen(false);
    setEditing(true);
  };

  if (!person) return <View className="flex-1 bg-slate-50 dark:bg-background-dark items-center justify-center"><Text className="text-slate-500 dark:text-slate-400">Person not found</Text><TouchableOpacity onPress={() => router.back()} className="mt-4 px-4 py-2 bg-indigo-600 rounded-xl"><Text className="text-white font-bold">Go back</Text></TouchableOpacity></View>;

  return <View className="flex-1 bg-slate-50 dark:bg-background-dark">
    <View className="px-5 pt-5 pb-4 flex-row items-center"><TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity><View className="flex-1 ml-4"><View className="flex-row items-center"><Text numberOfLines={1} className="text-xl font-extrabold text-slate-900 dark:text-white shrink">{person.displayName}</Text><HisabUserBadge linked={!!person.linkedUid} size={21} /></View><Text className="text-xs text-slate-500 dark:text-slate-400">Financial relationship statement</Text></View><TouchableOpacity accessibilityLabel="Edit person" onPress={() => setEditing(true)} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="pencil" size={15} color="#6366f1" /></TouchableOpacity></View>
    <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 36 }}>
      {(person.groups || []).length > 0 && <View className="flex-row flex-wrap gap-2 mb-3">{person.groups!.map(item => <View key={item} className="px-3 py-1.5 rounded-full bg-teal-100 dark:bg-teal-950"><Text className="text-xs font-bold text-teal-700 dark:text-teal-300">{item}</Text></View>)}</View>}
      {person.linkedUid && <View className="flex-row items-center self-start px-3 py-2 rounded-full bg-emerald-100 dark:bg-emerald-950 mb-3"><FontAwesome name="link" size={11} color="#059669" /><Text className="text-xs font-bold text-emerald-700 dark:text-emerald-300 ml-2">Linked to {person.linkedDisplayName || 'a Hisab Track user'}</Text></View>}
      <View className="flex-row gap-2 mb-1"><View className="flex-1 p-3 rounded-2xl bg-red-50 dark:bg-red-950/30"><Text className="text-[10px] font-bold text-red-600 dark:text-red-400">SENT</Text><Text numberOfLines={1} className="text-base font-extrabold text-red-700 dark:text-red-300 mt-1">{formatCurrency(sent)}</Text></View><View className="flex-1 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30"><Text className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">RECEIVED</Text><Text numberOfLines={1} className="text-base font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">{formatCurrency(received)}</Text></View><View className="flex-1 p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30"><Text className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">BALANCE</Text><Text numberOfLines={1} className="text-base font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">{balance >= 0 ? '+' : '-'}{formatCurrency(Math.abs(balance))}</Text></View></View>
      <Text className="text-[10px] text-slate-500 dark:text-slate-400 mb-3">Balance is received minus sent for the selected filters.</Text>

      {(person.phone || person.email || person.notes || person.aliases.length > 1) && <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3"><Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Person details</Text>{person.phone && <Text className="text-xs text-slate-600 dark:text-slate-300 mb-1"><Text className="font-bold">Phone: </Text>{person.phone}</Text>}{person.email && <Text className="text-xs text-slate-600 dark:text-slate-300 mb-1"><Text className="font-bold">Email: </Text>{person.email}</Text>}{person.aliases.length > 1 && <Text className="text-xs text-slate-600 dark:text-slate-300 mb-1"><Text className="font-bold">Also known as: </Text>{person.aliases.filter(alias => alias !== person.displayName).join(', ')}</Text>}{person.notes && <Text className="text-xs text-slate-600 dark:text-slate-300"><Text className="font-bold">Notes: </Text>{person.notes}</Text>}</View>}

      {dossier.loans.length > 0 && <View className="mb-3"><RelationHeading icon="handshake-o" title={`Loans (${dossier.loans.length})`} onPress={() => router.push('/loans' as any)} />{dossier.loans.map(loan => <TouchableOpacity key={loan.id} onPress={() => router.push('/loans' as any)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2"><View className="flex-row justify-between"><Text className="font-bold text-slate-900 dark:text-white">{loan.type === 'BORROWED' ? 'Borrowed from' : 'Lent to'} {loan.lender_borrower_name}</Text><Text className={`text-xs font-bold ${loan.status === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>{loan.status}</Text></View><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">Principal {formatCurrency(loan.principal_amount)} · Remaining {formatCurrency(loan.remaining_balance)} · Due {new Date(loan.due_date).toLocaleDateString()}</Text></TouchableOpacity>)}</View>}

      {dossier.funds.length > 0 && <View className="mb-3"><RelationHeading icon="briefcase" title={`Funds (${dossier.funds.length})`} />{dossier.funds.map(fund => <TouchableOpacity key={fund.fundId} onPress={() => router.push(`/fund/${fund.fundId}` as any)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2"><Text className="font-bold text-slate-900 dark:text-white">{fund.name}</Text><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{fund.movementCount} movement{fund.movementCount === 1 ? '' : 's'} · Sent {formatCurrency(fund.sent)} · Received {formatCurrency(fund.received)}</Text></TouchableOpacity>)}</View>}

      {dossier.communities.length > 0 && <View className="mb-3"><RelationHeading icon="users" title={`Equb & Iddir (${dossier.communities.length})`} onPress={() => router.push('/community' as any)} />{dossier.communities.map(item => <TouchableOpacity key={`${item.groupId}-${item.memberName}`} onPress={() => router.push('/community' as any)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2"><View className="flex-row justify-between"><Text className="font-bold text-slate-900 dark:text-white">{item.name}</Text><Text className="text-xs font-bold text-teal-600 dark:text-teal-300">{item.kind} · {item.status}</Text></View><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.shareCount} share{item.shareCount === 1 ? '' : 's'} · Contributed {formatCurrency(item.contributed)} · Payouts {formatCurrency(item.payouts)}{item.refunds ? ` · Refunds ${formatCurrency(item.refunds)}` : ''}</Text></TouchableOpacity>)}</View>}

      {dossier.recurring.length > 0 && <View className="mb-3"><RelationHeading icon="repeat" title={`Recurring (${dossier.recurring.length})`} onPress={() => router.push('/recurring' as any)} />{dossier.recurring.map(rule => <TouchableOpacity key={rule.id} onPress={() => router.push('/recurring' as any)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2"><View className="flex-row justify-between"><Text className="font-bold text-slate-900 dark:text-white">{rule.name}</Text><Text className={`text-xs font-bold ${rule.isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500'}`}>{rule.isActive ? 'ACTIVE' : 'PAUSED'}</Text></View><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatCurrency(rule.amount)} · {rule.frequency.toLowerCase()} · Next {new Date(rule.nextDate).toLocaleDateString()}</Text></TouchableOpacity>)}</View>}

      <Text className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Money movement history</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">{(['ALL','SENT','RECEIVED'] as Direction[]).map(item => <TouchableOpacity key={item} onPress={() => setDirection(item)} className={`mr-2 px-4 py-2 rounded-full ${direction === item ? 'bg-indigo-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${direction === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item === 'ALL' ? 'All directions' : item === 'SENT' ? 'Sent' : 'Received'}</Text></TouchableOpacity>)}</ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">{([['ALL','All time'],['MONTH','This month'],['30_DAYS','Last 30 days']] as [Period,string][]).map(([value,label]) => <TouchableOpacity key={value} onPress={() => setPeriod(value)} className={`mr-2 px-4 py-2 rounded-full ${period === value ? 'bg-teal-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${period === value ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{label}</Text></TouchableOpacity>)}</ScrollView>
      <Text className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-2 mb-1">CATEGORY</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">{categoryNames.map(item => <TouchableOpacity key={item} onPress={() => setCategory(item)} className={`mr-2 px-3 py-2 rounded-full ${category === item ? 'bg-violet-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${category === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item}</Text></TouchableOpacity>)}</ScrollView>
      {tags.length > 1 && <><Text className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-2 mb-1">TAG</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">{tags.map(item => <TouchableOpacity key={item} onPress={() => setTag(item)} className={`mr-2 px-3 py-2 rounded-full ${tag === item ? 'bg-amber-600' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${tag === item ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item === 'All' ? 'All tags' : `#${item}`}</Text></TouchableOpacity>)}</ScrollView></>}
      <Text className="text-sm font-extrabold text-slate-900 dark:text-white mt-2 mb-3">{filtered.length} matching movement{filtered.length === 1 ? '' : 's'}</Text>
      {filtered.map(tx => { const value = allocationForCategory(tx, categoryScope); return <TouchableOpacity key={tx.id} onPress={() => router.push((tx.people_source === 'MANAGED_EQUB' ? '/community' : `/transaction/${tx.id}`) as any)} className="flex-row items-center p-4 mb-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl"><View className={`w-10 h-10 rounded-xl items-center justify-center mr-3 ${tx.type === 'INCOME' ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-red-100 dark:bg-red-950'}`}><FontAwesome name={tx.type === 'INCOME' ? 'arrow-down' : 'arrow-up'} size={14} color={tx.type === 'INCOME' ? '#059669' : '#dc2626'} /></View><View className="flex-1"><Text numberOfLines={1} className="font-bold text-slate-900 dark:text-white">{tx.description}</Text><Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-1">{new Date(tx.date).toLocaleDateString()} · {category === 'All' ? tx.category : category}{tx.people_source === 'MANAGED_EQUB' ? ' · Managed Equb' : ''}{(tx.tags || []).length ? ` · ${(tx.tags || []).map(item => `#${item}`).join(' ')}` : ''}</Text></View><Text className={`font-extrabold ${tx.type === 'INCOME' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(value)}</Text></TouchableOpacity>; })}
      {filtered.length === 0 && <Text className="text-center text-slate-500 dark:text-slate-400 py-12">No money movements match these filters.</Text>}
    </ScrollView>
    <FormSheet visible={editing} onClose={() => setEditing(false)} accessibilityLabel="Edit person"><Text className="text-lg font-extrabold text-slate-900 dark:text-white mb-4">Edit person</Text><TouchableOpacity onPress={() => { setEditing(false); setPhoneContactsOpen(true); }} className="flex-row items-center p-3 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 mb-4"><View className="w-10 h-10 rounded-full bg-teal-600 items-center justify-center mr-3"><FontAwesome name="address-book" size={15} color="#fff" /></View><View className="flex-1"><Text className="font-bold text-teal-800 dark:text-teal-200">Choose from phone contacts</Text><Text className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">Replace the name, phone and email</Text></View><FontAwesome name="chevron-right" size={12} color="#0d9488" /></TouchableOpacity><Text className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">Name</Text><TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="#94a3b8" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 text-slate-900 dark:text-white" /><TextInput value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor="#94a3b8" keyboardType="phone-pad" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mt-3 text-slate-900 dark:text-white" /><TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor="#94a3b8" keyboardType="email-address" autoCapitalize="none" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mt-3 text-slate-900 dark:text-white" /><TextInput value={notes} onChangeText={setNotes} placeholder="Notes" placeholderTextColor="#94a3b8" multiline className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mt-3 text-slate-900 dark:text-white" /><Text className="text-xs font-bold text-slate-600 dark:text-slate-300 mt-4 mb-2">Groups</Text><View className="flex-row flex-wrap gap-2">{DEFAULT_PERSON_GROUPS.map(item => { const selected = groups.includes(item); return <TouchableOpacity key={item} onPress={() => setGroups(current => selected ? current.filter(value => value !== item) : [...current, item])} className={`px-3 py-2 rounded-full ${selected ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-800'}`}><Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{item}</Text></TouchableOpacity>; })}</View><TextInput value={customGroup} onChangeText={setCustomGroup} placeholder="Add custom group" placeholderTextColor="#94a3b8" className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mt-3 text-slate-900 dark:text-white" /><TouchableOpacity onPress={save} className="mt-6 py-4 bg-indigo-600 rounded-2xl items-center"><Text className="text-white font-extrabold">Save changes</Text></TouchableOpacity></FormSheet>
    <PhoneContactPicker visible={phoneContactsOpen} onClose={() => { setPhoneContactsOpen(false); setEditing(true); }} onSelect={usePhoneContact} />
  </View>;
}

function RelationHeading({ icon, title, onPress }: { icon: string; title: string; onPress?: () => void }) {
  return <TouchableOpacity disabled={!onPress} onPress={onPress} className="flex-row items-center justify-between mb-2"><View className="flex-row items-center"><View className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950 items-center justify-center mr-2"><FontAwesome name={icon as any} size={13} color="#6366f1" /></View><Text className="text-sm font-extrabold text-slate-900 dark:text-white">{title}</Text></View>{onPress && <FontAwesome name="chevron-right" size={11} color="#94a3b8" />}</TouchableOpacity>;
}
