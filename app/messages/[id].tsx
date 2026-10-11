import FormSheet from '@/components/FormSheet';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import MessagingService, { type Conversation, type ConversationMessage, type MessageRequestType } from '@/services/MessagingService';
import { Alert } from '@/utils/alert';
import { FontAwesome } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

const REQUESTS: { type: MessageRequestType; label: string; icon: React.ComponentProps<typeof FontAwesome>['name']; needsAmount: boolean; needsEqub?: boolean }[] = [
  { type: 'PAYMENT_REQUEST', label: 'Payment', icon: 'money', needsAmount: true },
  { type: 'REFUND_REQUEST', label: 'Refund', icon: 'reply', needsAmount: true },
  { type: 'LOAN_REQUEST', label: 'Loan', icon: 'handshake-o', needsAmount: true },
  { type: 'LOAN_REPAYMENT_REQUEST', label: 'Loan repayment', icon: 'exchange', needsAmount: true },
  { type: 'EQUB_PAYMENT_REQUEST', label: 'Equb payment', icon: 'users', needsAmount: true, needsEqub: true },
  { type: 'EQUB_INVITE', label: 'Equb invitation', icon: 'user-plus', needsAmount: false, needsEqub: true },
];

const requestLabel = (type: ConversationMessage['type']) => REQUESTS.find(item => item.type === type)?.label || 'Message';
const statusColor: Record<string, string> = { PENDING: '#f59e0b', ACCEPTED: '#10b981', DECLINED: '#ef4444', CANCELLED: '#64748b' };

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { currency, formatCurrency } = useAppSettings();
  const [conversation, setConversation] = useState<Conversation>();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState<MessageRequestType>('PAYMENT_REQUEST');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [equbName, setEqubName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!id) return;
    const stopConversation = MessagingService.listenToConversation(id, setConversation, error => console.error('Conversation failed', error));
    const stopMessages = MessagingService.listenToMessages(id, value => {
      setMessages(value);
      if (value.at(-1)?.senderUid !== user?.uid) void MessagingService.markRead(id).catch(() => undefined);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }, error => console.error('Messages failed', error));
    void MessagingService.markRead(id).catch(() => undefined);
    return () => { stopConversation(); stopMessages(); };
  }, [id, user?.uid]);

  const otherUid = conversation?.participantUids.find(uid => uid !== user?.uid) || '';
  const otherName = conversation?.participantNames?.[otherUid] || 'HisabTrack user';
  const selectedRequest = useMemo(() => REQUESTS.find(item => item.type === requestType)!, [requestType]);

  const sendText = async () => {
    const value = text.trim(); if (!value || !id || sending) return;
    setSending(true); setText('');
    try { await MessagingService.sendText(id, value); }
    catch (error: any) { setText(value); Alert.alert('Message not sent', error?.message || 'Try again.'); }
    finally { setSending(false); }
  };

  const sendRequest = async () => {
    if (!id || sending) return;
    const numericAmount = Number(amount.replace(/,/g, ''));
    if (selectedRequest.needsAmount && (!Number.isFinite(numericAmount) || numericAmount <= 0)) return Alert.alert('Amount required', 'Enter an amount greater than zero.');
    if (selectedRequest.needsEqub && !equbName.trim()) return Alert.alert('Equb name required', 'Enter the Equb name.');
    let due: number | undefined;
    if (dueDate.trim()) { due = new Date(`${dueDate.trim()}T12:00:00`).getTime(); if (!Number.isFinite(due)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD.'); }
    setSending(true);
    try {
      await MessagingService.sendRequest(id, { type: requestType, text: note.trim() || undefined, amount: selectedRequest.needsAmount ? numericAmount : undefined, currency, dueDate: due, communityName: selectedRequest.needsEqub ? equbName.trim() : undefined });
      setRequestOpen(false); setAmount(''); setNote(''); setEqubName(''); setDueDate('');
    } catch (error: any) { Alert.alert('Request not sent', error?.message || 'Try again.'); }
    finally { setSending(false); }
  };

  const act = async (message: ConversationMessage, response: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') => {
    if (!id) return;
    try {
      if (response === 'CANCELLED') await MessagingService.cancel(id, message.id);
      else await MessagingService.respond(id, message.id, response);
    } catch (error: any) { Alert.alert('Could not update request', error?.message || 'Refresh and try again.'); }
  };

  return <KeyboardAvoidingView className="flex-1 bg-slate-50 dark:bg-slate-950" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View className="px-4 py-3 flex-row items-center border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back to messages" className="w-10 h-10 rounded-xl items-center justify-center"><FontAwesome name="arrow-left" size={17} color="#818cf8" /></TouchableOpacity>
      <View className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-950 items-center justify-center ml-1"><Text className="font-extrabold text-teal-700 dark:text-teal-300">{otherName.slice(0, 1).toUpperCase()}</Text></View>
      <View className="flex-1 ml-3"><Text numberOfLines={1} className="font-extrabold text-slate-900 dark:text-white">{otherName}</Text><Text className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">LINKED HISABTRACK USER</Text></View>
    </View>

    <ScrollView ref={scrollRef} className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 18 }} keyboardShouldPersistTaps="handled">
      {messages.map(message => {
        const mine = message.senderUid === user?.uid;
        const isRequest = message.type !== 'TEXT';
        return <View key={message.id} className={`mb-3 ${mine ? 'items-end' : 'items-start'}`}>
          <View className={`${isRequest ? 'w-[88%]' : 'max-w-[82%]'} rounded-3xl px-4 py-3 ${mine ? 'bg-indigo-600' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'}`}>
            {isRequest && <><View className="flex-row items-center"><View className={`w-9 h-9 rounded-full items-center justify-center ${mine ? 'bg-white/20' : 'bg-indigo-100 dark:bg-indigo-950'}`}><FontAwesome name={REQUESTS.find(item => item.type === message.type)?.icon || 'file-text-o'} size={15} color={mine ? '#fff' : '#6366f1'} /></View><View className="flex-1 ml-3"><Text className={`font-extrabold ${mine ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{requestLabel(message.type)}</Text>{message.communityName && <Text className={`text-xs ${mine ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>{message.communityName}</Text>}</View></View>
              {typeof message.amount === 'number' && <Text className={`text-2xl font-extrabold mt-3 ${mine ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{message.currency === currency ? formatCurrency(message.amount) : `${message.currency || currency} ${message.amount.toFixed(2)}`}</Text>}
              {message.dueDate && <Text className={`text-xs mt-1 ${mine ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>Due {new Date(message.dueDate).toLocaleDateString()}</Text>}
            </>}
            {!!message.text && <Text className={`${isRequest ? 'mt-3' : ''} ${mine ? 'text-white' : 'text-slate-800 dark:text-slate-100'}`}>{message.text}</Text>}
            {isRequest && <View className="mt-3 pt-3 border-t border-white/20"><Text style={{ color: statusColor[message.status || 'PENDING'] }} className="text-[11px] font-extrabold">{message.status || 'PENDING'}</Text>
              {message.status === 'PENDING' && !mine && <View className="flex-row gap-2 mt-3"><TouchableOpacity onPress={() => void act(message, 'DECLINED')} className="flex-1 py-2 rounded-xl bg-red-100 dark:bg-red-950 items-center"><Text className="text-red-700 dark:text-red-300 font-bold text-xs">Decline</Text></TouchableOpacity><TouchableOpacity onPress={() => void act(message, 'ACCEPTED')} className="flex-1 py-2 rounded-xl bg-emerald-500 items-center"><Text className="text-white font-bold text-xs">Accept</Text></TouchableOpacity></View>}
              {message.status === 'PENDING' && mine && <TouchableOpacity onPress={() => void act(message, 'CANCELLED')} className="mt-3 py-2 rounded-xl bg-white/20 items-center"><Text className="text-white font-bold text-xs">Cancel request</Text></TouchableOpacity>}
              {message.status === 'ACCEPTED' && <Text className={`text-[10px] mt-2 ${mine ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>Agreement recorded. Record the real payment in its financial screen.</Text>}
            </View>}
            <Text className={`text-[10px] mt-2 text-right ${mine ? 'text-indigo-200' : 'text-slate-600 dark:text-slate-300'}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
        </View>;
      })}
      {!messages.length && <View className="items-center py-20"><FontAwesome name="comments-o" size={30} color="#94a3b8" /><Text className="text-slate-600 dark:text-slate-300 mt-4">Say hello or send a request.</Text></View>}
    </ScrollView>

    <View className="px-3 py-3 flex-row items-end bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
      <TouchableOpacity onPress={() => setRequestOpen(true)} accessibilityLabel="Create financial request" className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-950 items-center justify-center"><FontAwesome name="plus" size={16} color="#f59e0b" /></TouchableOpacity>
      <TextInput value={text} onChangeText={setText} placeholder="Write a message" placeholderTextColor="#94a3b8" multiline maxLength={1000} className="flex-1 mx-2 px-4 py-3 max-h-28 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" />
      <TouchableOpacity disabled={!text.trim() || sending} onPress={() => void sendText()} accessibilityLabel="Send message" className={`w-11 h-11 rounded-2xl items-center justify-center ${text.trim() ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}>{sending ? <ActivityIndicator color="#fff" /> : <FontAwesome name="send" size={15} color="#fff" />}</TouchableOpacity>
    </View>

    <FormSheet visible={requestOpen} onClose={() => setRequestOpen(false)} accessibilityLabel="Create a financial request">
      <Text className="text-xl font-extrabold text-slate-900 dark:text-white">Send a request</Text><Text className="text-xs text-slate-600 dark:text-slate-300 mt-1 mb-4">Choose what you are asking {otherName} to do.</Text>
      <View className="flex-row flex-wrap gap-2">{REQUESTS.map(item => <TouchableOpacity key={item.type} onPress={() => setRequestType(item.type)} className={`px-3 py-2 rounded-full border ${requestType === item.type ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${requestType === item.type ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>{item.label}</Text></TouchableOpacity>)}</View>
      {selectedRequest.needsAmount && <><Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-5 mb-2">Amount ({currency})</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" /></>}
      {selectedRequest.needsEqub && <><Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Equb name</Text><TextInput value={equbName} onChangeText={setEqubName} maxLength={100} placeholder="Which Equb?" placeholderTextColor="#94a3b8" className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" /></>}
      <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Due date (optional)</Text><TextInput value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" />
      <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Note (optional)</Text><TextInput value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Add context" placeholderTextColor="#94a3b8" className="px-4 py-3 min-h-[80px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" textAlignVertical="top" />
      <TouchableOpacity disabled={sending} onPress={() => void sendRequest()} className="mt-6 py-4 rounded-2xl bg-indigo-600 items-center">{sending ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-extrabold">Send {selectedRequest.label}</Text>}</TouchableOpacity>
    </FormSheet>
  </KeyboardAvoidingView>;
}
