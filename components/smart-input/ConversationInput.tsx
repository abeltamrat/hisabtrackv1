import CoinLoader from '@/components/CoinLoader';
import type { Category } from '@/context/TransactionContext';
import { DraftTransactionService, type DraftTransaction } from '@/services/DraftTransactionService';
import { InputDraftService } from '@/services/InputDraftService';
import MelaService, { type MelaProject } from '@/services/MelaService';
import RecipientIdentityService, { type RecipientProfile } from '@/services/RecipientIdentityService';
import {
  continueTransactionConversation,
  conversationFingerprint,
  createTransactionConversation,
  refreshConversationReferences,
  selectTransactionEvidence,
  type TransactionConversationScope,
  type TransactionEvidenceCandidate,
} from '@/services/TransactionConversationService';
import type { Account, Transaction } from '@/types/database';
import { Alert } from '@/utils/alert';
import { FontAwesome } from '@expo/vector-icons';
import type { Router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

interface Props {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  smsDrafts: DraftTransaction[];
  currency: string;
  formatCurrency: (amount: number) => string;
  router: Router;
  aiSharingEnabled: boolean;
  keys: { topToolsApiKey?: string; groqApiKey?: string; geminiApiKey?: string };
}

const sourceLabel = (source?: string) => source === 'SMS' ? 'SMS evidence' : source === 'TRANSACTION' ? 'recorded transaction' : source === 'AI' ? 'AI extracted' : source === 'USER' ? 'you' : undefined;

export default function ConversationInput({ accounts, categories, transactions, smsDrafts, currency, formatCurrency, router, aiSharingEnabled, keys }: Props) {
  const [state, setState] = useState(createTransactionConversation);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<RecipientProfile[]>([]);
  const [projects, setProjects] = useState<MelaProject[]>([]);
  useEffect(() => { void Promise.all([RecipientIdentityService.getAll(), MelaService.getProjects()]).then(([savedPeople, savedProjects]) => { setPeople(savedPeople); setProjects(savedProjects); }); }, []);
  const scope = useMemo<TransactionConversationScope>(() => ({ accounts, categories, transactions, smsDrafts, currency, people, projects }), [accounts, categories, currency, people, projects, smsDrafts, transactions]);
  useEffect(() => { if (people.length || projects.length) setState(current => refreshConversationReferences(current, scope)); }, [people, projects, scope]);
  const hasProvider = !!(keys.topToolsApiKey?.trim() || keys.groqApiKey?.trim() || keys.geminiApiKey?.trim());
  const proposal = state.proposal;

  const send = async (preset?: string) => {
    const text = (preset ?? answer).trim();
    if (!text || busy) return;
    setAnswer('');
    setBusy(true);
    try {
      const next = await continueTransactionConversation(state, text, scope, { useAI: aiSharingEnabled && hasProvider, keys });
      setState(next);
    } catch (error: any) {
      Alert.alert('Could not understand that', error?.message || 'Please try a shorter answer.');
    } finally { setBusy(false); }
  };

  const chooseEvidence = (candidate: TransactionEvidenceCandidate) => setState(current => selectTransactionEvidence(current, candidate, scope));

  const review = async () => {
    if (!state.ready || !proposal.type || !proposal.amount || !proposal.accountId || !proposal.date) {
      return Alert.alert('More details needed', state.question);
    }
    try {
      const selected = proposal.selectedEvidence;
      if (selected?.kind === 'SMS') {
        const sms = smsDrafts.find(item => item.id === selected.id);
        if (!sms || sms.status !== 'PENDING') return Alert.alert('SMS changed', 'That SMS is no longer pending. Restart the conversation to check the latest data.');
        await DraftTransactionService.updateMany([{ id: sms.id, patch: {
          category: proposal.category || sms.category,
          sender_receiver: proposal.recipient || sms.sender_receiver,
          person_id: proposal.personId || sms.person_id,
          person_name_snapshot: proposal.personName || sms.person_name_snapshot,
          person_link_source: proposal.personId ? 'SMS_CONFIRMED' : sms.person_link_source,
          description: proposal.description || sms.description,
          suggested_splits: proposal.splits.length ? proposal.splits : sms.suggested_splits,
          suggested_project: proposal.project || sms.suggested_project,
          is_loan_disbursement: !!proposal.loanKind || sms.is_loan_disbursement,
          suggested_loan_due_date: proposal.loanDueDate || sms.suggested_loan_due_date,
        } }]);
        router.push({ pathname: '/draft-transactions', params: { draftId: sms.id } });
        return;
      }
      const fingerprint = conversationFingerprint(proposal);
      if (!selected && await InputDraftService.isUsed(fingerprint)) return Alert.alert('Already recorded', 'This conversation proposal was already saved. Review your transactions or start over.');
      const draft = await InputDraftService.save({
        source: 'CONVERSATION',
        fingerprint,
        amount: proposal.amount,
        accountId: proposal.accountId,
        toAccountId: proposal.toAccountId,
        type: proposal.type,
        category: proposal.category,
        recipient: proposal.recipient,
        personId: proposal.personId,
        personName: proposal.personName,
        description: proposal.description,
        date: proposal.date,
        tags: proposal.tags,
        splits: proposal.splits,
        project: proposal.project,
        loanKind: proposal.loanKind,
        loanDueDate: proposal.loanDueDate,
        matchedTransactionId: selected?.kind === 'TRANSACTION' ? selected.id : undefined,
      });
      router.push({ pathname: '/modal', params: { draft: draft.id, ...(draft.matchedTransactionId ? { edit: draft.matchedTransactionId } : {}) } });
    } catch (error: any) { Alert.alert('Could not prepare review', error?.message || 'Please try again.'); }
  };

  const restart = () => { setState(createTransactionConversation()); setAnswer(''); };
  const accountName = accounts.find(item => item.id === proposal.accountId)?.name;
  const destinationName = accounts.find(item => item.id === proposal.toAccountId)?.name;
  const rows = [
    ['Type', proposal.type, sourceLabel(proposal.provenance.type)],
    ['Amount', proposal.amount ? formatCurrency(proposal.amount) : undefined, sourceLabel(proposal.provenance.amount)],
    ['Account', accountName, sourceLabel(proposal.provenance.account)],
    ...(proposal.type === 'TRANSFER' ? [['To account', destinationName, sourceLabel(proposal.provenance.destination)]] : []),
    ['Person', proposal.recipient || (proposal.skipped.includes('recipient') ? 'Unknown / skipped' : undefined), sourceLabel(proposal.provenance.recipient)],
    ...(proposal.personId ? [['People link', proposal.personName || 'Saved person', sourceLabel(proposal.provenance.person)]] : []),
    ['Category', proposal.type === 'TRANSFER' ? 'Transfer' : proposal.category, sourceLabel(proposal.provenance.category)],
    ...(proposal.project ? [['Project', `${proposal.project.code ? `${proposal.project.code} · ` : ''}${proposal.project.title}`, sourceLabel(proposal.provenance.project)]] : []),
    ...(proposal.loanKind ? [['Loan', `${proposal.loanKind === 'LENT' ? 'Given' : 'Borrowed'}${proposal.loanDueDate ? ` · due ${new Date(proposal.loanDueDate).toLocaleDateString()}` : ''}`, sourceLabel(proposal.provenance.loan)]] : []),
    ['Date', proposal.date ? new Date(proposal.date).toLocaleDateString() : undefined, sourceLabel(proposal.provenance.date)],
  ];

  return <>
    <View className="bg-indigo-950 dark:bg-slate-800 rounded-2xl p-4 mb-3 border border-indigo-700/60">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 pr-3"><View className="w-10 h-10 rounded-xl bg-indigo-600 items-center justify-center"><FontAwesome name="comments" size={18} color="white" /></View><View className="ml-3 flex-1"><Text className="text-white font-bold">Talk to Hisab</Text><Text className="text-indigo-200 text-xs">Type or use your keyboard microphone</Text></View></View>
        <TouchableOpacity accessibilityLabel="Restart conversation" onPress={restart} className="w-9 h-9 rounded-xl bg-white/10 items-center justify-center"><FontAwesome name="refresh" size={15} color="#c7d2fe" /></TouchableOpacity>
      </View>
      <Text className="text-indigo-200 text-xs mt-3">{aiSharingEnabled && hasProvider ? `AI-assisted${state.provider ? ` via ${state.provider}` : ''}. Real account and SMS matches are checked by the app.` : 'Private local clarification is active. Configure an AI provider for language-aware extraction.'}</Text>
    </View>

    <View className="mb-3">
      {state.messages.slice(-6).map(message => <View key={message.id} className={`max-w-[88%] rounded-2xl p-3 mb-2 ${message.role === 'user' ? 'bg-indigo-600 self-end' : 'bg-white dark:bg-slate-800 self-start'}`}><Text className={message.role === 'user' ? 'text-white' : 'text-slate-800 dark:text-slate-100'}>{message.text}</Text></View>)}
      {busy ? <View className="bg-white dark:bg-slate-800 self-start rounded-2xl px-4 py-3"><CoinLoader /><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">Understanding and checking evidence…</Text></View> : null}
    </View>

    <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3">
      <TextInput value={answer} onChangeText={setAnswer} onSubmitEditing={() => void send()} editable={!busy} multiline placeholder={state.pendingField === 'details' ? 'Add details, or say done' : 'Type your answer…'} placeholderTextColor="#94a3b8" className="min-h-[72px] rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white p-3" />
      <View className="flex-row items-center mt-2"><View className="flex-1 pr-2"><Text className="text-[10px] text-slate-500 dark:text-slate-400">Tap the microphone on your phone keyboard to dictate. In-app recording will come with the next APK.</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Send answer" disabled={!answer.trim() || busy} onPress={() => void send()} className={`w-12 h-12 rounded-xl items-center justify-center ${answer.trim() && !busy ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}><FontAwesome name="send" size={16} color="white" /></TouchableOpacity></View>
    </View>

    {state.candidates.length && !proposal.selectedEvidence && state.pendingField === 'evidence' ? <View className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 mb-3"><Text className="text-amber-900 dark:text-amber-100 font-bold">Choose the real payment</Text><Text className="text-amber-700 dark:text-amber-300 text-xs mt-1 mb-3">Amount alone never links a transaction. Compare the account, date and description.</Text>{state.candidates.map(candidate => <TouchableOpacity key={`${candidate.kind}:${candidate.id}`} onPress={() => chooseEvidence(candidate)} className="bg-white dark:bg-slate-900 rounded-xl p-3 mb-2 border border-amber-200 dark:border-amber-900"><View className="flex-row justify-between"><Text className="font-bold text-slate-900 dark:text-white flex-1" numberOfLines={1}>{candidate.description}</Text><Text className="text-indigo-600 dark:text-indigo-300 font-bold ml-2">{formatCurrency(candidate.amount)}</Text></View><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{candidate.kind === 'SMS' ? 'Pending SMS' : 'Already recorded'} · {candidate.accountName || 'Unknown account'} · {new Date(candidate.date).toLocaleString()}</Text><Text className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">{candidate.reasons.join(' · ')}</Text></TouchableOpacity>)}<TouchableOpacity onPress={() => void send('none')} className="p-2"><Text className="text-amber-800 dark:text-amber-200 text-center font-bold">None of these</Text></TouchableOpacity></View> : null}

    {(proposal.amount || proposal.type || proposal.accountId) ? <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><View className="flex-row items-center justify-between mb-3"><Text className="font-bold text-slate-900 dark:text-white">Live proposal</Text><Text className={`text-xs font-bold ${state.ready ? 'text-emerald-500' : 'text-amber-500'}`}>{state.ready ? 'READY TO REVIEW' : 'NEEDS AN ANSWER'}</Text></View>{rows.map(([label, value, source]) => <View key={label} className="flex-row py-2 border-b border-slate-100 dark:border-slate-700"><Text className="text-slate-500 dark:text-slate-400 w-20">{label}</Text><View className="flex-1"><Text className="text-slate-900 dark:text-white font-semibold">{value || 'Not set'}</Text>{source ? <Text className="text-[10px] text-slate-600 dark:text-slate-400">from {source}</Text> : null}</View></View>)}{proposal.splits.length > 1 ? <Text className="text-xs text-indigo-500 mt-3">{proposal.splits.length} split parts · total {formatCurrency(proposal.splits.reduce((sum, item) => sum + item.amount, 0))}</Text> : null}{proposal.selectedEvidence ? <View className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-3 mt-3"><Text className="text-emerald-700 dark:text-emerald-300 text-xs"><FontAwesome name="link" /> Linked for review to {proposal.selectedEvidence.kind === 'SMS' ? 'a pending SMS' : 'an existing transaction'}. Original bank evidence stays unchanged.</Text></View> : null}</View> : null}

    <TouchableOpacity disabled={!state.ready || busy} onPress={() => void review()} className={`rounded-2xl p-4 ${state.ready && !busy ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}><Text className="text-white text-center font-bold"><FontAwesome name="check-circle" /> Review in transaction editor</Text></TouchableOpacity>
    <Text className="text-center text-[10px] text-slate-500 dark:text-slate-400 mt-2">Nothing is added to your ledger until you review and save it in the normal transaction screen.</Text>
  </>;
}
