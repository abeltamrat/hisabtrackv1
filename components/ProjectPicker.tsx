import FormSheet from '@/components/FormSheet';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import MelaService, { projectLink, sortProjects, type MelaItem, type MelaProject, type MelaSupplier } from '@/services/MelaService';
import type { ProjectLink } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import CatalogShareService, { type SharedCatalog, type SharedPrice } from '@/services/CatalogShareService';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * Lists shared by a fund owner, for an assistant recording into that owner's
 * fund. When provided, pickers below it use these instead of this device's
 * own Mela connection (which an assistant doesn't have).
 */
export interface CatalogOverride { projects: MelaProject[]; items: MelaItem[]; suppliers: MelaSupplier[]; prices?: Record<string, SharedPrice> }
export const MelaCatalogContext = createContext<CatalogOverride | null>(null);

/** The catalog a fund owner shared with me (null until it arrives, or if not shared). */
export function useSharedCatalog(ownerUid?: string): CatalogOverride | null {
  const [catalog, setCatalog] = useState<SharedCatalog | undefined>();
  useEffect(() => {
    if (!ownerUid) return;
    return CatalogShareService.subscribe(all => setCatalog(all[ownerUid]));
  }, [ownerUid]);
  return useMemo(() => (catalog ? { projects: catalog.projects, items: catalog.items, suppliers: catalog.suppliers, prices: catalog.prices } : null), [catalog]);
}

/** Live Mela connection state and imported lists (projects, items, suppliers) for any screen. */
export function useMelaProjects() {
  const override = useContext(MelaCatalogContext);
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<MelaProject[]>([]);
  const [items, setItems] = useState<MelaItem[]>([]);
  const [suppliers, setSuppliers] = useState<MelaSupplier[]>([]);
  const load = useCallback(async () => {
    const [connection, projectList, itemList, supplierList] = await Promise.all([MelaService.getConnection(), MelaService.getProjects(), MelaService.getItems(), MelaService.getSuppliers()]);
    setConnected(!!connection); setProjects(projectList); setItems(itemList); setSuppliers(supplierList);
  }, []);
  useEffect(() => { void load(); const unsubscribe = LocalChangeEmitter.subscribe(() => { void load(); }); return () => { unsubscribe(); }; }, [load]);
  // With an override, "connected" means the owner actually shared something.
  if (override) return { connected: override.projects.length + override.items.length + override.suppliers.length > 0, projects: override.projects, items: override.items, suppliers: override.suppliers, prices: override.prices };
  return { connected, projects, items, suppliers, prices: undefined as Record<string, SharedPrice> | undefined };
}

export function ProjectPicker({ visible, onClose, onSelect, selectedId }: {
  visible: boolean; onClose: () => void; onSelect: (project: ProjectLink | undefined) => void; selectedId?: number;
}) {
  const { projects } = useMelaProjects();
  const [query, setQuery] = useState('');
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = sortProjects(projects);
    return q ? sorted.filter(p => `${p.code || ''} ${p.title} ${p.customer || ''} ${p.id}`.toLowerCase().includes(q)) : sorted;
  }, [projects, query]);

  useEffect(() => { if (!visible) setQuery(''); }, [visible]);

  return (
    <FormSheet visible={visible} onClose={onClose} scrollable={false} accessibilityLabel="Choose project">
      <Text className="text-lg font-extrabold text-slate-900 dark:text-white mb-3">Choose project</Text>
      <View className="flex-row items-center bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 mb-3">
        <FontAwesome name="search" size={14} color="#94a3b8" />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by ID, title or customer" placeholderTextColor="#94a3b8" autoCorrect={false} className="flex-1 px-3 py-3 text-slate-900 dark:text-white" />
      </View>
      <TouchableOpacity onPress={() => { onSelect(undefined); onClose(); }} className="flex-row items-center p-3 rounded-2xl mb-2 bg-slate-50 dark:bg-slate-800/60">
        <FontAwesome name="ban" size={14} color="#94a3b8" />
        <Text className="ml-3 text-sm font-bold text-slate-600 dark:text-slate-300">No project</Text>
      </TouchableOpacity>
      <FlatList
        style={{ height: 380 }}
        data={visibleProjects}
        keyExtractor={item => String(item.id)}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={8}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <TouchableOpacity onPress={() => { onSelect(projectLink(item)); onClose(); }} className={`p-3 rounded-2xl mb-2 border ${selected ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
              <View className="flex-row items-center">
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-sm font-extrabold text-slate-900 dark:text-white">{item.title}</Text>
                  <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.code || `#${item.id}`}{item.customer ? ` · ${item.customer}` : ''}{item.status ? ` · ${item.status}` : ''}</Text>
                </View>
                {selected && <FontAwesome name="check" size={14} color="#6366f1" />}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">{projects.length ? 'No project matches your search.' : 'No projects yet. Sync from Connections.'}</Text>}
      />
    </FormSheet>
  );
}

/**
 * Tappable "Project" row for forms. Hidden when Mela isn't connected and
 * nothing is selected, so users without a connection never see it.
 */
export function ProjectField({ value, onChange, compact = false }: { value?: ProjectLink; onChange: (project: ProjectLink | undefined) => void; compact?: boolean }) {
  const { connected } = useMelaProjects();
  const [open, setOpen] = useState(false);
  if (!connected && !value) return null;
  return (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={value ? `Project ${value.title}` : 'Choose project'} disabled={!connected} onPress={() => setOpen(true)}
        className={`flex-row items-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <FontAwesome name="folder-open" size={compact ? 12 : 14} color="#6366f1" />
        <View className="flex-1 ml-3">
          {!compact && <Text className="text-[10px] font-bold text-slate-500 dark:text-slate-400">PROJECT</Text>}
          <Text numberOfLines={1} className={`${compact ? 'text-xs' : 'text-sm'} font-bold ${value ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
            {value ? `${value.code ? `${value.code} · ` : ''}${value.title}` : 'No project'}
          </Text>
        </View>
        {value
          ? <TouchableOpacity accessibilityLabel="Clear project" onPress={() => onChange(undefined)} className="p-1"><FontAwesome name="times-circle" size={compact ? 14 : 16} color="#94a3b8" /></TouchableOpacity>
          : <FontAwesome name="chevron-right" size={11} color="#94a3b8" />}
      </TouchableOpacity>
      <ProjectPicker visible={open} onClose={() => setOpen(false)} onSelect={onChange} selectedId={value?.id} />
    </>
  );
}

/**
 * "This is a project cost" checkbox, shown under "Split across categories".
 * Not every expense is a project cost, so the project picker stays hidden
 * until it's ticked; unticking clears the project. Hidden without Mela.
 */
export function ProjectCostToggle({ checked: on, onToggle, value, onChange, showPicker = true, income = false, variant = 'card', batch = false }: {
  /** Form-wide: when off, the form clears every project (transaction, parts, items). */
  checked: boolean;
  onToggle: (next: boolean) => void;
  value?: ProjectLink;
  onChange: (project: ProjectLink | undefined) => void;
  /** False while split: each part shows its own picker instead. */
  showPicker?: boolean;
  income?: boolean;
  variant?: 'card' | 'tile' | 'row';
  /** In a split form, choosing here applies the project to every part. */
  batch?: boolean;
}) {
  const { connected } = useMelaProjects();
  if (!connected && !on) return null;
  const label = income ? 'This is project income' : 'This is a project cost';
  const hint = batch
    ? 'Choose once to apply the project to every split. You can adjust individual parts afterward.'
    : !showPicker ? 'Choose a project on each split part.' : income ? 'Link this payment to a Mela project.' : 'Count this toward a Mela project\'s spending.';
  const toggle = () => onToggle(!on);
  const picker = on && showPicker ? <View className="mt-3"><ProjectField value={value} onChange={onChange} /></View> : null;

  if (variant === 'tile') return (
    <View>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={toggle}
        className={`min-h-[64px] flex-row items-center rounded-xl border p-3 ${on ? 'border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
        <View className={`h-8 w-8 items-center justify-center rounded-lg ${on ? 'bg-teal-600' : 'bg-slate-100 dark:bg-slate-700'}`}>
          <FontAwesome name="folder-open" size={14} color={on ? '#fff' : '#94a3b8'} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="font-bold text-slate-900 dark:text-white">{label}</Text>
          <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</Text>
        </View>
        <FontAwesome name={on ? 'check-circle' : 'circle-o'} size={20} color={on ? '#0d9488' : '#94a3b8'} />
      </TouchableOpacity>
      {picker}
    </View>
  );
  if (variant === 'row') return (
    <View>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={toggle} className="flex-row items-center py-2">
        <FontAwesome name={on ? 'check-square' : 'square-o'} size={18} color={on ? '#0d9488' : '#94a3b8'} />
        <Text className="text-slate-700 dark:text-slate-300 text-sm font-semibold ml-2">{label}</Text>
      </TouchableOpacity>
      {picker}
    </View>
  );
  return (
    <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 mb-3 shadow border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={toggle} className="flex-row items-center">
        <FontAwesome name={on ? 'check-square' : 'square-o'} size={18} color={on ? '#6366f1' : '#94a3b8'} />
        <View className="ml-2 flex-1"><Text className="text-slate-900 dark:text-white text-sm font-bold">{label}</Text><Text className="text-slate-500 dark:text-slate-400 text-[10px]">{hint}</Text></View>
        <FontAwesome name="folder-open" size={14} color="#6366f1" />
      </TouchableOpacity>
      {picker}
    </View>
  );
}

export default ProjectPicker;
