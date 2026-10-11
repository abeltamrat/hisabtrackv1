import { getFirebaseApp } from '@/config/firebaseApp';
import { generateUUID } from '@/utils/uuid';
import { collection, doc, getFirestore, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

export type MessageRequestType =
  | 'PAYMENT_REQUEST'
  | 'REFUND_REQUEST'
  | 'LOAN_REQUEST'
  | 'LOAN_REPAYMENT_REQUEST'
  | 'EQUB_PAYMENT_REQUEST'
  | 'EQUB_INVITE';

export type MessageRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

export interface Conversation {
  id: string;
  participantUids: string[];
  participantNames: Record<string, string>;
  unreadBy: Record<string, number>;
  lastMessageText?: string;
  lastMessageType?: 'TEXT' | MessageRequestType;
  lastSenderUid?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  senderUid: string;
  senderName: string;
  type: 'TEXT' | MessageRequestType;
  text?: string;
  amount?: number;
  currency?: string;
  dueDate?: number;
  communityGroupId?: string;
  communityName?: string;
  status?: MessageRequestStatus;
  createdAt: number;
  respondedAt?: number;
  respondedByUid?: string;
}

export interface SendRequestInput {
  type: MessageRequestType;
  text?: string;
  amount?: number;
  currency?: string;
  dueDate?: number;
  communityGroupId?: string;
  communityName?: string;
}

const db = () => getFirestore(getFirebaseApp());
const callable = () => httpsCallable(getFunctions(getFirebaseApp()), 'mutateConversation');

export default class MessagingService {
  static listenToConversations(uid: string, callback: (items: Conversation[]) => void, onError?: (error: Error) => void) {
    return onSnapshot(
      query(collection(db(), 'conversations'), where('participantUids', 'array-contains', uid)),
      snapshot => callback(snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as Conversation))
        .filter(item => item.participantUids?.includes(uid))
        .sort((a, b) => b.updatedAt - a.updatedAt)),
      error => onError?.(error)
    );
  }

  static listenToMessages(conversationId: string, callback: (items: ConversationMessage[]) => void, onError?: (error: Error) => void) {
    return onSnapshot(
      query(collection(db(), 'conversations', conversationId, 'messages'), orderBy('createdAt', 'asc')),
      snapshot => callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ConversationMessage))),
      error => onError?.(error)
    );
  }

  static listenToConversation(conversationId: string, callback: (item?: Conversation) => void, onError?: (error: Error) => void) {
    return onSnapshot(doc(db(), 'conversations', conversationId), snapshot => {
      callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Conversation : undefined);
    }, error => onError?.(error));
  }

  static listenUnreadCount(uid: string, callback: (count: number) => void) {
    return this.listenToConversations(uid, items => callback(items.reduce((sum, item) => sum + Math.max(0, Number(item.unreadBy?.[uid]) || 0), 0)), () => callback(0));
  }

  static async startConversation(recipientUid: string): Promise<string> {
    const result = await callable()({ action: 'start', recipientUid });
    return (result.data as { conversationId: string }).conversationId;
  }

  static async sendText(conversationId: string, text: string) {
    return callable()({ action: 'send', conversationId, messageId: generateUUID(), type: 'TEXT', text });
  }

  static async sendRequest(conversationId: string, input: SendRequestInput) {
    return callable()({ action: 'send', conversationId, messageId: generateUUID(), ...input });
  }

  static async respond(conversationId: string, messageId: string, response: 'ACCEPTED' | 'DECLINED') {
    return callable()({ action: 'respond', conversationId, messageId, response });
  }

  static async cancel(conversationId: string, messageId: string) {
    return callable()({ action: 'cancel', conversationId, messageId });
  }

  static async markRead(conversationId: string) {
    return callable()({ action: 'markRead', conversationId });
  }
}
