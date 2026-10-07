import CategoryIcon from '@/components/CategoryIcon';
import { AppDispatch, RootState } from '@/store';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';
import { useFormErrors } from '@/hooks/useFormErrors';
import { useSelector } from 'react-redux';
import { Category, useTransactions } from '../context/TransactionContext';
import { operatingTransactions, sumMoney } from '@/utils/finance';
import { themeTokens } from '@/constants/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type IconGroup = { id: string; title: string; items: string[] };
type SortMode = 'name' | 'usage' | 'amount';
type FilterMode = 'all' | 'income' | 'expense';

interface CategoryStat {
  count: number;         // all-time transaction count
  monthAmount: number;   // spend/income this calendar month
  lastUsed: number | null;
  sharePercent: number;  // % of total this month (same type)
  isUnused: boolean;     // no transaction in 60+ days
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SWIPE_REVEAL = 140; // px — width of revealed action buttons
const SWIPE_TRIGGER = 60; // px — minimum drag to snap open
const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

const AVAILABLE_COLORS = [
  '#ef4444', '#f59e0b', '#eab308', '#10b981', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#84cc16', '#22d3ee', '#fb923c', '#64748b',
];

const ICON_GROUPS: IconGroup[] = [
  { id: 'finance', title: 'Finance & Work', items: ['money', 'credit-card', 'bank', 'calculator', 'briefcase', 'pie-chart', 'bar-chart', 'line-chart', 'usd', 'eur', 'bitcoin', 'ticket'] },
  { id: 'shopping', title: 'Shopping & Food', items: ['shopping-cart', 'shopping-bag', 'shopping-basket', 'cutlery', 'coffee', 'glass', 'beer', 'birthday-cake', 'gift', 'tag', 'tags'] },
  { id: 'transport', title: 'Transport & Travel', items: ['bus', 'taxi', 'car', 'motorcycle', 'bicycle', 'train', 'truck', 'road', 'plane', 'ship', 'map-marker'] },
  { id: 'home', title: 'Home & Lifestyle', items: ['home', 'building-o', 'university', 'key', 'lock', 'shield', 'leaf', 'tree', 'paw', 'sun-o', 'moon-o', 'fire', 'bolt'] },
  { id: 'tech', title: 'Tech & Media', items: ['phone', 'mobile', 'laptop', 'desktop', 'tablet', 'wifi', 'globe', 'envelope', 'camera', 'film', 'music', 'headphones', 'gamepad', 'book', 'graduation-cap'] },
  { id: 'people', title: 'People & Health', items: ['heart', 'heartbeat', 'medkit', 'stethoscope', 'hospital-o', 'users', 'user', 'child', 'male', 'female', 'folder', 'star', 'trophy'] },
  { id: 'emoji-money', title: 'Emoji Money', items: ['emoji:💰', 'emoji:💸', 'emoji:💳', 'emoji:🏦', 'emoji:🧾', 'emoji:📈', 'emoji:📉', 'emoji:📊', 'emoji:🪙', 'emoji:💵', 'emoji:💶', 'emoji:💷'] },
  { id: 'emoji-life', title: 'Emoji Lifestyle', items: ['emoji:🍔', 'emoji:🍕', 'emoji:☕', 'emoji:🛒', 'emoji:🛍️', 'emoji:🚗', 'emoji:⛽', 'emoji:🏠', 'emoji:📱', 'emoji:💻', 'emoji:🎓', 'emoji:🏥', 'emoji:🎮', 'emoji:🎵', 'emoji:🎁', 'emoji:✈️'] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLastUsed(ts: number | null): string {
  if (!ts) return 'Never used';
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── SwipeableRow ─────────────────────────────────────────────────────────────

interface SwipeableRowProps {
  onDelete: () => void;
  onMerge: () => void;
  activeRef: React.MutableRefObject<(() => void) | null>;
  children: React.ReactNode;
}

function SwipeableRow({ onDelete, onMerge, activeRef, children }: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const close = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start();
    isOpen.current = false;
  }, [translateX]);

  const open = useCallback(() => {
    // Close previously open row
    if (activeRef.current && activeRef.current !== close) {
      activeRef.current();
    }
    activeRef.current = close;
    Animated.spring(translateX, { toValue: -SWIPE_REVEAL, useNativeDriver: true, tension: 120, friction: 10 }).start();
    isOpen.current = true;
  }, [translateX, close, activeRef]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5,
      onPanResponderGrant: () => {
        (translateX as any).stopAnimation();
      },
      onPanResponderMove: (_, { dx }) => {
        const base = isOpen.current ? -SWIPE_REVEAL : 0;
        const next = Math.max(-SWIPE_REVEAL, Math.min(0, base + dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, { dx, vx }) => {
        const base = isOpen.current ? -SWIPE_REVEAL : 0;
        const finalPos = base + dx;
        const shouldOpen = finalPos < -SWIPE_TRIGGER || vx < -0.5;
        if (shouldOpen) { open(); } else { close(); }
      },
    })
  ).current;

  return (
    <View style={{ overflow: 'hidden', marginBottom: 6 }}>
      {/* Revealed action buttons */}
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', width: SWIPE_REVEAL }}>
        <TouchableOpacity
          onPress={() => { close(); setTimeout(onMerge, 200); }}
          style={{ width: 70, backgroundColor: '#f59e0b', justifyContent: 'center', alignItems: 'center' }}
        >
          <FontAwesome name="code-fork" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 10, marginTop: 3, fontWeight: '600' }}>Merge</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { close(); setTimeout(onDelete, 200); }}
          style={{ width: 70, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', borderRadius: 0 }}
        >
          <FontAwesome name="trash" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 10, marginTop: 3, fontWeight: '600' }}>Delete</Text>
        </TouchableOpacity>
      </View>
      {/* Sliding content */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// ─── Merge Modal ──────────────────────────────────────────────────────────────

interface MergeModalProps {
  source: Category;
  candidates: Category[];
  onConfirm: (target: Category) => void;
  onClose: () => void;
}

function MergeModal({ source, candidates, onConfirm, onClose }: MergeModalProps) {
  const [selected, setSelected] = useState<Category | null>(null);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a' }}>Merge Category</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <FontAwesome name="times" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#64748b', fontSize: 13, marginBottom: 20, lineHeight: 19 }}>
            All transactions in <Text style={{ fontWeight: '700', color: '#0f172a' }}>"{source.name}"</Text> will be moved to the selected category.
            {'\n'}<Text style={{ color: '#9333ea', fontWeight: '600' }}>"{source.name}"</Text> will then be deleted. Budgets and recurring transactions update automatically.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {candidates.map(cat => (
              <TouchableOpacity
                key={cat.id}
                onPress={() => setSelected(cat)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 14,
                  borderRadius: 16,
                  marginBottom: 8,
                  backgroundColor: selected?.id === cat.id ? cat.color + '15' : '#f8fafc',
                  borderWidth: 2,
                  borderColor: selected?.id === cat.id ? cat.color : 'transparent',
                }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: cat.color + '20', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                  <CategoryIcon icon={cat.icon} size={20} color={cat.color} />
                </View>
                <Text style={{ flex: 1, fontWeight: '600', color: '#0f172a', fontSize: 15 }}>{cat.name}</Text>
                {selected?.id === cat.id && <FontAwesome name="check-circle" size={20} color={cat.color} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            onPress={() => selected && onConfirm(selected)}
            disabled={!selected}
            style={{
              backgroundColor: selected ? '#f59e0b' : '#e2e8f0',
              borderRadius: 14,
              height: 52,
              justifyContent: 'center',
              alignItems: 'center',
              marginTop: 16,
            }}
          >
            <Text style={{ color: selected ? '#fff' : '#94a3b8', fontWeight: '700', fontSize: 15 }}>
              {selected ? `Merge into "${selected.name}"` : 'Select a category'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ManageCategoriesScreen() {
  const colorScheme = useColorScheme();
  const { errors, validate, clearError, resetErrors } = useFormErrors<'name'>();
  const isDark = colorScheme === 'dark';
  const theme = themeTokens(isDark);
  const router = useRouter();
  const { categories, addCategory, updateCategory, deleteCategory } = useTransactions();
  const transactions = useSelector((s: RootState) => s.transactions.items);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [mergingCategory, setMergingCategory] = useState<Category | null>(null);
  const [openIconGroup, setOpenIconGroup] = useState<string>('finance');
  const [formData, setFormData] = useState<Partial<Category>>({ name: '', icon: 'folder', color: '#6366f1', type: 'expense', parentId: undefined });
  const [merging, setMerging] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Ref shared across all swipeable rows — tracks which row is open
  const activeSwipeClose = useRef<(() => void) | null>(null);

  // ── Tree helpers ─────────────────────────────────────────────────────────
  // Returns IDs of all descendants of a given category (any depth)
  const getAllDescendantIds = useCallback((parentId: string, cats: Category[] = categories): string[] => {
    const direct = cats.filter(c => c.parentId === parentId);
    return direct.flatMap(c => [c.id, ...getAllDescendantIds(c.id, cats)]);
  }, [categories]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Stats computation ─────────────────────────────────────────────────────
  const categoryStats = useMemo<Record<string, CategoryStat>>(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    const monthTxs = operatingTransactions(transactions.filter(t => t.date >= monthStartMs));
    const totalExpense = sumMoney(monthTxs.filter(t => t.type === 'EXPENSE').map(t => t.amount));
    const totalIncome = sumMoney(monthTxs.filter(t => t.type === 'INCOME').map(t => t.amount));

    const result: Record<string, CategoryStat> = {};
    for (const cat of categories) {
      const catTxs = operatingTransactions(transactions.filter(t => t.category === cat.name));
      const monthAmount = sumMoney(catTxs.filter(t => t.date >= monthStartMs).map(t => t.amount));
      const lastUsed = catTxs.length > 0 ? Math.max(...catTxs.map(t => t.date)) : null;
      const total = cat.type === 'expense' ? totalExpense : totalIncome;
      result[cat.id] = {
        count: catTxs.length,
        monthAmount,
        lastUsed,
        sharePercent: total > 0 ? (monthAmount / total) * 100 : 0,
        isUnused: lastUsed === null || Date.now() - lastUsed > SIXTY_DAYS,
      };
    }
    return result;
  }, [transactions, categories]);

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const visibleCategories = useMemo(() => {
    let list = categories.filter(c => {
      if (filter !== 'all' && c.type !== filter) return false;
      if (search.trim() && !c.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      const sa = categoryStats[a.id];
      const sb = categoryStats[b.id];
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'usage') return (sb?.count ?? 0) - (sa?.count ?? 0);
      if (sort === 'amount') return (sb?.monthAmount ?? 0) - (sa?.monthAmount ?? 0);
      return 0;
    });

    return list;
  }, [categories, filter, search, sort, categoryStats]);

  const rootCategories = visibleCategories.filter(c => !c.parentId);
  const getChildren = (parentId: string) => visibleCategories.filter(c => c.parentId === parentId);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const name = (formData.name ?? '').trim();
    if (!validate({ name: !name && 'Enter a name for this category.' })) return;
    try {
      await addCategory({ name, icon: formData.icon!, color: formData.color!, type: formData.type!, parentId: formData.parentId });
      setShowAddModal(false);
      resetForm();
    } catch { Alert.alert('Error', 'Failed to save category.'); }
  };

  const handleEdit = async () => {
    if (!editingCategory) return;
    const name = (formData.name ?? '').trim();
    if (!validate({ name: !name && 'Enter a name for this category.' })) return;
    try {
      await updateCategory(editingCategory.id, { name, icon: formData.icon!, color: formData.color!, type: formData.type!, parentId: formData.parentId });
      setEditingCategory(null);
      resetForm();
    } catch { Alert.alert('Error', 'Failed to update category.'); }
  };

  const handleDelete = (cat: Category) => {
    const descendantIds = getAllDescendantIds(cat.id);
    const allIds = [cat.id, ...descendantIds];
    const allNames = new Set(categories.filter(c => allIds.includes(c.id)).map(c => c.name));
    const txCount = transactions.filter(t => allNames.has(t.category)).length;
    const childCount = descendantIds.length;

    const lines: string[] = [];
    if (childCount > 0) lines.push(`This will also delete ${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'}.`);
    if (txCount > 0) lines.push(`${txCount} transaction${txCount === 1 ? '' : 's'} will be reassigned to "Other".`);
    if (lines.length === 0) lines.push(`Are you sure you want to delete "${cat.name}"?`);

    Alert.alert('Delete Category', lines.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteCategory(cat.id); } catch { Alert.alert('Error', 'Failed to delete.'); } } },
    ]);
  };

  const handleMergeConfirm = async (target: Category) => {
    if (!mergingCategory) return;
    setMerging(true);
    try {
      // Rename source to target's name → cascade updates all transactions
      await updateCategory(mergingCategory.id, { name: target.name });
      // Delete the now-duplicate source category
      await deleteCategory(mergingCategory.id);
      setMergingCategory(null);
    } catch (e) {
      Alert.alert('Error', 'Merge failed. Please try again.');
    } finally {
      setMerging(false);
    }
  };

  const openAdd = (parentId?: string) => {
    resetForm();
    setFormData(prev => ({
      ...prev,
      parentId,
      type: parentId ? (categories.find(c => c.id === parentId)?.type ?? 'expense') : 'expense',
    }));
    setShowAddModal(true);
  };

  const openEdit = (cat: Category) => {
    setEditingCategory(cat);
    setFormData({ name: cat.name, icon: cat.icon, color: cat.color, type: cat.type, parentId: cat.parentId });
  };

  const resetForm = () => {
    resetErrors();
    setFormData({ name: '', icon: 'folder', color: '#6366f1', type: 'expense', parentId: undefined });
    setOpenIconGroup('finance');
  };

  // ── Category Row Renderer ─────────────────────────────────────────────────
  const renderRow = useCallback((cat: Category, level = 0) => {
    const stat = categoryStats[cat.id];
    // Use full category list for child detection (not filtered list)
    const directChildren = categories.filter(c => c.parentId === cat.id);
    const hasChildren = directChildren.length > 0;
    const isCollapsed = collapsedIds.has(cat.id);
    // Only show visible (filtered) children
    const visibleChildren = isCollapsed ? [] : getChildren(cat.id);

    return (
      <View key={cat.id} style={{ marginLeft: level * 16 }}>
        <SwipeableRow
          activeRef={activeSwipeClose}
          onDelete={() => handleDelete(cat)}
          onMerge={() => setMergingCategory(cat)}
        >
          <View style={{
            backgroundColor: theme.surface,
            borderRadius: 16,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: theme.surfaceMuted,
            elevation: 1,
          }}>
            {/* Main row */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* Collapse toggle (only when has children) */}
              {hasChildren ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Expand or collapse subcategories" accessibilityState={{ expanded: !isCollapsed }}
                  onPress={() => toggleCollapse(cat.id)}
                  style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: cat.color + '18', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}
                >
                  <CategoryIcon icon={cat.icon} size={17} color={cat.color} />
                  <View style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: 7, backgroundColor: cat.color, justifyContent: 'center', alignItems: 'center' }}>
                    <FontAwesome name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={7} color="#fff" />
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: cat.color + '18', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                  <CategoryIcon icon={cat.icon} size={19} color={cat.color} />
                </View>
              )}

              {/* Info */}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }} numberOfLines={1}>
                    {cat.name}
                  </Text>
                  {hasChildren && (
                    <View style={{ backgroundColor: cat.color + '22', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: cat.color }}>
                        {directChildren.length} sub
                      </Text>
                    </View>
                  )}
                  {stat?.isUnused && (
                    <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: '#92400e' }}>UNUSED</Text>
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 }}>
                  <View style={{ backgroundColor: cat.type === 'income' ? '#dcfce7' : '#fee2e2', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: cat.type === 'income' ? '#166534' : '#991b1b' }}>
                      {cat.type.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>
                    {stat?.count ?? 0} txns · {formatLastUsed(stat?.lastUsed ?? null)}
                  </Text>
                </View>
              </View>

              {/* Actions */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add"
                  onPress={() => openAdd(cat.id)}
                  style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: cat.color + '18', justifyContent: 'center', alignItems: 'center' }}
                >
                  <FontAwesome name="plus" size={11} color={cat.color} />
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit"
                  onPress={() => openEdit(cat)}
                  style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: '#eff6ff', justifyContent: 'center', alignItems: 'center' }}
                >
                  <FontAwesome name="edit" size={11} color="#3b82f6" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Spend bar — only if used this month */}
            {(stat?.sharePercent ?? 0) > 0 && (
              <View style={{ marginTop: 7 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8' }}>This month</Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: cat.color }}>
                    {stat.sharePercent.toFixed(1)}%
                  </Text>
                </View>
                <View style={{ height: 4, backgroundColor: theme.surfaceMuted, borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${Math.min(100, stat.sharePercent)}%`, backgroundColor: cat.color, borderRadius: 2 }} />
                </View>
              </View>
            )}
          </View>
        </SwipeableRow>

        {/* Children — only rendered when not collapsed */}
        {visibleChildren.map(child => renderRow(child, level + 1))}
      </View>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryStats, isDark, categories, collapsedIds]);

  // ─── Merge candidates ────────────────────────────────────────────────────
  const mergeCandidates = mergingCategory
    ? categories.filter(c =>
        c.id !== mergingCategory.id &&
        c.type === mergingCategory.type &&
        !c.parentId
      )
    : [];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="light" />

      {/* Header */}
      <LinearGradient
        colors={isDark ? ['#334155', '#1e293b'] : ['#9333ea', '#6d28d9']}
        style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}>
            <FontAwesome name="arrow-left" size={14} color="#fff" />
          </TouchableOpacity>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Manage Categories</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add"
            onPress={() => openAdd()}
            style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}
          >
            <FontAwesome name="plus" size={14} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {[
            { label: 'Total', value: categories.length, color: '#c084fc' },
            { label: 'Income', value: categories.filter(c => c.type === 'income').length, color: '#86efac' },
            { label: 'Expense', value: categories.filter(c => c.type === 'expense').length, color: '#fca5a5' },
            { label: 'Unused', value: Object.values(categoryStats).filter(s => s.isUnused).length, color: '#fcd34d' },
          ].map(s => (
            <View key={s.label} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingVertical: 7, paddingHorizontal: 8 }}>
              <Text style={{ color: s.color, fontSize: 9, fontWeight: '600', marginBottom: 1 }}>{s.label}</Text>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{s.value}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* Search + Sort */}
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: theme.surfaceMuted }}>
          <FontAwesome name="search" size={15} color="#94a3b8" />
          <TextInput
            style={{ flex: 1, marginLeft: 10, fontSize: 15, color: theme.text }}
            placeholder="Search categories..."
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSearch('')}>
              <FontAwesome name="times-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter tabs + Sort */}
        <View style={{ flexDirection: 'row', gap: 7 }}>
          <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.surface, padding: 3, borderRadius: 12, borderWidth: 1, borderColor: theme.surfaceMuted }}>
            {(['all', 'income', 'expense'] as FilterMode[]).map(f => (
              <TouchableOpacity
                key={f}
                onPress={() => setFilter(f)}
                style={{ flex: 1, paddingVertical: 6, borderRadius: 9, alignItems: 'center', backgroundColor: filter === f ? '#9333ea' : 'transparent' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'capitalize', color: filter === f ? '#fff' : '#94a3b8' }}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Sort button */}
          <View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sort categories"
              onPress={() => setShowSortMenu(v => !v)}
              style={{ width: 40, height: 40, backgroundColor: theme.surface, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.surfaceMuted }}
            >
              <FontAwesome name="sort-amount-desc" size={14} color="#9333ea" />
            </TouchableOpacity>
            {showSortMenu && (
              <View style={{ position: 'absolute', top: 44, right: 0, backgroundColor: theme.surface, borderRadius: 12, padding: 5, zIndex: 100, minWidth: 148, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 10, borderWidth: 1, borderColor: theme.surfaceMuted }}>
                {([['name', 'A–Z Name'], ['usage', 'Most Used'], ['amount', 'Highest Spend']] as [SortMode, string][]).map(([mode, label]) => (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => { setSort(mode); setShowSortMenu(false); }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9, backgroundColor: sort === mode ? '#f3e8ff' : 'transparent' }}
                  >
                    <FontAwesome name={sort === mode ? 'check' : 'circle-o'} size={12} color={sort === mode ? '#9333ea' : '#94a3b8'} style={{ marginRight: 9 }} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: sort === mode ? '#9333ea' : (theme.text) }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* List */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => { activeSwipeClose.current?.(); }}
      >
        {rootCategories.length === 0 ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 80 }}>
            <View style={{ width: 72, height: 72, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
              <FontAwesome name="folder-open" size={30} color="#cbd5e1" />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text, marginBottom: 6 }}>
              {search ? 'No matches' : 'No Categories'}
            </Text>
            <Text style={{ fontSize: 14, color: '#94a3b8' }}>
              {search ? `No categories match "${search}"` : 'Tap + to add your first category'}
            </Text>
          </View>
        ) : (
          rootCategories.map(cat => renderRow(cat))
        )}
      </ScrollView>

      {/* Add / Edit Modal */}
      <FormSheet
        visible={showAddModal || editingCategory !== null}
        onClose={() => { setShowAddModal(false); setEditingCategory(null); resetForm(); }}
        maxHeight="92%"
        scrollable={false}
        accessibilityLabel={editingCategory ? 'Edit category' : 'Add category'}
      >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text }}>
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => { setShowAddModal(false); setEditingCategory(null); resetForm(); }}>
                <FontAwesome name="times" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Preview */}
              <View style={{ backgroundColor: theme.surfaceMuted, borderRadius: 18, padding: 16, marginBottom: 20, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 52, height: 52, borderRadius: 15, backgroundColor: (formData.color ?? '#6366f1') + '20', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                  <CategoryIcon icon={formData.icon} size={24} color={formData.color ?? '#6366f1'} />
                </View>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>{formData.name || 'Category Name'}</Text>
                  <Text style={{ fontSize: 13, color: '#94a3b8', textTransform: 'capitalize', marginTop: 2 }}>{formData.type}</Text>
                </View>
              </View>

              {/* Name */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 6, letterSpacing: 0.5 }}>NAME</Text>
              <View style={{ backgroundColor: theme.surfaceMuted, borderRadius: 14, paddingHorizontal: 16, marginBottom: errors.name ? 6 : 20, borderWidth: 1, borderColor: errors.name ? '#ef4444' : (theme.border) }}>
                <TextInput
                  style={{ height: 50, fontSize: 15, color: theme.text }}
                  placeholder="Enter category name"
                  placeholderTextColor="#94a3b8"
                  value={formData.name}
                  accessibilityLabel="Category name"
                  aria-invalid={!!errors.name}
                  onChangeText={text => { clearError('name'); setFormData(prev => ({ ...prev, name: text })); }}
                />
              </View>
              {errors.name ? (
                <Text accessibilityRole="alert" style={{ color: '#dc2626', fontSize: 12, fontWeight: '600', marginBottom: 14 }}>{errors.name}</Text>
              ) : null}

              {/* Type */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 6, letterSpacing: 0.5 }}>TYPE</Text>
              <View style={{ flexDirection: 'row', backgroundColor: theme.surfaceMuted, padding: 4, borderRadius: 14, marginBottom: 20, borderWidth: 1, borderColor: theme.border }}>
                {(['expense', 'income'] as const).map(t => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setFormData(prev => ({ ...prev, type: t, parentId: undefined }))}
                    style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: formData.type === t ? (t === 'expense' ? '#ef4444' : '#10b981') : 'transparent' }}
                  >
                    <Text style={{ fontWeight: '700', fontSize: 14, color: formData.type === t ? '#fff' : '#94a3b8', textTransform: 'capitalize' }}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Parent */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 6, letterSpacing: 0.5 }}>PARENT (OPTIONAL)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                <TouchableOpacity
                  onPress={() => setFormData(prev => ({ ...prev, parentId: undefined }))}
                  style={{ marginRight: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 2, borderColor: !formData.parentId ? '#9333ea' : (theme.border), backgroundColor: !formData.parentId ? '#f3e8ff' : 'transparent' }}
                >
                  <Text style={{ fontWeight: '600', color: !formData.parentId ? '#9333ea' : '#94a3b8' }}>None</Text>
                </TouchableOpacity>
                {categories.filter(c => {
                  if (c.type !== formData.type) return false;
                  if (!editingCategory) return true;
                  // Exclude self and all descendants to prevent circular refs
                  const excluded = new Set([editingCategory.id, ...getAllDescendantIds(editingCategory.id)]);
                  return !excluded.has(c.id);
                }).map(c => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setFormData(prev => ({ ...prev, parentId: c.id }))}
                    style={{ marginRight: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 2, borderColor: formData.parentId === c.id ? c.color : (theme.border), backgroundColor: formData.parentId === c.id ? c.color + '18' : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <CategoryIcon icon={c.icon} size={13} color={c.color} />
                    <Text style={{ fontWeight: '600', color: formData.parentId === c.id ? c.color : '#94a3b8' }}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Icon */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 10, letterSpacing: 0.5 }}>ICON</Text>
              <View style={{ marginBottom: 20 }}>
                {ICON_GROUPS.map(group => (
                  <View key={group.id} style={{ marginBottom: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' }}>
                    <TouchableOpacity
                      onPress={() => setOpenIconGroup(prev => prev === group.id ? '' : group.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: theme.surfaceMuted }}
                    >
                      <Text style={{ fontWeight: '600', color: theme.text, fontSize: 14 }}>{group.title}</Text>
                      <FontAwesome name={openIconGroup === group.id ? 'chevron-up' : 'chevron-down'} size={11} color="#94a3b8" />
                    </TouchableOpacity>
                    {openIconGroup === group.id && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 10, backgroundColor: theme.surface }}>
                        {group.items.map(icon => (
                          <TouchableOpacity
                            key={`${group.id}-${icon}`}
                            onPress={() => setFormData(prev => ({ ...prev, icon }))}
                            style={{ width: 52, height: 52, margin: 4, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: formData.icon === icon ? (formData.color ?? '#6366f1') : (isDark ? '#1e293b' : '#f1f5f9') }}
                          >
                            <CategoryIcon icon={icon} size={20} color={formData.icon === icon ? '#fff' : '#64748b'} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>

              {/* Color */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 10, letterSpacing: 0.5 }}>COLOR</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24 }}>
                {AVAILABLE_COLORS.map(color => (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm"
                    key={color}
                    onPress={() => setFormData(prev => ({ ...prev, color }))}
                    style={{ width: 44, height: 44, borderRadius: 22, margin: 5, backgroundColor: color, justifyContent: 'center', alignItems: 'center', transform: [{ scale: formData.color === color ? 1.15 : 1 }] }}
                  >
                    {formData.color === color && <FontAwesome name="check" size={18} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Save */}
              <TouchableOpacity
                onPress={editingCategory ? handleEdit : handleAdd}
                disabled={!formData.name?.trim()}
                style={{ backgroundColor: formData.name?.trim() ? '#9333ea' : '#e2e8f0', borderRadius: 16, height: 54, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={{ color: formData.name?.trim() ? '#fff' : '#94a3b8', fontWeight: '700', fontSize: 16 }}>
                  {editingCategory ? 'Update Category' : 'Add Category'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
      </FormSheet>

      {/* Merge Modal */}
      {mergingCategory && (
        <MergeModal
          source={mergingCategory}
          candidates={mergeCandidates}
          onConfirm={handleMergeConfirm}
          onClose={() => setMergingCategory(null)}
        />
      )}
    </View>
  );
}
