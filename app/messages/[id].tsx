import FormSheet from '@/components/FormSheet';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import MessagingService, {
  MESSAGE_EDIT_WINDOW_MS, MESSAGE_UNSEND_WINDOW_MS, messageDelivery,
  type Conversation, type ConversationMessage, type MessageDelivery, type MessageReply, type MessageRequestType,
} from '@/services/MessagingService';
import { Alert } from '@/utils/alert';
import { generateUUID } from '@/utils/uuid';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Platform, Pressable, ScrollView, Share, Text, TextInput, TouchableOpacity, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
const MAX_LENGTH = 1000;
// Consecutive messages from one person within this gap read as one block.
const GROUP_GAP_MS = 5 * 60 * 1000;
const STARTERS = ['Hi 👋', 'Selam!', 'Can we talk about the payment?', 'Thank you!'];

const clock = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayKey = (value: number) => new Date(value).toDateString();
const dayLabel = (value: number) => {
  const today = new Date(); const date = new Date(value);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
const snippet = (message: Pick<ConversationMessage, 'type' | 'text' | 'deletedAt'>) =>
  message.deletedAt ? 'Unsent message' : message.type === 'TEXT' ? (message.text || '') : `${requestLabel(message.type)} request`;

/** Messages typed here but not yet confirmed by the server. */
interface PendingMessage { id: string; text: string; replyTo?: MessageReply; createdAt: number; failed?: boolean }

type ChatItem = ConversationMessage & { delivery?: MessageDelivery };

/** Plain text with tappable web links. */
function LinkedText({ text, className, linkClassName }: { text: string; className: string; linkClassName: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/g);
  return <Text className={className}>{parts.map((part, index) => /^(https?:\/\/|www\.)/.test(part)
    ? <Text key={index} className={`underline ${linkClassName}`} onPress={() => void Linking.openURL(part.startsWith('www.') ? `https://${part}` : part)}>{part}</Text>
    : part)}</Text>;
}

function DeliveryTick({ delivery, onDark }: { delivery: MessageDelivery; onDark: boolean }) {
  const muted = onDark ? '#c7d2fe' : '#94a3b8';
  if (delivery === 'SENDING') return <FontAwesome name="clock-o" size={11} color={muted} accessibilityLabel="Sending" />;
  if (delivery === 'FAILED') return <FontAwesome name="exclamation-circle" size={12} color="#fca5a5" accessibilityLabel="Not sent" />;
  const color = delivery === 'SEEN' ? '#5eead4' : muted;
  const label = delivery === 'SEEN' ? 'Seen' : delivery === 'DELIVERED' ? 'Delivered' : 'Sent';
  return <View accessibilityLabel={label} className="flex-row items-center">
    <FontAwesome name="check" size={10} color={color} />
    {delivery !== 'SENT' && <FontAwesome name="check" size={10} color={color} style={{ marginLeft: -4 }} />}
  </View>;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { currency, formatCurrency } = useAppSettings();
  const [conversation, setConversation] = useState<Conversation>();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageReply>();
  const [editing, setEditing] = useState<ConversationMessage>();
  const [selected, setSelected] = useState<ChatItem>();
  const [infoFor, setInfoFor] = useState<ChatItem>();
  const [copyText, setCopyText] = useState<string>();
  const [highlightId, setHighlightId] = useState<string>();
  const [newBelow, setNewBelow] = useState(0);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestType, setRequestType] = useState<MessageRequestType>('PAYMENT_REQUEST');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [equbName, setEqubName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const positions = useRef(new Map<string, number>());
  const nearBottom = useRef(true);
  const seenCount = useRef(0);
  // Edge-to-edge Android does not resize the window for the keyboard, so the
  // composer is lifted by the measured keyboard height (and clears the nav bar).
  // Android reports the keyboard height without the navigation bar beneath it
  // (React Native subtracts the system-bar inset), so that inset is added back.
  const insets = useSafeAreaInsets();
  const [kbdHeight, setKbdHeight] = useState(0);
  const scrollToEnd = (animated = true) => setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), 50);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, e => {
      setKbdHeight(e.endCoordinates.height);
      if (nearBottom.current) scrollToEnd();
    });
    const hide = Keyboard.addListener(hideEvent, () => setKbdHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    if (!id) return;
    const stopConversation = MessagingService.listenToConversation(id, setConversation, error => console.error('Conversation failed', error));
    const stopMessages = MessagingService.listenToMessages(id, value => {
      setMessages(value);
      // Confirmed messages replace their optimistic copies.
      const confirmed = new Set(value.map(message => message.id));
      setPending(current => current.filter(item => !confirmed.has(item.id)));
      if (value.at(-1)?.senderUid !== user?.uid) void MessagingService.markRead(id).catch(() => undefined);
    }, error => console.error('Messages failed', error));
    void MessagingService.markRead(id).catch(() => undefined);
    return () => { stopConversation(); stopMessages(); };
  }, [id, user?.uid]);

  const otherUid = conversation?.participantUids.find(uid => uid !== user?.uid) || '';
  const otherName = conversation?.participantNames?.[otherUid] || 'HisabTrack user';
  const myName = conversation?.participantNames?.[user?.uid || ''] || 'You';
  const selectedRequest = useMemo(() => REQUESTS.find(item => item.type === requestType)!, [requestType]);

  const items: ChatItem[] = useMemo(() => {
    const visible = messages.filter(message => !message.hiddenFor?.includes(user?.uid || ''));
    const mine = (message: ConversationMessage) => message.senderUid === user?.uid;
    const confirmed: ChatItem[] = visible.map(message => mine(message) ? { ...message, delivery: messageDelivery(message, conversation, otherUid) } : message);
    const local: ChatItem[] = pending.map(item => ({
      id: item.id, senderUid: user?.uid || '', senderName: myName, type: 'TEXT', text: item.text,
      replyTo: item.replyTo, createdAt: item.createdAt, delivery: item.failed ? 'FAILED' : 'SENDING',
    }));
    return [...confirmed, ...local];
  }, [conversation, messages, myName, otherUid, pending, user?.uid]);

  // Follow new messages when already at the bottom; otherwise offer a jump button.
  useEffect(() => {
    const added = items.length - seenCount.current;
    seenCount.current = items.length;
    if (added <= 0) return;
    const last = items.at(-1);
    if (nearBottom.current || last?.senderUid === user?.uid) { scrollToEnd(); setNewBelow(0); }
    else setNewBelow(count => count + added);
  }, [items, user?.uid]);

  const lastSeenMineId = useMemo(() => [...items].reverse().find(item => item.senderUid === user?.uid && item.delivery === 'SEEN')?.id, [items, user?.uid]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
    if (nearBottom.current && newBelow) setNewBelow(0);
  };

  const deliver = async (item: PendingMessage) => {
    if (!id) return;
    setPending(current => current.map(entry => entry.id === item.id ? { ...entry, failed: false } : entry));
    try {
      // The same message ID makes a retry safe: the server stores it only once.
      await MessagingService.sendText(id, item.text, { messageId: item.id, replyToId: item.replyTo?.id });
    } catch {
      setPending(current => current.map(entry => entry.id === item.id ? { ...entry, failed: true } : entry));
    }
  };

  const submit = async () => {
    const value = text.trim(); if (!value || !id) return;
    if (editing) {
      if (value === editing.text) { setEditing(undefined); setText(''); return; }
      setSending(true);
      try { await MessagingService.editText(id, editing.id, value); setEditing(undefined); setText(''); }
      catch (error: any) { Alert.alert('Could not edit message', error?.message || 'Try again.'); }
      finally { setSending(false); }
      return;
    }
    const item: PendingMessage = { id: generateUUID(), text: value, replyTo, createdAt: Date.now() };
    setText(''); setReplyTo(undefined);
    setPending(current => [...current, item]);
    nearBottom.current = true;
    void deliver(item);
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
      nearBottom.current = true;
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

  const openActions = (item: ChatItem) => {
    if (item.delivery === 'SENDING') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    Keyboard.dismiss();
    setSelected(item);
  };

  const jumpTo = (messageId: string) => {
    const y = positions.current.get(messageId);
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId(current => current === messageId ? undefined : current), 1600);
  };

  // What the long-press menu offers for the selected message.
  const actions = useMemo(() => {
    if (!selected) return [];
    const mine = selected.senderUid === user?.uid;
    const isText = selected.type === 'TEXT' && !selected.deletedAt;
    const age = Date.now() - selected.createdAt;
    const failed = selected.delivery === 'FAILED';
    const close = () => setSelected(undefined);
    const list: { key: string; label: string; icon: React.ComponentProps<typeof FontAwesome>['name']; danger?: boolean; run: () => void }[] = [];
    if (failed) {
      const item = pending.find(entry => entry.id === selected.id);
      list.push({ key: 'retry', label: 'Try sending again', icon: 'refresh', run: () => { close(); if (item) void deliver(item); } });
      list.push({ key: 'discard', label: 'Discard', icon: 'trash-o', danger: true, run: () => { close(); setPending(current => current.filter(entry => entry.id !== selected.id)); } });
      return list;
    }
    if (!selected.deletedAt) list.push({ key: 'reply', label: 'Reply', icon: 'reply', run: () => {
      close(); setEditing(undefined);
      setReplyTo({ id: selected.id, senderUid: selected.senderUid, senderName: selected.senderName, type: selected.type, text: snippet(selected) });
      setTimeout(() => inputRef.current?.focus(), 150);
    } });
    if (isText) list.push({ key: 'copy', label: 'Copy text', icon: 'clone', run: () => { close(); setCopyText(selected.text || ''); } });
    if (!selected.deletedAt) list.push({ key: 'share', label: 'Share', icon: 'share-alt', run: () => {
      close();
      const body = selected.type === 'TEXT' ? selected.text || ''
        : `${requestLabel(selected.type)} request${typeof selected.amount === 'number' ? ` · ${selected.currency || currency} ${selected.amount.toFixed(2)}` : ''}${selected.text ? `\n${selected.text}` : ''}`;
      void Share.share({ message: body }).catch(() => undefined);
    } });
    if (mine && isText && age <= MESSAGE_EDIT_WINDOW_MS) list.push({ key: 'edit', label: 'Edit', icon: 'pencil', run: () => {
      close(); setReplyTo(undefined); setEditing(selected); setText(selected.text || '');
      setTimeout(() => inputRef.current?.focus(), 150);
    } });
    list.push({ key: 'info', label: 'Message info', icon: 'info-circle', run: () => { close(); setInfoFor(selected); } });
    if (mine && isText && age <= MESSAGE_UNSEND_WINDOW_MS) list.push({ key: 'unsend', label: 'Unsend for everyone', icon: 'undo', danger: true, run: () => {
      close();
      Alert.alert('Unsend message?', `It will be removed for you and ${otherName}. They will see that a message was unsent.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unsend', style: 'destructive', onPress: () => { if (id) void MessagingService.unsend(id, selected.id).catch((error: any) => Alert.alert('Could not unsend', error?.message || 'Try again.')); } },
      ]);
    } });
    list.push({ key: 'hide', label: 'Delete for me', icon: 'trash-o', danger: true, run: () => {
      close();
      Alert.alert('Delete for you?', `It stays visible to ${otherName}.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { if (id) void MessagingService.hideForMe(id, selected.id).catch((error: any) => Alert.alert('Could not delete', error?.message || 'Try again.')); } },
      ]);
    } });
    return list;
  }, [currency, id, otherName, pending, selected, user?.uid]);

  const renderBubble = (item: ChatItem, index: number) => {
    const mine = item.senderUid === user?.uid;
    const previous = items[index - 1];
    const next = items[index + 1];
    const newDay = !previous || dayKey(previous.createdAt) !== dayKey(item.createdAt);
    const joinsPrevious = !newDay && previous?.senderUid === item.senderUid && item.createdAt - previous.createdAt < GROUP_GAP_MS;
    const joinsNext = !!next && next.senderUid === item.senderUid && dayKey(next.createdAt) === dayKey(item.createdAt) && next.createdAt - item.createdAt < GROUP_GAP_MS;
    const isRequest = item.type !== 'TEXT';
    const unsent = !!item.deletedAt;
    const highlighted = highlightId === item.id;
    // Rounded everywhere except the corner that joins the next bubble in a group.
    const corner = mine ? (joinsNext ? 'rounded-br-md' : 'rounded-br-sm') : (joinsNext ? 'rounded-bl-md' : 'rounded-bl-sm');
    const bubbleColor = unsent ? 'bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700'
      : mine ? 'bg-indigo-600' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';
    const onDark = mine && !unsent;
    const meta = onDark ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400';

    return <View key={item.id} onLayout={event => positions.current.set(item.id, event.nativeEvent.layout.y)}>
      {newDay && <View className="items-center my-3"><Text className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-200/70 dark:bg-slate-800 px-3 py-1 rounded-full">{dayLabel(item.createdAt)}</Text></View>}
      <View className={`${joinsPrevious ? 'mt-0.5' : 'mt-3'} ${mine ? 'items-end' : 'items-start'}`}>
        <Pressable
          onLongPress={() => openActions(item)}
          onPress={() => item.delivery === 'FAILED' ? openActions(item) : undefined}
          delayLongPress={250}
          accessibilityHint="Press and hold for reply, copy, edit and more"
          className={`${isRequest ? 'w-[88%]' : 'max-w-[82%]'} rounded-3xl ${corner} px-4 py-2.5 ${bubbleColor}`}
          style={highlighted ? { borderWidth: 2, borderColor: '#f59e0b' } : undefined}
        >
          {item.replyTo && !unsent && (
            <TouchableOpacity onPress={() => jumpTo(item.replyTo!.id)} accessibilityLabel="Go to the quoted message" className={`mb-2 pl-2.5 py-1 pr-2 rounded-lg border-l-4 ${onDark ? 'bg-white/15 border-indigo-200' : 'bg-slate-100 dark:bg-slate-800 border-indigo-400'}`}>
              <Text numberOfLines={1} className={`text-[11px] font-extrabold ${onDark ? 'text-white' : 'text-indigo-600 dark:text-indigo-300'}`}>{item.replyTo.senderUid === user?.uid ? 'You' : item.replyTo.senderName || otherName}</Text>
              <Text numberOfLines={2} className={`text-xs ${onDark ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>{item.replyTo.deleted ? 'Unsent message' : item.replyTo.text}</Text>
            </TouchableOpacity>
          )}

          {unsent ? (
            <View className="flex-row items-center"><FontAwesome name="ban" size={12} color="#94a3b8" /><Text className="ml-2 italic text-slate-500 dark:text-slate-400">{mine ? 'You unsent a message' : `${otherName} unsent a message`}</Text></View>
          ) : <>
            {isRequest && <><View className="flex-row items-center"><View className={`w-9 h-9 rounded-full items-center justify-center ${mine ? 'bg-white/20' : 'bg-indigo-100 dark:bg-indigo-950'}`}><FontAwesome name={REQUESTS.find(entry => entry.type === item.type)?.icon || 'file-text-o'} size={15} color={mine ? '#fff' : '#6366f1'} /></View><View className="flex-1 ml-3"><Text className={`font-extrabold ${mine ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{requestLabel(item.type)} request</Text>{item.communityName && <Text className={`text-xs ${mine ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>{item.communityName}</Text>}</View></View>
              {typeof item.amount === 'number' && <Text className={`text-2xl font-extrabold mt-3 ${mine ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{item.currency === currency ? formatCurrency(item.amount) : `${item.currency || currency} ${item.amount.toFixed(2)}`}</Text>}
              {item.dueDate && <Text className={`text-xs mt-1 ${mine ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>Due {new Date(item.dueDate).toLocaleDateString()}</Text>}
            </>}
            {!!item.text && <LinkedText text={item.text} className={`${isRequest ? 'mt-3' : ''} text-[15px] leading-5 ${mine ? 'text-white' : 'text-slate-800 dark:text-slate-100'}`} linkClassName={mine ? 'text-indigo-100' : 'text-indigo-600 dark:text-indigo-300'} />}
            {isRequest && <View className="mt-3 pt-3 border-t border-white/20"><Text style={{ color: statusColor[item.status || 'PENDING'] }} className="text-[11px] font-extrabold">{item.status || 'PENDING'}</Text>
              {item.status === 'PENDING' && !mine && <View className="flex-row gap-2 mt-3"><TouchableOpacity onPress={() => void act(item, 'DECLINED')} className="flex-1 py-2 rounded-xl bg-red-100 dark:bg-red-950 items-center"><Text className="text-red-700 dark:text-red-300 font-bold text-xs">Decline</Text></TouchableOpacity><TouchableOpacity onPress={() => void act(item, 'ACCEPTED')} className="flex-1 py-2 rounded-xl bg-emerald-500 items-center"><Text className="text-white font-bold text-xs">Accept</Text></TouchableOpacity></View>}
              {item.status === 'PENDING' && mine && <TouchableOpacity onPress={() => void act(item, 'CANCELLED')} className="mt-3 py-2 rounded-xl bg-white/20 items-center"><Text className="text-white font-bold text-xs">Cancel request</Text></TouchableOpacity>}
              {item.status === 'ACCEPTED' && <Text className={`text-[10px] mt-2 ${mine ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-300'}`}>Agreement recorded. Record the real payment in its financial screen.</Text>}
            </View>}
          </>}

          <View className="flex-row items-center justify-end mt-1">
            {!!item.editedAt && !unsent && <Text className={`text-[10px] mr-1.5 ${meta}`}>edited</Text>}
            <Text className={`text-[10px] ${meta}`}>{clock(item.createdAt)}</Text>
            {mine && item.delivery && !unsent && <View className="ml-1.5"><DeliveryTick delivery={item.delivery} onDark={onDark} /></View>}
          </View>
        </Pressable>
        {item.delivery === 'FAILED' && <Text className="text-[11px] font-bold text-red-500 mt-1 mr-1">Not sent · Tap to retry</Text>}
        {item.id === lastSeenMineId && <Text className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 mr-1">Seen{conversation?.readAt?.[otherUid] ? ` ${clock(conversation.readAt[otherUid])}` : ''}</Text>}
      </View>
    </View>;
  };

  const infoRows = (item: ChatItem) => {
    const readAt = Number(conversation?.readAt?.[otherUid]) || 0;
    const deliveredAt = Number(conversation?.deliveredAt?.[otherUid]) || 0;
    const rows: [string, string][] = [['Sent', `${dayLabel(item.createdAt)}, ${clock(item.createdAt)}`]];
    if (item.editedAt) rows.push(['Edited', `${dayLabel(item.editedAt)}, ${clock(item.editedAt)}`]);
    if (item.deletedAt) rows.push(['Unsent', `${dayLabel(item.deletedAt)}, ${clock(item.deletedAt)}`]);
    if (item.senderUid === user?.uid) {
      rows.push(['Delivered', item.delivery === 'DELIVERED' || item.delivery === 'SEEN' ? `Yes · ${otherName}'s app last synced ${clock(Math.max(deliveredAt, readAt))}` : 'Not yet']);
      rows.push(['Seen', item.delivery === 'SEEN' ? `Yes · ${otherName} last opened this chat ${dayLabel(readAt)}, ${clock(readAt)}` : 'Not yet']);
    }
    return rows;
  };

  const composerLabel = editing ? 'Editing message' : replyTo ? `Replying to ${replyTo.senderUid === user?.uid ? 'yourself' : replyTo.senderName || otherName}` : '';
  const canSend = !!text.trim() && !(editing && sending);

  return <View className="flex-1 bg-slate-50 dark:bg-slate-950">
    <View className="px-4 py-3 flex-row items-center border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back to messages" className="w-10 h-10 rounded-xl items-center justify-center"><FontAwesome name="arrow-left" size={17} color="#818cf8" /></TouchableOpacity>
      <View className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-950 items-center justify-center ml-1"><Text className="font-extrabold text-teal-700 dark:text-teal-300">{otherName.slice(0, 1).toUpperCase()}</Text></View>
      <View className="flex-1 ml-3">
        <Text numberOfLines={1} className="font-extrabold text-slate-900 dark:text-white">{otherName}</Text>
        <Text numberOfLines={1} className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">{conversation?.readAt?.[otherUid] ? `LINKED HISABTRACK USER · ACTIVE ${dayLabel(conversation.readAt[otherUid]).toUpperCase()} ${clock(conversation.readAt[otherUid])}` : 'LINKED HISABTRACK USER'}</Text>
      </View>
      <TouchableOpacity onPress={() => setRequestOpen(true)} accessibilityLabel="Send a financial request" className="w-10 h-10 rounded-xl items-center justify-center bg-amber-100 dark:bg-amber-950"><FontAwesome name="money" size={16} color="#f59e0b" /></TouchableOpacity>
    </View>

    <View className="flex-1">
      <ScrollView ref={scrollRef} className="flex-1 px-3" contentContainerStyle={{ paddingVertical: 12 }} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={64} onContentSizeChange={() => { if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: false }); }}>
        {items.map(renderBubble)}
        {!items.length && <View className="items-center py-16 px-6">
          <View className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-950 items-center justify-center"><FontAwesome name="comments-o" size={28} color="#6366f1" /></View>
          <Text className="text-base font-extrabold text-slate-900 dark:text-white mt-4">Say hello to {otherName}</Text>
          <Text className="text-xs text-center text-slate-600 dark:text-slate-300 mt-1 leading-5">Chat, or send a payment, refund, loan or Equb request. Requests record agreement only.</Text>
          <View className="flex-row flex-wrap justify-center gap-2 mt-5">
            {STARTERS.map(starter => <TouchableOpacity key={starter} onPress={() => { setText(starter); inputRef.current?.focus(); }} className="px-3 py-2 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"><Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">{starter}</Text></TouchableOpacity>)}
          </View>
        </View>}
      </ScrollView>
      {newBelow > 0 && (
        <TouchableOpacity onPress={() => { scrollToEnd(); setNewBelow(0); }} accessibilityLabel="Jump to new messages" className="absolute bottom-3 self-center flex-row items-center px-4 py-2 rounded-full bg-indigo-600 shadow-lg">
          <FontAwesome name="arrow-down" size={12} color="#fff" /><Text className="ml-2 text-xs font-bold text-white">{newBelow} new message{newBelow === 1 ? '' : 's'}</Text>
        </TouchableOpacity>
      )}
    </View>

    <View className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800" style={{ paddingBottom: 10 + (kbdHeight > 0 ? kbdHeight + (Platform.OS === 'android' ? insets.bottom : 0) : insets.bottom) }}>
      {!!composerLabel && (
        <View className="flex-row items-center mx-3 mt-2 pl-3 pr-1 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border-l-4 border-indigo-500">
          <FontAwesome name={editing ? 'pencil' : 'reply'} size={12} color="#6366f1" />
          <View className="flex-1 ml-2">
            <Text className="text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300">{composerLabel}</Text>
            <Text numberOfLines={1} className="text-xs text-slate-600 dark:text-slate-300">{editing ? editing.text : replyTo?.text}</Text>
          </View>
          <TouchableOpacity onPress={() => { if (editing) setText(''); setEditing(undefined); setReplyTo(undefined); }} accessibilityLabel={editing ? 'Cancel editing' : 'Cancel reply'} className="w-8 h-8 items-center justify-center"><FontAwesome name="times" size={14} color="#94a3b8" /></TouchableOpacity>
        </View>
      )}
      <View className="px-3 pt-2.5 flex-row items-end">
        {!editing && <TouchableOpacity onPress={() => setRequestOpen(true)} accessibilityLabel="Create financial request" className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-950 items-center justify-center"><FontAwesome name="plus" size={16} color="#f59e0b" /></TouchableOpacity>}
        <View className={`flex-1 ${editing ? '' : 'mx-2'} mr-2`}>
          <TextInput ref={inputRef} value={text} onChangeText={setText} placeholder={editing ? 'Edit your message' : 'Write a message'} placeholderTextColor="#94a3b8" multiline maxLength={MAX_LENGTH} className="px-4 py-3 max-h-32 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" />
          {text.length > MAX_LENGTH - 100 && <Text className="text-[10px] text-right text-amber-600 mt-0.5 mr-2">{MAX_LENGTH - text.length} characters left</Text>}
        </View>
        <TouchableOpacity disabled={!canSend} onPress={() => void submit()} accessibilityLabel={editing ? 'Save edit' : 'Send message'} className={`w-11 h-11 rounded-2xl items-center justify-center ${canSend ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
          {editing && sending ? <ActivityIndicator color="#fff" /> : <FontAwesome name={editing ? 'check' : 'send'} size={15} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>

    {/* Long-press menu */}
    <FormSheet visible={!!selected} onClose={() => setSelected(undefined)} accessibilityLabel="Message actions">
      {selected && <>
        <View className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-3">
          <Text className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{selected.senderUid === user?.uid ? 'You' : otherName} · {clock(selected.createdAt)}</Text>
          <Text numberOfLines={3} className="text-sm text-slate-800 dark:text-slate-100 mt-1">{snippet(selected)}</Text>
        </View>
        {actions.map(action => <TouchableOpacity key={action.key} onPress={action.run} className="flex-row items-center py-3.5 border-b border-slate-100 dark:border-slate-800">
          <View className={`w-9 h-9 rounded-xl items-center justify-center ${action.danger ? 'bg-red-50 dark:bg-red-950/40' : 'bg-indigo-50 dark:bg-indigo-950/40'}`}><FontAwesome name={action.icon} size={15} color={action.danger ? '#ef4444' : '#6366f1'} /></View>
          <Text className={`ml-3 font-semibold ${action.danger ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{action.label}</Text>
        </TouchableOpacity>)}
      </>}
    </FormSheet>

    {/* Message info */}
    <FormSheet visible={!!infoFor} onClose={() => setInfoFor(undefined)} accessibilityLabel="Message info">
      {infoFor && <>
        <Text className="text-xl font-extrabold text-slate-900 dark:text-white mb-1">Message info</Text>
        <Text numberOfLines={3} className="text-sm text-slate-600 dark:text-slate-300 mb-4">{snippet(infoFor)}</Text>
        {infoRows(infoFor).map(([label, value]) => <View key={label} className="flex-row py-3 border-b border-slate-100 dark:border-slate-800"><Text className="w-24 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</Text><Text className="flex-1 text-sm text-slate-800 dark:text-slate-100">{value}</Text></View>)}
        <Text className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-4">Delivered means {otherName}'s app received the conversation; Seen means they opened it after this message arrived.</Text>
      </>}
    </FormSheet>

    {/* Copy: the app has no clipboard module, so the text is shown selectable for the system copy menu. */}
    <FormSheet visible={copyText !== undefined} onClose={() => setCopyText(undefined)} accessibilityLabel="Copy message text">
      <Text className="text-xl font-extrabold text-slate-900 dark:text-white">Copy text</Text>
      <Text className="text-xs text-slate-600 dark:text-slate-300 mt-1 mb-3">Press and hold the text, then choose Copy.</Text>
      <View className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800"><Text selectable className="text-base text-slate-900 dark:text-white">{copyText}</Text></View>
      <TouchableOpacity onPress={() => setCopyText(undefined)} className="mt-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 items-center"><Text className="font-bold text-slate-700 dark:text-slate-200">Done</Text></TouchableOpacity>
    </FormSheet>

    <FormSheet visible={requestOpen} onClose={() => setRequestOpen(false)} accessibilityLabel="Create a financial request">
      <Text className="text-xl font-extrabold text-slate-900 dark:text-white">Send a request</Text><Text className="text-xs text-slate-600 dark:text-slate-300 mt-1 mb-4">Choose what you are asking {otherName} to do.</Text>
      <View className="flex-row flex-wrap gap-2">{REQUESTS.map(item => <TouchableOpacity key={item.type} onPress={() => setRequestType(item.type)} className={`px-3 py-2 rounded-full border ${requestType === item.type ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}><Text className={`text-xs font-bold ${requestType === item.type ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>{item.label}</Text></TouchableOpacity>)}</View>
      {selectedRequest.needsAmount && <><Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-5 mb-2">Amount ({currency})</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#94a3b8" className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" /></>}
      {selectedRequest.needsEqub && <><Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Equb name</Text><TextInput value={equbName} onChangeText={setEqubName} maxLength={100} placeholder="Which Equb?" placeholderTextColor="#94a3b8" className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" /></>}
      <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Due date (optional)</Text><TextInput value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" />
      <Text className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-4 mb-2">Note (optional)</Text><TextInput value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Add context" placeholderTextColor="#94a3b8" className="px-4 py-3 min-h-[80px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" textAlignVertical="top" />
      <TouchableOpacity disabled={sending} onPress={() => void sendRequest()} className="mt-6 py-4 rounded-2xl bg-indigo-600 items-center">{sending ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-extrabold">Send {selectedRequest.label}</Text>}</TouchableOpacity>
    </FormSheet>
  </View>;
}
