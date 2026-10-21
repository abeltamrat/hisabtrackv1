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
  lastMessageId?: string;
  /** When each participant last opened the conversation / last received it on a device. */
  readAt?: Record<string, number>;
  deliveredAt?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface MessageReply {
  id: string;
  senderUid: string;
  senderName: string;
  type: 'TEXT' | MessageRequestType;
  text: string;
  deleted?: boolean;
}

/** Delivery state of a message you sent, as seen from your side. */
export type MessageDelivery = 'SENDING' | 'FAILED' | 'SENT' | 'DELIVERED' | 'SEEN';

/** A message may be edited for 15 minutes and unsent for 48 hours (enforced by the server). */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
export const MESSAGE_UNSEND_WINDOW_MS = 48 * 60 * 60 * 1000;

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
  replyTo?: MessageReply;
  editedAt?: number;
  deletedAt?: number;
  hiddenFor?: string[];
  createdAt: number;
  respondedAt?: number;
  respondedByUid?: string;
}

export function messageDelivery(message: Pick<ConversationMessage, 'createdAt'>, conversation: Conversation | undefined, otherUid: string): MessageDelivery {
  if (message.createdAt <= (Number(conversation?.readAt?.[otherUid]) || 0)) return 'SEEN';
  if (message.createdAt <= (Number(conversation?.deliveredAt?.[otherUid]) || 0)) return 'DELIVERED';
  return 'SENT';
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

  /**
   * App-wide unread badge. Seeing new messages arrive here also tells the
   * sender they were delivered to this device (double grey tick).
   */
  static listenUnreadCount(uid: string, callback: (count: number) => void) {
    const reported = new Map<string, number>();
    return this.listenToConversations(uid, items => {
      callback(items.reduce((sum, item) => sum + Math.max(0, Number(item.unreadBy?.[uid]) || 0), 0));
      for (const item of items) {
        const fromOther = item.lastSenderUid && item.lastSenderUid !== uid;
        const alreadyDelivered = (Number(item.deliveredAt?.[uid]) || 0) >= item.updatedAt;
        if (!fromOther || alreadyDelivered || (reported.get(item.id) || 0) >= item.updatedAt) continue;
        reported.set(item.id, item.updatedAt);
        void this.markDelivered(item.id).catch(() => reported.delete(item.id));
      }
    }, () => callback(0));
  }

  static async startConversation(recipientUid: string): Promise<string> {
    const result = await callable()({ action: 'start', recipientUid });
    return (result.data as { conversationId: string }).conversationId;
  }

  /** Pass a messageId to retry the same message safely (the server treats repeats as one). */
  static async sendText(conversationId: string, text: string, options: { messageId?: string; replyToId?: string } = {}) {
    return callable()({ action: 'send', conversationId, messageId: options.messageId || generateUUID(), type: 'TEXT', text, ...(options.replyToId ? { replyToId: options.replyToId } : {}) });
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

  static async markDelivered(conversationId: string) {
    return callable()({ action: 'markDelivered', conversationId });
  }

  static async editText(conversationId: string, messageId: string, text: string) {
    return callable()({ action: 'edit', conversationId, messageId, text });
  }

  /** Unsend for everyone (your own text messages, within 48 hours). */
  static async unsend(conversationId: string, messageId: string) {
    return callable()({ action: 'delete', conversationId, messageId });
  }

  /** Remove a message from your own view only. */
  static async hideForMe(conversationId: string, messageId: string) {
    return callable()({ action: 'hide', conversationId, messageId });
  }
}
