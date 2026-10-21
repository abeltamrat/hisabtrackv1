import type * as ContactsModule from 'expo-contacts';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '@/config/firebaseApp';
import { AuthService } from '@/services/AuthService';
import { normalizePersonEmail, normalizePersonPhone, type RecipientProfile } from '@/services/RecipientIdentityService';

export interface LinkedContactMatch {
  uid: string;
  displayName: string;
  /** False when matched only on a number the person saved in Settings (not verified). */
  verified: boolean;
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
// Registered profiles can change on another phone at any time. Keep this
// short so an earlier empty result does not hide a newly saved phone number.
const DISCOVERY_CACHE_MS = 60 * 1000;

let localContactsCache: { loadedAt: number; contacts: DeviceContact[] } | null = null;
let discoveryCache: { loadedAt: number; matches: Map<string, LinkedContactMatch> } | null = null;
// Matches by phone/email from the last successful lookups. Starting a chat right
// after the contacts list found someone reuses this instead of spending another
// call against the server's hourly discovery limit.
const IDENTIFIER_MATCH_MS = 10 * 60 * 1000;
const identifierMatches = new Map<string, { loadedAt: number; match: LinkedContactMatch }>();
let lastDiscoveryError: unknown;

const rememberMatches = (contacts: DeviceContact[]) => {
  const loadedAt = Date.now();
  for (const contact of contacts) {
    if (!contact.linkedAccount) continue;
    for (const value of [...contact.phones, ...contact.emails]) identifierMatches.set(value, { loadedAt, match: contact.linkedAccount });
  }
};

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
  /** `cacheList` is false for one-person lookups, so they never replace the address-book result. */
  static async discoverLinkedContacts(contacts: DeviceContact[], forceRefresh = false, cacheList = true): Promise<ContactDiscoveryResult> {
    if (!contacts.length) return { contacts, discoveryFailed: false };

    if (!forceRefresh && discoveryCache && Date.now() - discoveryCache.loadedAt < DISCOVERY_CACHE_MS) {
      return {
        contacts: contacts.map(contact => ({ ...contact, linkedAccount: discoveryCache?.matches.get(contact.id) })),
        discoveryFailed: false,
      };
    }

    const currentUser = getAuth(getFirebaseApp()).currentUser;
    const selfMatches = new Map<string, LinkedContactMatch>();
    if (currentUser) {
      const verifiedPhone = normalizePersonPhone(currentUser.phoneNumber ?? undefined);
      const verifiedEmail = currentUser.emailVerified ? normalizePersonEmail(currentUser.email ?? undefined) : undefined;
      const savedPhone = normalizePersonPhone((await AuthService.getUserPhone(currentUser.uid)) ?? undefined);
      for (const contact of contacts) {
        const matchesVerifiedPhone = !!verifiedPhone && contact.phones.includes(verifiedPhone);
        const matchesVerifiedEmail = !!verifiedEmail && contact.emails.includes(verifiedEmail);
        const matchesSavedPhone = !!savedPhone && contact.phones.includes(savedPhone);
        if (matchesVerifiedPhone || matchesVerifiedEmail || matchesSavedPhone) {
          selfMatches.set(contact.id, {
            uid: currentUser.uid,
            displayName: currentUser.displayName || 'Your HisabTrack profile',
            verified: matchesVerifiedPhone || matchesVerifiedEmail,
          });
        }
      }
    }

    try {
      const callable = httpsCallable(getFunctions(getFirebaseApp()), 'discoverLinkedContacts');
      const discovery = await callable({
        contacts: contacts.slice(0, 1000).map(contact => ({ key: contact.id, phones: contact.phones, emails: contact.emails })),
      });
      const matches = (discovery.data as { matches?: Array<{ key: string; uid: string; displayName: string; verified?: boolean }> } | null)?.matches || [];
      const byKey = new Map(selfMatches);
      for (const match of matches) {
        byKey.set(match.key, { uid: match.uid, displayName: match.displayName, verified: match.verified !== false });
      }
      if (cacheList) discoveryCache = { loadedAt: Date.now(), matches: byKey };
      const discovered = contacts.map(contact => ({ ...contact, linkedAccount: byKey.get(contact.id) }));
      rememberMatches(discovered);
      return { contacts: discovered, discoveryFailed: false };
    } catch (error) {
      lastDiscoveryError = error;
      // Do not cache a network/backend failure as a valid empty discovery.
      // Otherwise every reopen keeps hiding badges until the cache expires.
      return {
        contacts: contacts.map(contact => ({ ...contact, linkedAccount: selfMatches.get(contact.id) })),
        discoveryFailed: true,
      };
    }
  }

  /**
   * Resolve one saved person immediately before an account-to-account action.
   *
   * A saved profile phone can identify a unique HisabTrack account without
   * proving that the account owns that number. Callers may use that account as
   * the destination for a chat request, but must not persist it as a verified
   * person link unless `verified` is true.
   */
  static async discoverLinkedPerson(person: Pick<RecipientProfile, 'id' | 'displayName' | 'phone' | 'email'>): Promise<LinkedContactMatch | undefined> {
    const phone = normalizePersonPhone(person.phone);
    const email = normalizePersonEmail(person.email);
    const contact: DeviceContact = {
      id: `person:${person.id}`,
      name: person.displayName,
      phone,
      email,
      phones: phone ? [phone] : [],
      emails: email ? [email] : [],
    };
    if (!contact.phones.length && !contact.emails.length) return undefined;
    for (const value of [...contact.phones, ...contact.emails]) {
      const known = identifierMatches.get(value);
      if (known && Date.now() - known.loadedAt < IDENTIFIER_MATCH_MS) return known.match;
    }
    const result = await this.discoverLinkedContacts([contact], true, false);
    // A failed lookup is not "no account": say so instead of blaming the person.
    if (result.discoveryFailed) {
      const code = (lastDiscoveryError as { code?: string } | undefined)?.code || '';
      throw new Error(code.includes('resource-exhausted')
        ? 'HisabTrack account lookups are limited per hour. Try again later.'
        : 'Could not check HisabTrack accounts right now. Check your connection and try again.');
    }
    return result.contacts[0]?.linkedAccount;
  }
}

export default DeviceContactsService;
