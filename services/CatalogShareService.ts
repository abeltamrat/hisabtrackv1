import { getFirebaseApp } from '@/config/firebaseApp';
import { getAuth } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import type { MelaItem, MelaProject, MelaSupplier } from './MelaService';
import Storage from './SessionStorage';
import { priceInsight, purchaseRecords } from '@/utils/itemFinance';

/**
 * Shares the owner's Mela projects, items and suppliers — plus price history
 * for Mela items only — with the assistants they choose (people holding one of
 * their funds). Assistants never get the Mela login; they read a copy at
 * sharedCatalogs/{ownerUid}, which Firestore rules restrict to allowedUids.
 * Lists are chunked so thousands of projects stay under the 1 MB doc limit.
 */

export interface ShareSettings { enabled: boolean; allowedUids: string[] }
export interface SharedPrice {
  unit?: string;
  last?: { price: number; supplier?: string; date: number };
  best?: { price: number; supplier?: string; date: number };
  typical?: number;
  samples: number;
}
export interface SharedCatalog {
  ownerUid: string;
  ownerName?: string;
  projects: MelaProject[];
  items: MelaItem[];
  suppliers: MelaSupplier[];
  prices: Record<string, SharedPrice>;
  updatedAt: number;
}

const SETTINGS_KEY = 'mela_share';
const CHUNK = 400;
type ChunkKind = 'projects' | 'items' | 'suppliers' | 'prices';

const db = () => getFirestore(getFirebaseApp());
const myUid = () => getAuth(getFirebaseApp()).currentUser?.uid ?? null;

export function chunk<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Price history for Mela items only — personal items (groceries etc.) are never shared. */
export function sharedPrices(transactions: Parameters<typeof purchaseRecords>[0], now = Date.now()): Record<string, SharedPrice> {
  const records = purchaseRecords(transactions).filter(r => r.item.source === 'mela');
  const prices: Record<string, SharedPrice> = {};
  for (const key of new Set(records.map(r => r.key))) {
    const insight = priceInsight(records, key, now);
    const strip = (r: typeof insight.last) => r && { price: r.unitPrice, ...(r.supplier ? { supplier: r.supplier } : {}), date: r.date };
    prices[key] = {
      ...(insight.last?.unit ? { unit: insight.last.unit } : {}),
      ...(insight.last ? { last: strip(insight.last) } : {}),
      ...(insight.best ? { best: strip(insight.best) } : {}),
      ...(insight.typical !== undefined ? { typical: insight.typical } : {}),
      samples: insight.samples,
    };
  }
  return prices;
}

type Listener = (catalogs: Record<string, SharedCatalog>) => void;

export class CatalogShareService {
  private static received: Record<string, SharedCatalog> = {};
  private static listeners = new Set<Listener>();
  private static unsubscribe: (() => void) | null = null;

  static async getSettings(): Promise<ShareSettings> {
    const raw = await Storage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { enabled: false, allowedUids: [] };
  }

  static async setSettings(settings: ShareSettings, ownerName?: string): Promise<void> {
    const clean = { enabled: settings.enabled, allowedUids: [...new Set(settings.allowedUids)].slice(0, 50) };
    await Storage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    await this.publish(ownerName);
  }

  /** Publishes (or withdraws) the shared copy to match current settings and data. */
  static async publish(ownerName?: string): Promise<void> {
    const uid = myUid();
    if (!uid) return;
    const settings = await this.getSettings();
    const { default: MelaService } = await import('./MelaService');
    if (!settings.enabled || !settings.allowedUids.length || !(await MelaService.isConnected())) { await this.withdraw(); return; }

    const { getDatabase } = await import('./database');
    const [projects, items, suppliers, transactions] = await Promise.all([
      MelaService.getProjects(), MelaService.getItems(), MelaService.getSuppliers(), (await getDatabase()).getTransactions(),
    ]);
    const prices = Object.entries(sharedPrices(transactions));
    const metaRef = doc(db(), 'sharedCatalogs', uid);
    const previous = (await getDoc(metaRef)).data()?.chunks as string[] | undefined;

    const written: string[] = [];
    const parts: Array<[ChunkKind, unknown[]]> = [['projects', projects], ['items', items], ['suppliers', suppliers], ['prices', prices]];
    for (const [kind, rows] of parts) {
      const pieces = chunk(rows);
      for (let index = 0; index < pieces.length; index++) {
        const id = `${kind}-${index}`;
        await setDoc(doc(db(), 'sharedCatalogs', uid, 'chunks', id), { ownerUid: uid, kind, index, rows: pieces[index] });
        written.push(id);
      }
    }
    // Meta last: assistants only look for chunks the meta doc lists.
    await setDoc(metaRef, { ownerUid: uid, ...(ownerName ? { ownerName } : {}), allowedUids: settings.allowedUids, chunks: written, updatedAt: Date.now() });
    for (const stale of (previous || []).filter(id => !written.includes(id))) await deleteDoc(doc(db(), 'sharedCatalogs', uid, 'chunks', stale)).catch(() => undefined);
  }

  static async withdraw(): Promise<void> {
    const uid = myUid();
    if (!uid) return;
    const metaRef = doc(db(), 'sharedCatalogs', uid);
    const meta = await getDoc(metaRef).catch(() => null);
    if (!meta?.exists()) return;
    await deleteDoc(metaRef);
    for (const id of (meta.data()?.chunks as string[] | undefined) || []) await deleteDoc(doc(db(), 'sharedCatalogs', uid, 'chunks', id)).catch(() => undefined);
  }

  /** Assistant side: catalogs other owners share with me, keyed by owner uid. */
  static getReceived(): Record<string, SharedCatalog> { return this.received; }

  static subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.received);
    this.start();
    return () => { this.listeners.delete(listener); };
  }

  private static start() {
    const uid = myUid();
    if (this.unsubscribe || !uid) return;
    this.unsubscribe = onSnapshot(query(collection(db(), 'sharedCatalogs'), where('allowedUids', 'array-contains', uid)), async snapshot => {
      const next: Record<string, SharedCatalog> = {};
      for (const metaDoc of snapshot.docs) {
        const meta = metaDoc.data();
        const catalog: SharedCatalog = { ownerUid: metaDoc.id, ownerName: meta.ownerName, projects: [], items: [], suppliers: [], prices: {}, updatedAt: meta.updatedAt || 0 };
        const cached = this.received[metaDoc.id];
        if (cached && cached.updatedAt === catalog.updatedAt) { next[metaDoc.id] = cached; continue; }
        try {
          const chunks = await getDocs(collection(db(), 'sharedCatalogs', metaDoc.id, 'chunks'));
          for (const c of chunks.docs) {
            const data = c.data();
            if (!Array.isArray(data.rows) || !(meta.chunks || []).includes(c.id)) continue;
            if (data.kind === 'prices') for (const [key, value] of data.rows) catalog.prices[key] = value;
            else if (data.kind === 'projects' || data.kind === 'items' || data.kind === 'suppliers') (catalog[data.kind as 'projects'] as unknown[]).push(...data.rows);
          }
          next[metaDoc.id] = catalog;
        } catch (error) {
          console.warn('Shared catalog unavailable:', error);
        }
      }
      this.received = next;
      for (const listener of this.listeners) listener(next);
    }, error => console.warn('Shared catalogs listener failed:', error));
  }

  static stop() { this.unsubscribe?.(); this.unsubscribe = null; this.received = {}; }
}

export default CatalogShareService;
