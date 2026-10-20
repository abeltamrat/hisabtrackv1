import CoinLoader from '@/components/CoinLoader';
import type { Category } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import MelaService, { type MelaProject } from '@/services/MelaService';
import RecipientIdentityService, { type RecipientProfile } from '@/services/RecipientIdentityService';
import {
  continueTransactionConversation,
  createSmsTransactionConversation,
  preserveSmsConversationEvidence,
  refreshConversationReferences,
  type ConversationProposal,
  type TransactionConversationScope,
} from '@/services/TransactionConversationService';
import type { Account, LoanType, ProjectLink, Transaction, TransactionSplit, TransactionType } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

interface Props {
  draft: DraftTransaction;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  smsDrafts: DraftTransaction[];
  initial: {
    type: TransactionType;
    accountId: string;
    toAccountId?: string;
    category?: string;
    recipient?: string;
    personId?: string;
    personName?: string;
    description?: string;
    tags?: string[];
    splits?: TransactionSplit[];
    project?: ProjectLink;
    loanKind?: LoanType;
    loanDueDate?: number;
  };
  formatCurrency: (amount: number) => string;
  onApply: (proposal: ConversationProposal) => void;
  onClose: () => void;
}

export default function SmsConversationAssistant({ draft, accounts, categories, transactions, smsDrafts, initial, formatCurrency, onApply, onClose }: Props) {
  const settings = useAppSettings();
  const [people, setPeople] = useState<RecipientProfile[]>([]);
  const [projects, setProjects] = useState<MelaProject[]>([]);
  useEffect(() => { void Promise.all([RecipientIdentityService.getAll(), MelaService.getProjects()]).then(([savedPeople, savedProjects]) => { setPeople(savedPeople); setProjects(savedProjects); }); }, []);
  const scope = useMemo<TransactionConversationScope>(() => ({ accounts, categories, transactions, smsDrafts, currency: settings.currency, people, projects }), [accounts, categories, people, projects, settings.currency, smsDrafts, transactions]);
  const [state, setState] = useState(() => createSmsTransactionConversation(draft, scope, initial));
  useEffect(() => { if (people.length || projects.length) setState(current => preserveSmsConversationEvidence(refreshConversationReferences(current, scope), draft)); }, [draft, people, projects, scope]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const hasProvider = !!(settings.topToolsApiKey?.trim() || settings.groqApiKey?.trim() || settings.geminiApiKey?.trim());

  const send = async (preset?: string) => {
    const text = (preset ?? answer).trim();
    if (!text || busy) return;
    setAnswer('');
    setBusy(true);
    try {
      const updated = await continueTransactionConversation(state, text, scope, {
        useAI: settings.aiSharingEnabled && hasProvider,
        keys: { topToolsApiKey: settings.topToolsApiKey, groqApiKey: settings.groqApiKey, geminiApiKey: settings.geminiApiKey },
      });
      setState(preserveSmsConversationEvidence(updated, draft));
    } finally { setBusy(false); }
  };

  const proposal = state.proposal;
  const accountName = accounts.find(item => item.id === proposal.accountId)?.name;
  const destinationName = accounts.find(item => item.id === proposal.toAccountId)?.name;
  const summary = [proposal.type, formatCurrency(draft.amount), accountName, destinationName && `to ${destinationName}`, proposal.category, proposal.personName || proposal.recipient, proposal.project?.code || proposal.project?.title, proposal.loanKind].filter(Boolean).join(' · ');

  return <View className="mb-5 rounded-2xl border border-indigo-300 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
    <View className="flex-row items-start justify-between"><View className="flex-row flex-1 pr-3"><View className="h-9 w-9 items-center justify-center rounded-xl bg-indigo-600"><FontAwesome name="comments" size={16} color="white" /></View><View className="ml-3 flex-1"><Text className="font-bold text-indigo-950 dark:text-indigo-100">Explain this SMS with Hisab</Text><Text className="mt-0.5 text-[10px] text-indigo-800 dark:text-indigo-300">{settings.aiSharingEnabled && hasProvider ? 'AI-assisted clarification' : 'Local clarification'} · bank evidence stays locked</Text></View></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close conversation assistant" onPress={onClose} className="h-9 w-9 items-center justify-center rounded-xl bg-white dark:bg-slate-900"><FontAwesome name="times" size={14} color="#64748b" /></TouchableOpacity></View>
    <View className="mt-4">{state.messages.slice(-4).map(message => <View key={message.id} className={`mb-2 max-w-[92%] rounded-xl p-3 ${message.role === 'user' ? 'self-end bg-indigo-600' : 'self-start bg-white dark:bg-slate-900'}`}><Text className={message.role === 'user' ? 'text-white' : 'text-slate-800 dark:text-slate-100'}>{message.text}</Text></View>)}</View>
    {busy ? <View className="mb-2 self-start rounded-xl bg-white px-3 py-2 dark:bg-slate-900"><CoinLoader /><Text className="mt-1 text-[10px] text-slate-600 dark:text-slate-400">Clarifying without changing the SMS…</Text></View> : null}
    <TextInput value={answer} onChangeText={setAnswer} editable={!busy} multiline placeholder={state.pendingField === 'details' ? 'Add details, or say done' : 'Type or dictate your answer…'} placeholderTextColor="#64748b" className="min-h-[64px] rounded-xl border border-indigo-200 bg-white p-3 text-slate-900 dark:border-indigo-800 dark:bg-slate-900 dark:text-white" />
    <View className="mt-2 flex-row items-center"><Text className="flex-1 pr-2 text-[10px] text-indigo-800 dark:text-indigo-300">You can use the microphone on your phone keyboard.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Send SMS clarification answer" disabled={!answer.trim() || busy} onPress={() => void send()} className={`h-11 w-11 items-center justify-center rounded-xl ${answer.trim() && !busy ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}><FontAwesome name="send" size={14} color="white" /></TouchableOpacity></View>
    <View className="mt-3 rounded-xl bg-white p-3 dark:bg-slate-900"><Text className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Current proposal</Text><Text className="mt-1 text-xs font-semibold text-slate-900 dark:text-white">{summary}</Text>{proposal.splits.length > 1 ? <Text className="mt-1 text-[10px] text-indigo-700 dark:text-indigo-300">{proposal.splits.length} category splits prepared</Text> : null}</View>
    <View className="mt-3 flex-row gap-2">{(state.pendingField === 'details' || state.pendingField === 'recipient') ? <TouchableOpacity onPress={() => void send(state.pendingField === 'recipient' ? 'skip' : 'done')} disabled={busy || state.ready} className="flex-1 items-center rounded-xl border border-indigo-300 bg-white py-3 dark:border-indigo-800 dark:bg-slate-900"><Text className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{state.pendingField === 'recipient' ? 'Person unknown' : 'No more details'}</Text></TouchableOpacity> : null}<TouchableOpacity onPress={() => onApply(proposal)} disabled={!state.ready || busy} className={`flex-1 items-center rounded-xl py-3 ${state.ready && !busy ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}><Text className="text-xs font-bold text-white">Apply to form</Text></TouchableOpacity></View>
    <Text className="mt-2 text-center text-[10px] text-slate-600 dark:text-slate-400">Applying answers does not record the transaction. Review the form, then use Record Transaction.</Text>
  </View>;
}
