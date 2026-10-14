import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Storage, { getSessionScope, sessionLocalStorage } from './SessionStorage';
import type { ItemKind, ItemLink, ProjectLink, SupplierLink } from '@/types/database';

/**
 * Read-only connection to Mela ERP (mela.nonstopplc.com). The user signs in
 * with their Mela company, email/phone and password once; only the issued
 * token is kept (in secure storage), never the password. Projects are pulled
 * into local storage so the picker works offline; nothing is sent to Mela.
 */

// app/ is blocked publicly; Mela's front controller (index.php) routes /hisab_api.php to app/hisab_api.php.
export const MELA_API_URL = 'https://mela.nonstopplc.com/hisab_api.php';
const CONNECTION_KEY = 'mela_connection';
const PROJECTS_KEY = 'mela_projects';
const ITEMS_KEY = 'mela_items';
const SUPPLIERS_KEY = 'mela_suppliers';
const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

export interface MelaProject { id: number; code: string | null; title: string; status: string | null; customer: string | null; customerId?: string | null }
export interface MelaItem { id: number; code: string | null; name: string; type: string | null; category: string | null; unit: string | null }
export interface MelaSupplier { id: number; name: string; store: string | null }
export interface MelaConnection {
  company: string;
  userName: string;
  email: string | null;
  connectedAt: number;
  expiresAt: number;
  lastSyncAt?: number;
  /** Which Mela lists this user's role may see (from sign-in). */
  permissions?: { projects?: boolean; items?: boolean; suppliers?: boolean };
  /** Set when Mela rejected the token (password changed, account disabled, expired). */
  needsReconnect?: boolean;
  lastError?: string;
}

const tokenKey = () => `mela_token_${getSessionScope()}`.replace(/[^A-Za-z0-9._-]/g, '_');
async function saveToken(token: string) { if (Platform.OS === 'web') sessionLocalStorage.setItem(tokenKey(), token); else await SecureStore.setItemAsync(tokenKey(), token); }
async function readToken() { return Platform.OS === 'web' ? sessionLocalStorage.getItem(tokenKey()) : SecureStore.getItemAsync(tokenKey()); }
async function deleteToken() { if (Platform.OS === 'web') sessionLocalStorage.removeItem(tokenKey()); else await SecureStore.deleteItemAsync(tokenKey()); }

async function request(path: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${MELA_API_URL}?${path}`, { ...init, signal: controller.signal });
    let body: any = {};
    try { body = await response.json(); } catch { /* non-JSON error page */ }
    if (!response.ok) {
      const error = new Error(body?.message || melaErrorMessage(body?.error, response.status)) as Error & { status?: number; code?: string };
      error.status = response.status; error.code = body?.error;
      throw error;
    }
    return body;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Mela did not respond. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Could not reach Mela. Check your internet connection.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function melaErrorMessage(code: string | undefined, status: number): string {
  switch (code) {
    case 'invalid_credentials': return 'Invalid company, email/phone or password.';
    case 'too_many_attempts': return 'Too many failed sign-ins. Try again in 15 minutes.';
    case 'account_not_allowed': return 'This Mela account is not active.';
    case 'no_project_access': return 'Your Mela role cannot view projects.';
    case 'token_expired': case 'token_revoked': case 'invalid_token': case 'missing_token': return 'Your Mela sign-in has expired. Connect again.';
    default: return status >= 500 ? 'Mela is having a problem. Try again later.' : `Mela request failed (${status}).`;
  }
}

/** Mela's item_type is free text; tools/equipment become TOOL, everything else MATERIAL. */
export function melaItemKind(type: string | null): ItemKind {
  return /tool|equipment|machine|machinery|device/i.test(type || '') ? 'TOOL' : 'MATERIAL';
}

export function melaItemLink(item: MelaItem): ItemLink & { unit?: string } {
  return { source: 'mela', id: String(item.id), name: item.name, kind: melaItemKind(item.type), ...(item.category ? { category: item.category } : {}), ...(item.unit ? { unit: item.unit } : {}) };
}

export function supplierLink(supplier: MelaSupplier): SupplierLink {
  return { source: 'mela', id: supplier.id, name: supplier.store ? `${supplier.name} (${supplier.store})` : supplier.name };
}

export function projectLink(project: MelaProject): ProjectLink {
  return { source: 'mela', id: project.id, ...(project.code ? { code: project.code } : {}), title: project.title };
}

/** Active work first, then by title — finished projects stay findable but out of the way. */
/** Shown as "Abebe Kebede (CUST-12)"; falls back to whichever part Mela has. */
export function customerLabel(name?: string | null, id?: string | null): string | null {
  const n = name?.trim() || null, i = id?.trim() || null;
  if (n && i && n !== i) return `${n} (${i})`;
  return n || i;
}

export function sortProjects(projects: MelaProject[]): MelaProject[] {
  const closed = (status: string | null) => /^(done|completed|terminated|cancel)/i.test(status || '');
  return [...projects].sort((a, b) => Number(closed(a.status)) - Number(closed(b.status)) || a.title.localeCompare(b.title));
}

export class MelaService {
  private static syncing: Promise<MelaProject[]> | null = null;

  static async getConnection(): Promise<MelaConnection | null> {
    const raw = await Storage.getItem(CONNECTION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  static async isConnected(): Promise<boolean> { return !!(await this.getConnection()); }

  static async getProjects(): Promise<MelaProject[]> {
    const raw = await Storage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  static async getItems(): Promise<MelaItem[]> {
    const raw = await Storage.getItem(ITEMS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  static async getSuppliers(): Promise<MelaSupplier[]> {
    const raw = await Storage.getItem(SUPPLIERS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  static async connect(company: string, identifier: string, password: string): Promise<MelaConnection> {
    const body = await request('action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: company.trim().toLowerCase(), identifier: identifier.trim(), password }),
    });
    if (typeof body?.token !== 'string') throw new Error('Mela returned an unexpected response.');
    await saveToken(body.token);
    const connection: MelaConnection = {
      company: body.company, userName: body.user?.name || identifier.trim(), email: body.user?.email ?? null,
      connectedAt: Date.now(), expiresAt: Number(body.expires_at) * 1000,
      permissions: body.permissions,
    };
    await Storage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    await this.syncProjects();
    await import('./PrivateConfigurationService').then(m => m.default.updateMelaConnection()).catch(() => undefined);
    return (await this.getConnection())!;
  }

  static async disconnect(): Promise<void> {
    await deleteToken().catch(() => undefined);
    // Stop sharing a copy of lists from a connection that no longer exists.
    await import('./CatalogShareService').then(m => m.default.withdraw()).catch(() => undefined);
    await Storage.removeItem(CONNECTION_KEY);
    // Keep nothing cached for a disconnected source; transactions keep their own title snapshots.
    await Storage.removeItem(PROJECTS_KEY);
    await Storage.removeItem(ITEMS_KEY);
    await Storage.removeItem(SUPPLIERS_KEY);
    await import('./PrivateConfigurationService').then(m => m.default.updateMelaConnection()).catch(() => undefined);
  }

  /** Mela passwords are never retained; only the issued token can move devices. */
  static async exportPortableConnection(): Promise<{ token: string; connection: MelaConnection } | null> {
    const [token, connection] = await Promise.all([readToken(), this.getConnection()]);
    return token && connection ? { token, connection } : null;
  }

  static async restorePortableConnection(value: { token: string; connection: Record<string, unknown> }): Promise<void> {
    if (!value || typeof value.token !== 'string' || !value.token || !value.connection || typeof value.connection !== 'object') {
      throw new Error('Invalid Mela connection backup.');
    }
    await saveToken(value.token);
    await Storage.setItem(CONNECTION_KEY, JSON.stringify(value.connection));
    // This device has no guarantee that it owns the cache represented by the
    // other device's lastSyncAt, so populate its local lists immediately.
    await this.syncProjects().catch(() => undefined);
  }

  /** Apply a cloud disconnect without writing the same change back to the vault. */
  static async clearRestoredConnection(): Promise<void> {
    await deleteToken().catch(() => undefined);
    await Promise.all([CONNECTION_KEY, PROJECTS_KEY, ITEMS_KEY, SUPPLIERS_KEY].map(key => Storage.removeItem(key)));
  }

  static syncProjects(): Promise<MelaProject[]> {
    if (!this.syncing) this.syncing = this.doSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  /** Background refresh: only when connected, not flagged, and the list is older than 6 hours. */
  static async syncIfStale(): Promise<void> {
    const connection = await this.getConnection();
    if (!connection || connection.needsReconnect) return;
    // Projects cached before customer names were sent re-sync once to pick them up.
    const needsCustomers = (await this.getProjects()).some(p => p.customerId === undefined);
    if (!needsCustomers && connection.lastSyncAt && Date.now() - connection.lastSyncAt < AUTO_SYNC_AFTER_MS) return;
    await this.syncProjects().catch(() => undefined);
  }

  private static async doSync(): Promise<MelaProject[]> {
    const connection = await this.getConnection();
    if (!connection) throw new Error('Mela is not connected.');
    const token = await readToken();
    try {
      if (!token) throw Object.assign(new Error(melaErrorMessage('missing_token', 401)), { status: 401 });
      // Each list has its own Mela permission; a list the role can't see is
      // stored empty instead of failing the whole sync. Only an auth failure
      // (expired/revoked token, inactive account) needs a new sign-in.
      const fetchList = async (action: string, key: string, field: string): Promise<any[]> => {
        try {
          const body = await request(`action=${action}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
          return Array.isArray(body?.[field]) ? body[field] : [];
        } catch (error: any) {
          if (error?.status === 403 && /^no_\w+_access$/.test(error?.code || '')) { await Storage.setItem(key, '[]'); return []; }
          throw error;
        }
      };
      const projects: MelaProject[] = (await fetchList('projects', PROJECTS_KEY, 'projects'))
        .filter((p: any) => Number.isFinite(p?.id) && typeof p?.title === 'string')
        .map((p: any) => ({ id: p.id, code: p.code ?? null, title: p.title.trim() || `Project ${p.id}`, status: p.status ?? null, customer: customerLabel(p.customer, p.customer_id), customerId: p.customer_id ?? null }));
      const items: MelaItem[] = (await fetchList('items', ITEMS_KEY, 'items'))
        .filter((i: any) => Number.isFinite(i?.id) && typeof i?.name === 'string' && i.name.trim())
        .map((i: any) => ({ id: i.id, code: i.code ?? null, name: i.name.trim(), type: i.type ?? null, category: i.category ?? null, unit: i.unit ?? null }));
      const suppliers: MelaSupplier[] = (await fetchList('suppliers', SUPPLIERS_KEY, 'suppliers'))
        .filter((v: any) => Number.isFinite(v?.id) && typeof v?.name === 'string' && v.name.trim())
        .map((v: any) => ({ id: v.id, name: v.name.trim(), store: v.store ?? null }));
      await Storage.setItem(PROJECTS_KEY, JSON.stringify(projects));
      await Storage.setItem(ITEMS_KEY, JSON.stringify(items));
      await Storage.setItem(SUPPLIERS_KEY, JSON.stringify(suppliers));
      await Storage.setItem(CONNECTION_KEY, JSON.stringify({ ...connection, lastSyncAt: Date.now(), needsReconnect: false, lastError: undefined }));
      // Keep any copy shared with assistants up to date (no-op unless sharing is on).
      void import('./CatalogShareService').then(m => m.default.publish()).catch(() => undefined);
      return projects;
    } catch (error: any) {
      const authFailure = error?.status === 401 || (error?.status === 403 && !/^no_\w+_access$/.test(error?.code || ''));
      await Storage.setItem(CONNECTION_KEY, JSON.stringify({ ...connection, needsReconnect: authFailure || connection.needsReconnect, lastError: error?.message || String(error) }));
      throw error;
    }
  }
}

export default MelaService;
