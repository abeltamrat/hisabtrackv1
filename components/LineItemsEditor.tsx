import { ProjectField, useMelaProjects } from '@/components/ProjectPicker';
import { melaItemLink } from '@/services/MelaService';
import type { RootState } from '@/store';
import type { ItemKind, ItemLink, PurchaseLine } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';
import { buildCatalog, isUnusualPrice, itemKey, localItem, priceInsight, purchaseRecords, type CatalogEntry } from '@/utils/itemFinance';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';

const KINDS: Array<[ItemKind, string]> = [['MATERIAL', 'Material'], ['TOOL', 'Tool'], ['OTHER', 'Other']];
const num = (value: string) => Number(value.replace(',', '.'));

/** Items from purchase history plus any extra catalog (e.g. Mela items), for suggestions and hints. */
export function useItemCatalog(extra: ItemLink[] = []) {
  const transactions = useSelector((state: RootState) => state.transactions.items);
  const { items: melaItems } = useMelaProjects();
  const records = useMemo(() => purchaseRecords(transactions), [transactions]);
  const catalog = useMemo(() => buildCatalog(records, [...melaItems.map(melaItemLink), ...extra]), [records, melaItems, extra]);
  return { records, catalog };
}

export default function LineItemsEditor({ lines, onChange, total, formatCurrency, extraItems = [], onUseTotal, showProject = true }: {
  lines: PurchaseLine[];
  /** Per-item project pickers (only for project costs; items in a split part use the part's project). */
  showProject?: boolean;
  onChange: (lines: PurchaseLine[]) => void;
  total: number;
  formatCurrency: (amount: number) => string;
  extraItems?: ItemLink[];
  /** Offered when lines and the transaction amount differ. */
  onUseTotal?: (linesTotal: number) => void;
}) {
  const { records, catalog } = useItemCatalog(extraItems);
  const linesTotal = sumMoney(lines.map(line => line.amount));
  const remainder = money(total - linesTotal);

  const update = (id: string, patch: Partial<PurchaseLine>) => onChange(lines.map(line => {
    if (line.id !== id) return line;
    const next = { ...line, ...patch };
    return { ...next, amount: money((Number(next.quantity) || 0) * (Number(next.unit_price) || 0)) };
  }));
  const add = () => onChange([...lines, { id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, item: localItem(''), quantity: 1, unit_price: 0, amount: 0 }]);

  return (
    <View>
      {lines.map((line, index) => (
        <LineRow key={line.id} index={index} line={line} catalog={catalog} records={records} formatCurrency={formatCurrency} showProject={showProject}
          onChange={patch => update(line.id, patch)} onRemove={() => onChange(lines.filter(l => l.id !== line.id))} />
      ))}
      <TouchableOpacity accessibilityRole="button" onPress={add} className="flex-row items-center justify-center py-3 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 mb-2">
        <FontAwesome name="plus" size={12} color="#6366f1" />
        <Text className="ml-2 text-indigo-600 dark:text-indigo-300 text-sm font-bold">Add item</Text>
      </TouchableOpacity>
      <View className="flex-row justify-between items-center">
        <Text className="text-xs text-slate-600 dark:text-slate-300">Items {formatCurrency(linesTotal)} of {formatCurrency(total)}</Text>
        {remainder < 0
          ? <Text className="text-xs font-bold text-red-600 dark:text-red-400">Over by {formatCurrency(-remainder)}</Text>
          : remainder > 0 ? <Text className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(remainder)} not itemized</Text> : <Text className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Matches</Text>}
      </View>
      {onUseTotal && lines.length > 0 && remainder !== 0 && (
        <TouchableOpacity onPress={() => onUseTotal(linesTotal)} className="mt-2 self-end px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800">
          <Text className="text-xs font-bold text-slate-700 dark:text-slate-200">Set amount to {formatCurrency(linesTotal)}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function LineRow({ index, line, catalog, records, formatCurrency, onChange, onRemove, showProject }: {
  index: number; line: PurchaseLine; catalog: CatalogEntry[]; records: ReturnType<typeof purchaseRecords>; showProject: boolean;
  formatCurrency: (amount: number) => string; onChange: (patch: Partial<PurchaseLine>) => void; onRemove: () => void;
}) {
  const [query, setQuery] = useState(line.item.name);
  const [focused, setFocused] = useState(false);
  const [qtyText, setQtyText] = useState(String(line.quantity || ''));
  const [priceText, setPriceText] = useState(line.unit_price ? String(line.unit_price) : '');
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!focused || !q) return [];
    return catalog
      .filter(entry => entry.item.name.toLowerCase().includes(q) && entry.key !== itemKey(line.item))
      .sort((a, b) => Number(b.item.name.toLowerCase().startsWith(q)) - Number(a.item.name.toLowerCase().startsWith(q)) || b.purchases - a.purchases)
      .slice(0, 6);
  }, [catalog, focused, line.item, query]);

  const { prices: sharedPrices } = useMelaProjects();
  const insight = useMemo(() => {
    if (!line.item.name) return undefined;
    const local = priceInsight(records.filter(r => r.lineId !== line.id), itemKey(line.item));
    // An assistant has no history of their own: fall back to the owner's shared Mela-item prices.
    const shared = line.item.source === 'mela' ? sharedPrices?.[itemKey(line.item)] : undefined;
    if (local.last || !shared?.last) return local;
    const asRecord = (p: { price: number; supplier?: string; date: number }) => ({ key: itemKey(line.item), item: line.item, transactionId: '', lineId: '', type: 'EXPENSE' as const, date: p.date, quantity: 1, unit: shared.unit, unitPrice: p.price, amount: p.price, supplier: p.supplier });
    const last = asRecord(shared.last);
    const best = shared.best ? asRecord(shared.best) : undefined;
    return { last, best, typical: shared.typical, samples: shared.samples };
  }, [line.id, line.item, records, sharedPrices]);
  const unusual = insight && line.unit_price > 0 && isUnusualPrice(line.unit_price, insight);

  const pick = (entry: CatalogEntry) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setQuery(entry.item.name); setFocused(false);
    const last = entry.last;
    if (last && !line.unit_price) setPriceText(String(last.unitPrice));
    onChange({ item: entry.item, unit: line.unit || entry.unit || last?.unit, ...(last && !line.unit_price ? { unit_price: last.unitPrice } : {}) });
  };

  return (
    <View className="bg-white dark:bg-slate-900 rounded-xl p-3 mb-3 border border-slate-200 dark:border-slate-700">
      <View className="flex-row items-center mb-2">
        <Text className="text-slate-600 dark:text-slate-300 text-xs font-bold flex-1">Item {index + 1}{line.item.source === 'mela' ? ' · Mela' : ''}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove item ${index + 1}`} onPress={onRemove} className="p-2"><FontAwesome name="trash-o" size={15} color="#ef4444" /></TouchableOpacity>
      </View>

      <TextInput
        value={query}
        onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocused(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 300); }}
        onChangeText={value => { setQuery(value); onChange({ item: localItem(value, { kind: line.item.kind, category: line.item.category }) }); }}
        placeholder="What did you buy? (e.g. Cement 50kg, Oranges)"
        placeholderTextColor="#94a3b8"
        accessibilityLabel={`Item name ${index + 1}`}
        className="bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white"
      />
      {suggestions.length > 0 && (
        <View className="mt-1 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {suggestions.map(entry => (
            <TouchableOpacity
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={`Use item ${entry.item.name}`}
              onPressIn={() => { if (blurTimer.current) clearTimeout(blurTimer.current); }}
              onPress={() => pick(entry)}
              className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700"
            >
              <Text numberOfLines={1} className="text-sm text-slate-900 dark:text-white font-semibold">{entry.item.name}{entry.item.source === 'mela' ? '  · Mela' : ''}</Text>
              {entry.last && <Text numberOfLines={1} className="text-[11px] text-slate-500 dark:text-slate-400">Last {formatCurrency(entry.last.unitPrice)}{entry.unit ? `/${entry.unit}` : ''}{entry.last.supplier ? ` · ${entry.last.supplier}` : ''}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View className="flex-row mt-2 gap-2">
        {KINDS.map(([kind, label]) => {
          const selected = (line.item.kind ?? 'OTHER') === kind;
          return <TouchableOpacity key={kind} onPress={() => onChange({ item: { ...line.item, kind } })} className={`px-3 py-1 rounded-full ${selected ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-800'}`}><Text className={`text-[11px] font-bold ${selected ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{label}</Text></TouchableOpacity>;
        })}
      </View>

      <View className="flex-row mt-2 gap-2">
        <TextInput value={qtyText} onChangeText={value => { setQtyText(value); onChange({ quantity: num(value) || 0 }); }} keyboardType="decimal-pad" placeholder="Qty" placeholderTextColor="#94a3b8" accessibilityLabel="Quantity" className="w-16 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white" />
        <TextInput value={line.unit || ''} onChangeText={value => onChange({ unit: value.trim() ? value : undefined })} placeholder="Unit" placeholderTextColor="#94a3b8" autoCapitalize="none" accessibilityLabel="Unit" className="w-20 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white" />
        <TextInput value={priceText} onChangeText={value => { setPriceText(value); onChange({ unit_price: num(value) || 0 }); }} keyboardType="decimal-pad" placeholder="Unit price" placeholderTextColor="#94a3b8" accessibilityLabel="Unit price" className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white" />
      </View>
      <Text className="text-right text-xs font-bold text-slate-700 dark:text-slate-200 mt-1">= {formatCurrency(line.amount)}</Text>

      {insight?.last && (
        <View className={`mt-2 rounded-lg px-3 py-2 ${unusual ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-slate-50 dark:bg-slate-800'}`}>
          <Text className="text-[11px] text-slate-600 dark:text-slate-300">
            Last {formatCurrency(insight.last.unitPrice)}{insight.last.unit ? `/${insight.last.unit}` : ''}{insight.last.supplier ? ` from ${insight.last.supplier}` : ''} on {new Date(insight.last.date).toLocaleDateString()}
          </Text>
          {insight.best && insight.best.unitPrice < insight.last.unitPrice && (
            <Text className="text-[11px] text-emerald-700 dark:text-emerald-300">Cheapest in 90 days: {formatCurrency(insight.best.unitPrice)}{insight.best.supplier ? ` at ${insight.best.supplier}` : ''}</Text>
          )}
          {unusual && <Text className="text-[11px] font-bold text-amber-700 dark:text-amber-300">Above your usual {formatCurrency(insight.typical!)} — check the price.</Text>}
        </View>
      )}

      {showProject && <View className="mt-2"><ProjectField value={line.project} onChange={project => onChange({ project })} compact /></View>}
    </View>
  );
}
