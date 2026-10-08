import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { CommunityGroupService } from '@/services/CommunityGroupService';
import { DraftTransactionService, type DraftTransaction } from '@/services/DraftTransactionService';
import type { CommunityGroup, CommunityScheduleItem } from '@/types/community';
import { communityPosition, matchCommunitySms, type CommunitySmsMatch } from '@/utils/communityFinance';
import { formatCalendarDate, parseEthiopianDate } from '@/utils/ethiopianCalendar';
import { Alert } from '@/utils/alert';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { communityCopy } from '@/utils/communityCopy';

const dateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseGregorian = (value: string) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()); if (!match) return null; const date = new Date(+match[1], +match[2] - 1, +match[3], 12); return date.getFullYear() === +match[1] && date.getMonth() === +match[2] - 1 && date.getDate() === +match[3] ? date : null; };

export default function CommunityScreen() {
  const router = useRouter(), dispatch = useDispatch<AppDispatch>();
  const { actualTheme } = useTheme();
  const { formatCurrency, calendarSystem, language } = useAppSettings();
  const c = React.useCallback((key: Parameters<typeof communityCopy>[1]) => communityCopy(language, key), [language]);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const [groups, setGroups] = React.useState<CommunityGroup[]>([]), [drafts, setDrafts] = React.useState<DraftTransaction[]>([]);
  const [showCreate, setShowCreate] = React.useState(false), [busy, setBusy] = React.useState(false);
  const [entry, setEntry] = React.useState<{ group: CommunityGroup; item?: CommunityScheduleItem; kind: 'CONTRIBUTION' | 'PAYOUT' } | null>(null);
  const [entryAmount, setEntryAmount] = React.useState(''), [entryFee, setEntryFee] = React.useState('0');
  const [form, setForm] = React.useState({ kind: 'EQUB' as 'EQUB' | 'IDDIR', name: '', accountId: '', amount: '', rounds: '12', frequency: 'MONTHLY' as 'WEEKLY' | 'MONTHLY', start: dateInput(new Date()), ethiopianStart: '', turn: '', payout: '', members: '', recoverable: false, reminders: true, reminderDays: '1' });
  const load = React.useCallback(async () => { const [saved, sms] = await Promise.all([CommunityGroupService.getAll(), DraftTransactionService.getAll()]); setGroups(saved); setDrafts(sms.filter(row => row.status !== 'REJECTED')); }, []);
  React.useEffect(() => { void load(); if (!accounts.length) void dispatch(fetchAccounts()); }, [accounts.length, dispatch, load]);
  React.useEffect(() => { if (!form.accountId && accounts[0]) setForm(value => ({ ...value, accountId: accounts[0].id })); }, [accounts, form.accountId]);

  const run = async (job: () => Promise<unknown>) => { setBusy(true); try { await job(); await load(); setEntry(null); } catch (error: any) { Alert.alert(c('couldNotSave'), error?.message || c('retry')); } finally { setBusy(false); } };
  const create = () => run(async () => {
    const start = (calendarSystem !== 'GREGORIAN' && form.ethiopianStart.trim() ? parseEthiopianDate(form.ethiopianStart) : null) || parseGregorian(form.start);
    if (!start) throw new Error('Enter a valid start date. Ethiopian dates use YYYY-MM-DD.');
    const account = accounts.find(row => row.id === form.accountId); if (!account) throw new Error('Choose an account');
    const members = form.members.split(/\r?\n/).map((line, index) => { const [name, turn, phone] = line.split(':').map(value => value.trim()); return { name, turn: Number(turn) || index + 1, phone: phone || undefined }; }).filter(member => member.name);
    await CommunityGroupService.create({ kind: form.kind, name: form.name, accountId: account.id, currency: account.currency, contributionAmount: Number(form.amount), rounds: Number(form.rounds), frequency: form.frequency, startDate: start.getTime(), myTurn: form.turn ? Number(form.turn) : undefined, payoutAmount: form.payout ? Number(form.payout) : undefined, members, recoverable: form.recoverable, calendarSystem: calendarSystem === 'ETHIOPIAN' ? 'ETHIOPIAN' : 'GREGORIAN', reminderEnabled: form.reminders, reminderDaysBefore: Number(form.reminderDays) });
    setShowCreate(false); setForm(value => ({ ...value, name: '', amount: '', turn: '', payout: '' }));
  });
  const saveEntry = () => { if (!entry) return; const amount = Number(entryAmount), fee = Number(entryFee || 0); void run(() => entry.kind === 'CONTRIBUTION' ? CommunityGroupService.recordContribution(entry.group.id, entry.item!.id, amount, fee) : CommunityGroupService.recordPayout(entry.group.id, amount, fee)); };
  const openContribution = (group: CommunityGroup, item: CommunityScheduleItem) => { setEntry({ group, item, kind: 'CONTRIBUTION' }); setEntryAmount(String(Math.max(0, item.amountDue - item.amountPaid))); setEntryFee('0'); };
  const openPayout = (group: CommunityGroup) => { setEntry({ group, kind: 'PAYOUT' }); setEntryAmount(String(group.payoutAmount || '')); setEntryFee('0'); };
  const smsMatches = React.useMemo(() => drafts.flatMap(draft => matchCommunitySms(draft, groups).slice(0, 1).map(match => ({ draft, match }))), [drafts, groups]);

  return <View className="flex-1 bg-slate-50 dark:bg-background-dark">
    <Stack.Screen options={{ headerShown: false }} /><StatusBar style="light" />
    <LinearGradient colors={actualTheme === 'dark' ? ['#134e4a', '#0f172a'] : ['#0f766e', '#14b8a6']} className="px-5 pt-6 pb-7 rounded-b-[30px]">
      <View className="flex-row items-center justify-between"><TouchableOpacity accessibilityLabel={c('back')} onPress={() => router.back()} className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center"><FontAwesome name="arrow-left" size={17} color="#fff" /></TouchableOpacity><View className="items-center"><Text className="text-white text-xl font-bold">{c('title')}</Text><Text className="text-teal-50 text-xs">{c('subtitle')}</Text></View><TouchableOpacity accessibilityLabel={c('create')} onPress={() => setShowCreate(true)} className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center"><FontAwesome name="plus" size={17} color="#fff" /></TouchableOpacity></View>
    </LinearGradient>
    <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 50 }}>
      <View className="rounded-2xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 p-4 mb-4"><Text className="text-teal-900 dark:text-teal-100 font-bold">{c('accountingTitle')}</Text><Text className="text-teal-800 dark:text-teal-200 text-xs mt-1">{c('accountingBody')}</Text></View>
      {!groups.length && <View className="bg-white dark:bg-slate-800 rounded-3xl p-7 items-center"><FontAwesome name="users" size={32} color="#0d9488" /><Text className="text-slate-900 dark:text-white font-bold text-lg mt-3">{c('firstTitle')}</Text><Text className="text-slate-500 dark:text-slate-400 text-center text-sm mt-1">{c('firstBody')}</Text><TouchableOpacity onPress={() => setShowCreate(true)} className="bg-teal-600 rounded-xl px-5 py-3 mt-4"><Text className="text-white font-bold">{c('firstButton')}</Text></TouchableOpacity></View>}
      {groups.map(group => <GroupCard key={group.id} group={group} formatCurrency={formatCurrency} calendarSystem={calendarSystem} c={c} onContribution={openContribution} onPayout={openPayout} onMissed={item => void run(() => CommunityGroupService.markMissed(group.id, item.id))} onUndo={() => void run(() => CommunityGroupService.undoLast(group.id))} onDefault={() => void run(() => CommunityGroupService.setDefaulted(group.id, group.status !== 'DEFAULTED'))} />)}
      {!!smsMatches.length && <View className="mt-3 mb-5"><Text className="text-slate-900 dark:text-white font-bold text-base mb-2">{c('smsMatches')}</Text>{smsMatches.map(({ draft, match }) => <SmsMatch key={`${draft.id}-${match.groupId}`} draft={draft} match={match} group={groups.find(row => row.id === match.groupId)!} c={c} onReview={() => router.push({ pathname: '/draft-transactions', params: { draftId: draft.id, communityGroupId: match.groupId, communityScheduleId: match.scheduleId || '', communityKind: match.kind } } as any)} />)}</View>}
    </ScrollView>

    <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}><View className="flex-1 bg-black/50 justify-end"><ScrollView className="max-h-[92%] bg-white dark:bg-slate-900 rounded-t-[30px] px-5 pt-5" contentContainerStyle={{ paddingBottom: 40 }}><View className="flex-row justify-between mb-4"><Text className="text-slate-900 dark:text-white text-xl font-bold">{c('newGroup')}</Text><TouchableOpacity accessibilityLabel={c('close')} onPress={() => setShowCreate(false)}><FontAwesome name="times" size={22} color="#64748b" /></TouchableOpacity></View>
      <Label text={c('type')}/><View className="flex-row gap-2 mb-3">{(['EQUB','IDDIR'] as const).map(kind => <Choice key={kind} selected={form.kind===kind} label={kind==='EQUB'?c('equbSavings'):c('iddirSupport')} onPress={() => setForm({...form,kind})}/>)}</View>
      <Field label={c('groupName')} value={form.name} onChangeText={(name: string) => setForm({...form,name})} placeholder={c('groupPlaceholder')} />
      <Label text={c('account')}/><ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">{accounts.map(account => <Choice key={account.id} selected={form.accountId===account.id} label={account.name} onPress={() => setForm({...form,accountId:account.id})}/>)}</ScrollView>
      <View className="flex-row gap-2"><View className="flex-1"><Field label={c('eachContribution')} value={form.amount} onChangeText={(amount: string) => setForm({...form,amount})} keyboardType="decimal-pad" /></View><View className="flex-1"><Field label={c('rounds')} value={form.rounds} onChangeText={(rounds: string) => setForm({...form,rounds})} keyboardType="number-pad" /></View></View>
      <Label text={c('frequency')}/><View className="flex-row gap-2 mb-3"><Choice selected={form.frequency==='WEEKLY'} label={c('weekly')} onPress={() => setForm({...form,frequency:'WEEKLY'})}/><Choice selected={form.frequency==='MONTHLY'} label={c('monthly')} onPress={() => setForm({...form,frequency:'MONTHLY'})}/></View>
      <Field label={c('gregorianStart')} value={form.start} onChangeText={(start: string) => setForm({...form,start})} />
      {calendarSystem !== 'GREGORIAN' && <Field label={c('ethiopianStart')} value={form.ethiopianStart} onChangeText={(ethiopianStart: string) => setForm({...form,ethiopianStart})} placeholder="2019-01-01" />}
      {form.kind==='EQUB' && <View className="flex-row gap-2"><View className="flex-1"><Field label={c('payoutTurn')} value={form.turn} onChangeText={(turn: string) => setForm({...form,turn})} keyboardType="number-pad" /></View><View className="flex-1"><Field label={c('expectedPayout')} value={form.payout} onChangeText={(payout: string) => setForm({...form,payout})} keyboardType="decimal-pad" /></View></View>}
      <Field label={c('membersInput')} value={form.members} onChangeText={(members: string) => setForm({...form,members})} multiline placeholder={'Abel:1:0911000000\nDawit:2'} />
      {form.kind==='IDDIR' && <View className="flex-row items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800 mb-3"><View className="flex-1 pr-3"><Text className="text-slate-900 dark:text-white font-semibold">{c('recoverable')}</Text><Text className="text-slate-500 dark:text-slate-400 text-xs">{c('recoverableBody')}</Text></View><Switch value={form.recoverable} onValueChange={recoverable => setForm({...form,recoverable})} /></View>}
      <View className="flex-row items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800 mb-3"><Text className="text-slate-900 dark:text-white font-semibold">{c('reminders')}</Text><Switch value={form.reminders} onValueChange={reminders => setForm({...form,reminders})} /></View>
      {form.reminders && <Field label={c('daysBefore')} value={form.reminderDays} onChangeText={(reminderDays: string) => setForm({...form,reminderDays})} keyboardType="number-pad" />}
      <TouchableOpacity disabled={busy} onPress={create} className="bg-teal-600 rounded-2xl py-4 items-center mt-2"><Text className="text-white font-bold">{busy?c('saving'):c('createSchedule')}</Text></TouchableOpacity>
    </ScrollView></View></Modal>
    <Modal visible={!!entry} transparent animationType="fade" onRequestClose={() => setEntry(null)}><View className="flex-1 bg-black/50 justify-center px-5"><View className="bg-white dark:bg-slate-900 rounded-3xl p-5"><Text className="text-slate-900 dark:text-white text-lg font-bold">{c('record')} {entry?.kind === 'PAYOUT' ? c('payout') : c('contribution')}</Text><Text className="text-slate-500 dark:text-slate-400 text-xs mt-1 mb-4">{c('feeBody')}</Text><Field label={c('principal')} value={entryAmount} onChangeText={setEntryAmount} keyboardType="decimal-pad"/><Field label={c('bankFee')} value={entryFee} onChangeText={setEntryFee} keyboardType="decimal-pad"/><View className="flex-row gap-2 mt-2"><TouchableOpacity onPress={() => setEntry(null)} className="flex-1 bg-slate-100 dark:bg-slate-800 py-3 rounded-xl items-center"><Text className="text-slate-700 dark:text-white font-bold">{c('cancel')}</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={saveEntry} className="flex-1 bg-teal-600 py-3 rounded-xl items-center"><Text className="text-white font-bold">{c('save')}</Text></TouchableOpacity></View></View></View></Modal>
  </View>;
}

function GroupCard({ group, formatCurrency, calendarSystem, c, onContribution, onPayout, onMissed, onUndo, onDefault }: { group: CommunityGroup; formatCurrency:(n:number)=>string; calendarSystem:any; c:(key:Parameters<typeof communityCopy>[1])=>string; onContribution:(g:CommunityGroup,i:CommunityScheduleItem)=>void; onPayout:(g:CommunityGroup)=>void; onMissed:(i:CommunityScheduleItem)=>void; onUndo:()=>void; onDefault:()=>void }) {
  const position = communityPosition(group), next = group.schedule.find(item => item.status !== 'PAID');
  return <View className="bg-white dark:bg-slate-800 rounded-3xl p-5 mb-4 border border-slate-100 dark:border-slate-700"><View className="flex-row justify-between"><View><Text className="text-teal-600 dark:text-teal-300 text-xs font-bold">{group.kind} · {group.status}</Text><Text className="text-slate-900 dark:text-white text-lg font-bold">{group.name}</Text></View><Text className={`font-bold ${position.claim < 0 ? 'text-amber-600' : 'text-teal-600'}`}>{position.claim < 0 ? c('obligation') : group.kind==='EQUB'||group.recoverable?c('claim'):c('spent')}{` ${formatCurrency(Math.abs(position.claim || position.contributed))}`}</Text></View>
    <View className="flex-row mt-4 gap-2"><Metric label={c('contributed')} value={formatCurrency(position.contributed)}/><Metric label={c('payouts')} value={formatCurrency(position.payouts)}/><Metric label={c('remaining')} value={formatCurrency(position.outstandingObligation)}/></View>
    {group.payoutDate && <Text className="text-slate-500 dark:text-slate-400 text-xs mt-3">{c('yourTurn')}: {group.myTurn} · {formatCalendarDate(group.payoutDate, calendarSystem)}</Text>}
    {!!group.members.length && <Text className="text-slate-500 dark:text-slate-400 text-xs mt-1">{c('members')}: {[...group.members].sort((a,b)=>a.turn-b.turn).map(member => `${member.turn}. ${member.name}`).join(' · ')}</Text>}
    {next && <View className="mt-3 rounded-2xl bg-slate-50 dark:bg-slate-900 p-3"><Text className="text-slate-900 dark:text-white font-semibold">{next.status} · {formatCalendarDate(next.dueDate, calendarSystem)}</Text><Text className="text-slate-500 dark:text-slate-400 text-xs">{formatCurrency(next.amountPaid)} / {formatCurrency(next.amountDue)}</Text><View className="flex-row gap-2 mt-3"><SmallButton label={next.amountPaid ? c('payBalance') : c('recordPayment')} onPress={() => onContribution(group,next)}/><SmallButton label={c('missed')} secondary onPress={() => onMissed(next)}/></View></View>}
    <View className="flex-row flex-wrap gap-2 mt-3"><SmallButton label={c('recordPayout')} onPress={() => onPayout(group)}/>{group.audit.some(row=>!row.undone&&row.action!=='UNDO') && <SmallButton label={c('undo')} secondary onPress={onUndo}/>}<SmallButton label={group.status==='DEFAULTED'?c('reopen'):c('markDefault')} secondary onPress={onDefault}/></View>
    {!!group.audit.length && <View className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-2">{group.audit.slice(-3).reverse().map(row=><Text key={row.id} className="text-slate-500 dark:text-slate-400 text-xs">{row.undone?'↶ ':''}{row.description}</Text>)}</View>}
  </View>;
}
function SmsMatch({ draft, match, group, c, onReview }:{draft:DraftTransaction;match:CommunitySmsMatch;group:CommunityGroup;c:(key:Parameters<typeof communityCopy>[1])=>string;onReview:()=>void}) { return <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-2"><Text className="text-slate-900 dark:text-white font-bold">{group.name}: {c('possible')} {match.kind === 'PAYOUT' ? c('payout') : c('contribution')}</Text><Text className="text-slate-500 dark:text-slate-400 text-xs mt-1">{draft.amount.toFixed(2)} · {match.reasons.join(', ')} · {c('confidence')} {match.score}</Text><TouchableOpacity onPress={onReview} className="mt-3 self-start bg-teal-50 dark:bg-teal-950 rounded-lg px-3 py-2"><Text className="text-teal-700 dark:text-teal-300 font-bold text-xs">{c('reviewSms')}</Text></TouchableOpacity></View> }
function Label({text}:{text:string}) { return <Text className="text-slate-600 dark:text-slate-300 text-xs font-bold mb-1">{text}</Text> }
function Field(props:any) { const {label,...rest}=props; return <View className="mb-3"><Label text={label}/><TextInput {...rest} placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl px-3 py-3"/></View> }
function Choice({selected,label,onPress}:{selected:boolean;label:string;onPress:()=>void}) { return <TouchableOpacity onPress={onPress} className={`px-4 py-3 rounded-xl border ${selected?'bg-teal-600 border-teal-600':'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}><Text className={selected?'text-white font-bold':'text-slate-700 dark:text-white font-semibold'}>{label}</Text></TouchableOpacity> }
function Metric({label,value}:{label:string;value:string}) { return <View className="flex-1 bg-slate-50 dark:bg-slate-900 rounded-xl p-2"><Text className="text-slate-500 dark:text-slate-400 text-[10px]">{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit className="text-slate-900 dark:text-white font-bold text-xs">{value}</Text></View> }
function SmallButton({label,onPress,secondary=false}:{label:string;onPress:()=>void;secondary?:boolean}) { return <TouchableOpacity onPress={onPress} className={`rounded-lg px-3 py-2 ${secondary?'bg-slate-100 dark:bg-slate-700':'bg-teal-600'}`}><Text className={`font-bold text-xs ${secondary?'text-slate-700 dark:text-white':'text-white'}`}>{label}</Text></TouchableOpacity> }
