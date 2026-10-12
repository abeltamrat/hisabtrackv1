import PersonPicker from '@/components/PersonPicker';
import { useAuth } from '@/contexts/AuthContext';
import MessagingService, { type Conversation } from '@/services/MessagingService';
import type { RecipientProfile } from '@/services/RecipientIdentityService';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import HisabUserBadge from '@/components/HisabUserBadge';

const relativeTime = (value?: number) => {
  if (!value) return '';
  const delta = Date.now() - value;
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Date(value).toLocaleDateString();
};

export default function MessagesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    return MessagingService.listenToConversations(user.uid, value => { setItems(value); setLoading(false); }, error => {
      console.error('Conversation subscription failed', error);
      setLoading(false);
    });
  }, [user?.uid]);

  const startWith = async (person?: RecipientProfile) => {
    if (!person) return;
    if (!person.linkedUid) {
      Alert.alert('HisabTrack account needed', `${person.displayName} is saved locally but is not linked to a verified HisabTrack account yet.`);
      return;
    }
    setStarting(true);
    try {
      const conversationId = await MessagingService.startConversation(person.linkedUid);
      router.push(`/messages/${conversationId}` as any);
    } catch (error: any) {
      Alert.alert('Could not start chat', error?.message || 'Check your connection and try again.');
    } finally { setStarting(false); }
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back" className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 items-center justify-center border border-slate-200 dark:border-slate-700">
          <FontAwesome name="arrow-left" size={17} color="#818cf8" />
        </TouchableOpacity>
        <View className="flex-1 ml-4"><Text className="text-2xl font-extrabold text-slate-900 dark:text-white">Messages</Text><Text className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">Chat and financial requests</Text></View>
        <TouchableOpacity disabled={starting} onPress={() => setPickerOpen(true)} accessibilityLabel="Start a new conversation" className="h-11 px-4 rounded-2xl bg-indigo-600 flex-row items-center justify-center">
          {starting ? <ActivityIndicator color="#fff" /> : <><FontAwesome name="edit" size={15} color="#fff" /><Text className="text-white font-bold ml-2">New</Text></>}
        </TouchableOpacity>
      </View>

      <View className="mx-5 mb-4 p-4 rounded-3xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-900">
        <View className="flex-row items-start"><FontAwesome name="shield" size={17} color="#6366f1" /><Text className="flex-1 ml-3 text-xs leading-5 text-indigo-700 dark:text-indigo-300">Accepting a request records agreement only. Money and balances change after you record the real transaction.</Text></View>
      </View>

      {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator color="#6366f1" /></View> : (
        <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 36 }}>
          {items.map(item => {
            const otherUid = item.participantUids.find(uid => uid !== user?.uid) || '';
            const name = item.participantNames?.[otherUid] || 'HisabTrack user';
            const unread = Math.max(0, Number(item.unreadBy?.[user?.uid || '']) || 0);
            return <TouchableOpacity key={item.id} onPress={() => router.push(`/messages/${item.id}` as any)} className="flex-row items-center p-4 mb-3 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <View className="w-12 h-12 rounded-full bg-teal-100 dark:bg-teal-950 items-center justify-center"><Text className="font-extrabold text-teal-700 dark:text-teal-300 text-lg">{name.slice(0, 1).toUpperCase()}</Text></View>
              <View className="flex-1 ml-3"><View className="flex-row items-center"><Text numberOfLines={1} className="font-extrabold text-slate-900 dark:text-white shrink">{name}</Text><HisabUserBadge /><Text className="text-[10px] text-slate-600 dark:text-slate-300 ml-auto">{relativeTime(item.updatedAt)}</Text></View><Text numberOfLines={1} className={`text-xs mt-1 ${unread ? 'font-bold text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`}>{item.lastSenderUid === user?.uid ? 'You: ' : ''}{item.lastMessageText || 'Conversation started'}</Text></View>
              {unread > 0 && <View className="ml-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-indigo-600 items-center justify-center"><Text className="text-[10px] font-extrabold text-white">{unread > 99 ? '99+' : unread}</Text></View>}
            </TouchableOpacity>;
          })}
          {items.length === 0 && <View className="items-center px-8 py-20"><View className="w-20 h-20 rounded-full bg-indigo-100 dark:bg-indigo-950 items-center justify-center"><FontAwesome name="comments-o" size={32} color="#6366f1" /></View><Text className="text-xl font-extrabold text-slate-900 dark:text-white mt-5">Start a conversation</Text><Text className="text-center text-sm leading-6 text-slate-600 dark:text-slate-300 mt-2">Choose a linked person to chat or send a payment, refund, loan, repayment, or Equb request.</Text><TouchableOpacity onPress={() => setPickerOpen(true)} className="mt-6 bg-indigo-600 px-6 py-3 rounded-2xl"><Text className="text-white font-bold">Choose a person</Text></TouchableOpacity></View>}
        </ScrollView>
      )}
      <PersonPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={person => { setPickerOpen(false); void startWith(person); }} />
    </View>
  );
}
