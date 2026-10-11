import type * as ContactsModule from 'expo-contacts';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '@/config/firebaseApp';
import { normalizePersonEmail, normalizePersonPhone } from '@/services/RecipientIdentityService';

export interface LinkedContactMatch {
  uid: string;
  displayName: string;
}

export interface DeviceContact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  phones: string[];
  emails: string[];
  linkedAccount?: LinkedContactMatch;
}

export type DeviceContactsResult =
  | { status: 'granted'; contacts: DeviceContact[]; discoveryFailed: boolean }
  | { status: 'denied' | 'unavailable'; contacts: []; discoveryFailed: false };

export interface ContactDiscoveryResult {
  contacts: DeviceContact[];
  discoveryFailed: boolean;
}

const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => !!value))];
const validPhone = (value?: string) => !!value && /^\+[1-9]\d{7,14}$/.test(value);
const validEmail = (value?: string) => !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const LOCAL_CACHE_MS = 5 * 60 * 1000;
const DISCOVERY_CACHE_MS = 10 * 60 * 1000;

let localContactsCache: { loadedAt: number; contacts: DeviceContact[] } | null = null;
let discoveryCache: { loadedAt: number; matches: Map<string, LinkedContactMatch> } | null = null;

/**
 * expo-contacts is native: app builds older than 1.0.5 don't include it, and
 * importing it there throws. Load it only when contacts are actually opened so
 * those builds keep working (the picker then says contacts are unavailable).
 */
function loadContacts(): typeof ContactsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-contacts') as typeof ContactsModule;
  } catch {
    return null;
  }
}

function mapContact(contact: ContactsModule.ExistingContact): DeviceContact | undefined {
  const phones = unique((contact.phoneNumbers || []).map(item => normalizePersonPhone(item.number))).filter(validPhone);
  const emails = unique((contact.emails || []).map(item => normalizePersonEmail(item.email))).filter(validEmail);
  if (!phones.length && !emails.length) return undefined;
  const name = contact.name?.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || phones[0] || emails[0];
  return { id: contact.id, name, phone: phones[0], email: emails[0], phones, emails };
}

export class DeviceContactsService {
  /** Load the address book without waiting for the network badge lookup. */
  static async requestAndLoadLocal(): Promise<DeviceContactsResult> {
    const Contacts = loadContacts();
    if (!Contacts || !(await Contacts.isAvailableAsync().catch(() => false))) return { status: 'unavailable', contacts: [], discoveryFailed: false };
    let permission = await Contacts.getPermissionsAsync();
    if (!permission.granted) permission = await Contacts.requestPermissionsAsync();
    if (!permission.granted) return { status: 'denied', contacts: [], discoveryFailed: false };

    if (localContactsCache && Date.now() - localContactsCache.loadedAt < LOCAL_CACHE_MS) {
      return { status: 'granted', contacts: localContactsCache.contacts, discoveryFailed: false };
    }

    const response = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      sort: Contacts.SortTypes.FirstName,
      pageSize: 0,
    });
    const contacts = response.data.map(mapContact).filter((contact): contact is DeviceContact => !!contact);
    localContactsCache = { loadedAt: Date.now(), contacts };
    return { status: 'granted', contacts, discoveryFailed: false };
  }

  /** Add registered-user badges after local contacts are already visible. */
  static async discoverLinkedContacts(contacts: DeviceContact[]): Promise<ContactDiscoveryResult> {
    if (!contacts.length) return { contacts, discoveryFailed: false };

    if (discoveryCache && Date.now() - discoveryCache.loadedAt < DISCOVERY_CACHE_MS) {
      return {
        contacts: contacts.map(contact => ({ ...contact, linkedAccount: discoveryCache?.matches.get(contact.id) })),
        discoveryFailed: false,
      };
    }

    try {
      const callable = httpsCallable(getFunctions(getFirebaseApp()), 'discoverLinkedContacts');
      const discovery = await callable({
        contacts: contacts.slice(0, 1000).map(contact => ({ key: contact.id, phones: contact.phones, emails: contact.emails })),
      });
      const matches = (discovery.data as { matches?: Array<{ key: string; uid: string; displayName: string }> } | null)?.matches || [];
      const byKey = new Map(matches.map(match => [match.key, { uid: match.uid, displayName: match.displayName }]));
      discoveryCache = { loadedAt: Date.now(), matches: byKey };
      return { contacts: contacts.map(contact => ({ ...contact, linkedAccount: byKey.get(contact.id) })), discoveryFailed: false };
    } catch {
      return { contacts, discoveryFailed: true };
    }
  }
}

export default DeviceContactsService;
