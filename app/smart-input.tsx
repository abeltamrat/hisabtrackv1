import CoinLoader from '@/components/CoinLoader';
import { useTransactions } from '@/context/TransactionContext';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { InputDraftService } from '@/services/InputDraftService';
import { ReceiptOCRService } from '@/services/ReceiptOCRService';
import type { Account, Transaction } from '@/types/database';
import { parseQuickAdd } from '@/utils/quickAddParser';
import { matchReceipt, parseReceiptText, receiptSplits } from '@/utils/receiptParser';
import { FontAwesome } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';
import { Alert } from '@/utils/alert';
import { DraftTransactionService, type DraftTransaction } from '@/services/DraftTransactionService';

export default function SmartInputScreen() {
  const router = useRouter();
  const { formatCurrency, aiSharingEnabled } = useAppSettings();
  const { categories } = useTransactions();
  const accounts = useSelector((state: any) => state.accounts.items) as Account[];
  const transactions = useSelector((state: any) => state.transactions.items) as Transaction[];
  const [mode, setMode] = useState<'QUICK' | 'RECEIPT'>('QUICK');
  const [phrase, setPhrase] = useState('');
  const [receiptText, setReceiptText] = useState('');
  const [imageUri, setImageUri] = useState<string>();
  const [imageMimeType, setImageMimeType] = useState('image/jpeg');
  const [retainAttachment, setRetainAttachment] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [smsDrafts, setSmsDrafts] = useState<DraftTransaction[]>([]);
  React.useEffect(() => { void DraftTransactionService.getAll().then(items => setSmsDrafts(items.filter(item => item.status === 'PENDING'))).catch(() => setSmsDrafts([])); }, []);
  const quick = useMemo(() => phrase.trim() ? parseQuickAdd(phrase, accounts, categories, transactions) : null, [accounts, categories, phrase, transactions]);
  const receipt = useMemo(() => receiptText.trim() ? parseReceiptText(receiptText) : null, [receiptText]);
  const matches = useMemo(() => receipt ? matchReceipt(receipt, transactions) : [], [receipt, transactions]);
  const smsMatches = useMemo(() => receipt?.total ? smsDrafts.filter(item => Math.abs(item.amount - receipt.total!) < 0.01 && Math.abs(item.date - (receipt.date || Date.now())) <= 3 * 86400000).sort((a, b) => {
    const aName = receipt.merchant && `${a.sender_receiver || ''} ${a.description}`.toLowerCase().includes(receipt.merchant.toLowerCase()) ? 1 : 0;
    const bName = receipt.merchant && `${b.sender_receiver || ''} ${b.description}`.toLowerCase().includes(receipt.merchant.toLowerCase()) ? 1 : 0;
    return bName - aName || b.date - a.date;
  }) : [], [receipt, smsDrafts]);

  const enrichSmsDraft = async (smsDraft: DraftTransaction) => {
    if (!receipt?.total) return;
    const splits = receiptSplits(receipt, smsDraft.category);
    await DraftTransactionService.updateMany([{ id: smsDraft.id, patch: { suggested_splits: splits, sender_receiver: receipt.merchant || smsDraft.sender_receiver, description: receipt.merchant ? `Receipt from ${receipt.merchant}` : smsDraft.description } }]);
    router.push({ pathname: '/draft-transactions', params: { draftId: smsDraft.id } });
  };

  const openDraft = async (matchedTransactionId?: string) => {
    try {
      if (mode === 'QUICK') {
        if (!quick?.amount) return Alert.alert('Nothing to review', 'Enter a phrase with a positive amount.');
        if (await InputDraftService.isUsed(quick.fingerprint)) return Alert.alert('Already recorded', 'This exact quick-add draft was already saved. Change the phrase or review your transactions.');
        const draft = await InputDraftService.save({ source: 'QUICK_ADD', fingerprint: quick.fingerprint, amount: quick.amount, accountId: quick.accountId, type: quick.type, category: quick.category, recipient: quick.recipient, description: quick.description, date: quick.date, tags: quick.tags, splits: quick.splits });
        router.push({ pathname: '/modal', params: { draft: draft.id } });
      } else {
        if (!receipt?.total) return Alert.alert('Total required', 'Correct the receipt text until a total is recognized.');
        const fingerprint = `receipt:${receipt.merchant || ''}:${receipt.date || ''}:${receipt.total}`.toLowerCase();
        if (!matchedTransactionId && await InputDraftService.isUsed(fingerprint)) return Alert.alert('Already recorded', 'This receipt draft was already saved.');
        const draft = await InputDraftService.save({ source: 'RECEIPT', fingerprint, amount: receipt.total, type: 'EXPENSE', category: receipt.lines[0]?.category, recipient: receipt.merchant, description: receipt.merchant ? `Receipt from ${receipt.merchant}` : 'Receipt purchase', date: receipt.date, tags: ['receipt'], splits: receiptSplits(receipt), attachmentUri: imageUri, retainAttachment, matchedTransactionId });
        router.push({ pathname: '/modal', params: { draft: draft.id, ...(matchedTransactionId ? { edit: matchedTransactionId } : {}) } });
      }
    } catch (error: any) { Alert.alert('Could not prepare draft', error?.message || 'Please try again.'); }
  };

  const chooseImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Photo access needed', 'Allow photo access to choose a receipt. You can still paste receipt text without it.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled) { setImageUri(result.assets[0].uri); setImageMimeType(result.assets[0].mimeType || 'image/jpeg'); setReceiptText(''); }
  };
  const recognize = async () => {
    if (!imageUri) return;
    setBusy(true);
    try { setReceiptText(await ReceiptOCRService.extractText(imageUri, consent, imageMimeType)); }
    catch (error: any) { Alert.alert('Recognition unavailable', error?.message || 'Paste the receipt text and continue locally.'); }
    finally { setBusy(false); }
  };

  return <View className="flex-1 bg-slate-50 dark:bg-background-dark">
    <Stack.Screen options={{ headerShown: false }} />
    <LinearGradient colors={['#4f46e5', '#4338ca']} className="px-5 pt-6 pb-7 rounded-b-[28px]">
      <View className="flex-row items-center"><TouchableOpacity accessibilityLabel="Back" onPress={() => router.back()} className="w-10 h-10 rounded-xl bg-white/20 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="white" /></TouchableOpacity><View className="ml-3"><Text className="text-white text-xl font-bold">Smart input</Text><Text className="text-indigo-100 text-xs">Parse locally, review before saving</Text></View></View>
    </LinearGradient>
    <ScrollView className="flex-1 px-4 -mt-3" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="flex-row bg-white dark:bg-slate-800 rounded-2xl p-1 shadow mb-4"><TouchableOpacity onPress={() => setMode('QUICK')} className={`flex-1 p-3 rounded-xl ${mode === 'QUICK' ? 'bg-indigo-600' : ''}`}><Text className={`text-center font-bold ${mode === 'QUICK' ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>Quick add</Text></TouchableOpacity><TouchableOpacity onPress={() => setMode('RECEIPT')} className={`flex-1 p-3 rounded-xl ${mode === 'RECEIPT' ? 'bg-indigo-600' : ''}`}><Text className={`text-center font-bold ${mode === 'RECEIPT' ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>Receipt</Text></TouchableOpacity></View>
      {mode === 'QUICK' ? <>
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><Text className="font-bold text-slate-900 dark:text-white mb-2">Describe the transaction</Text><TextInput value={phrase} onChangeText={setPhrase} multiline placeholder="450 lunch and 150 taxi from cash #work" placeholderTextColor="#94a3b8" className="min-h-[100px] rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white p-3" /></View>
        {quick && <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><Text className="font-bold text-slate-900 dark:text-white mb-2">Parsed draft</Text><Text className="text-slate-700 dark:text-slate-300">{formatCurrency(quick.amount)} · {quick.type}</Text><Text className="text-slate-500 dark:text-slate-400 mt-1">{accounts.find(a => a.id === quick.accountId)?.name || 'Account unresolved'} · {quick.category || (quick.splits.length ? `${quick.splits.length} split parts` : 'Category unresolved')}</Text>{quick.recipient ? <Text className="text-slate-500 dark:text-slate-400 mt-1">Recipient: {quick.recipient}</Text> : null}{quick.issues.map(issue => <Text key={issue} className="text-amber-600 text-xs mt-2">• {issue}</Text>)}</View>}
        <TouchableOpacity onPress={() => void openDraft()} className="bg-indigo-600 rounded-2xl p-4"><Text className="text-white text-center font-bold">Review in transaction editor</Text></TouchableOpacity>
      </> : <>
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><TouchableOpacity onPress={chooseImage} className="border border-dashed border-indigo-400 rounded-xl p-4 items-center"><FontAwesome name="camera" size={22} color="#6366f1" /><Text className="text-indigo-600 font-bold mt-2">Choose receipt photo</Text></TouchableOpacity>{imageUri ? <><View className="flex-row items-center justify-between mt-4"><View className="flex-1 pr-3"><Text className="font-bold text-slate-900 dark:text-white">Recognize with Gemini</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Sends this image only after consent. {aiSharingEnabled ? 'AI sharing is enabled.' : 'AI sharing is disabled in Settings.'}</Text></View><Switch value={consent} onValueChange={setConsent} /></View><TouchableOpacity disabled={busy || !consent} onPress={recognize} className={`mt-3 rounded-xl p-3 ${consent ? 'bg-indigo-600' : 'bg-slate-300'}`}>{busy ? <CoinLoader color="white" /> : <Text className="text-white text-center font-bold">Recognize receipt</Text>}</TouchableOpacity></> : null}</View>
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><Text className="font-bold text-slate-900 dark:text-white mb-1">Receipt text</Text><Text className="text-xs text-slate-500 dark:text-slate-400 mb-2">Paste or correct one item per line. Corrections are parsed locally.</Text><TextInput value={receiptText} onChangeText={setReceiptText} multiline placeholder={'Shop name\nLunch 250.00\nVAT 37.50\nTotal 287.50'} placeholderTextColor="#94a3b8" className="min-h-[180px] rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white p-3" /></View>
        {receipt && <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><Text className="font-bold text-slate-900 dark:text-white">{receipt.merchant || 'Receipt'} · {receipt.total ? formatCurrency(receipt.total) : 'total unresolved'}</Text><Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">{receipt.lines.length} items · tax {formatCurrency(receipt.taxes)} · fees {formatCurrency(receipt.fees)} · discount {formatCurrency(receipt.discounts)}</Text>{receipt.issues.map(issue => <Text key={issue} className="text-amber-600 text-xs mt-2">• {issue}</Text>)}{smsMatches[0] ? <View className="bg-sky-50 dark:bg-sky-900/20 p-3 rounded-xl mt-3"><Text className="text-sky-700 dark:text-sky-300 font-bold">Possible pending SMS payment</Text><Text className="text-xs text-sky-700 dark:text-sky-300 mt-1">{new Date(smsMatches[0].date).toLocaleDateString()} · {smsMatches[0].description}</Text><TouchableOpacity onPress={() => void enrichSmsDraft(smsMatches[0])} className="bg-sky-600 rounded-xl p-3 mt-2"><Text className="text-white text-center font-bold">Add receipt splits to SMS draft</Text></TouchableOpacity></View> : matches[0] ? <View className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl mt-3"><Text className="text-emerald-700 dark:text-emerald-300 font-bold">Possible existing payment</Text><Text className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">{new Date(matches[0].transaction.date).toLocaleDateString()} · {matches[0].transaction.description}</Text><TouchableOpacity onPress={() => void openDraft(matches[0].transaction.id)} className="bg-emerald-600 rounded-xl p-3 mt-2"><Text className="text-white text-center font-bold">Enrich existing payment</Text></TouchableOpacity></View> : null}</View>}
        <View className="flex-row items-center bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3"><View className="flex-1"><Text className="font-bold text-slate-900 dark:text-white">Keep photo attachment</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Off by default. The local URI is saved only if you choose.</Text></View><Switch value={retainAttachment} onValueChange={setRetainAttachment} /></View>
        <TouchableOpacity onPress={() => void openDraft()} className="bg-indigo-600 rounded-2xl p-4"><Text className="text-white text-center font-bold">Prepare new transaction draft</Text></TouchableOpacity>
      </>}
    </ScrollView>
  </View>;
}
