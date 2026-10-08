import CoinLoader from '@/components/CoinLoader';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { DraftTransaction, DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSSyncService } from '@/services/SMSSyncService';
import { useTransactions } from '@/context/TransactionContext';
import CategoryIcon from '@/components/CategoryIcon';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { Account } from '@/types/database';
import { Category } from '@/context/TransactionContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SMSSyncOnboardingModalProps {
  visible: boolean;
  account: Account | null;
  allAccounts: Account[];
  onClose: () => void;
  onComplete: (savedCount: number) => void;
}

type Step = 'confirm' | 'days' | 'syncing' | 'review';
type DraftFilter = 'all' | 'income' | 'expense';

interface DraftReviewState {
  draft: DraftTransaction;
  accepted: boolean;
  description: string;
  category: string;
  expanded: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_OPTIONS: { label: string; value: number }[] = [
  { label: 'Today', value: 1 },
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
  { label: '6 Months', value: 180 },
];

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return `${SHORT_MONTH[d.getMonth()]} ${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Thin animated progress bar */
function ProgressBar({ progress }: { progress: number }) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  const animatedWidth = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
      <Animated.View
        style={{ width: animatedWidth }}
        className="h-full bg-indigo-500 rounded-full"
      />
    </View>
  );
}

/** Small stat chip */
function StatChip({
  label,
  color,
}: {
  label: string;
  color: 'slate' | 'green' | 'red';
}) {
  const bg =
    color === 'green'
      ? 'bg-emerald-100 dark:bg-emerald-900'
      : color === 'red'
      ? 'bg-red-100 dark:bg-red-900'
      : 'bg-slate-100 dark:bg-slate-700';
  const text =
    color === 'green'
      ? 'text-emerald-700 dark:text-emerald-300'
      : color === 'red'
      ? 'text-red-700 dark:text-red-300'
      : 'text-slate-700 dark:text-slate-300';

  return (
    <View className={`px-3 py-1 rounded-full mr-2 ${bg}`}>
      <Text className={`text-xs font-semibold ${text}`}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Category picker sheet
// ---------------------------------------------------------------------------

interface CategoryPickerSheetProps {
  visible: boolean;
  draftType: 'INCOME' | 'EXPENSE';
  currentCategory: string;
  categories: Category[];
  onSelect: (cat: string) => void;
  onClose: () => void;
}

function CategoryPickerSheet({
  visible,
  draftType,
  currentCategory,
  categories,
  onSelect,
  onClose,
}: CategoryPickerSheetProps) {
  const filtered = categories.filter(
    (c) => c.type === (draftType === 'INCOME' ? 'income' : 'expense'),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close"
        className="flex-1 bg-black/40"
        activeOpacity={1}
        onPress={onClose}
      />
      <View className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-96 pb-6">
        {/* Handle */}
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        </View>
        <Text className="text-base font-bold text-slate-800 dark:text-white px-5 pb-3">
          Choose Category
        </Text>
        <ScrollView className="px-4">
          {filtered.map((cat) => {
            const isSelected = cat.name === currentCategory;
            return (
              <TouchableOpacity
                key={cat.id}
                onPress={() => onSelect(cat.name)}
                className={`flex-row items-center py-3 px-3 rounded-xl mb-1 ${ isSelected ? 'bg-indigo-50 dark:bg-indigo-900/40' : 'bg-transparent' }`}
              >
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: cat.color + '33' }}
                >
                  <CategoryIcon icon={cat.icon} size={14} color={cat.color} />
                </View>
                <Text
                  className={`flex-1 text-sm font-medium ${ isSelected ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200' }`}
                >
                  {cat.name}
                </Text>
                {isSelected && (
                  <FontAwesome name="check" size={12} color="#6366f1" />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Draft review card
// ---------------------------------------------------------------------------

interface DraftCardProps {
  state: DraftReviewState;
  categories: Category[];
  formatCurrency: (amount: number) => string;
  onToggleAccept: () => void;
  onToggleExpand: () => void;
  onDescriptionChange: (text: string) => void;
  onCategoryChange: (cat: string) => void;
}

function DraftCard({
  state,
  categories,
  formatCurrency,
  onToggleAccept,
  onToggleExpand,
  onDescriptionChange,
  onCategoryChange,
}: DraftCardProps) {
  const { draft, accepted, description, category, expanded } = state;
  const isIncome = draft.type === 'INCOME';

  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const matchedCat = categories.find((c) => c.name === category);
  const catColor = matchedCat?.color ?? (isIncome ? '#10b981' : '#ef4444');
  const catIcon = matchedCat?.icon ?? (isIncome ? 'arrow-down' : 'arrow-up');

  const merchant =
    draft.sender_receiver || draft.description || (isIncome ? 'Income' : 'Expense');

  const cardBorder = accepted
    ? 'border-emerald-400 dark:border-emerald-500'
    : 'border-slate-200 dark:border-slate-700';
  const cardBg = accepted
    ? 'bg-emerald-50 dark:bg-emerald-950/30'
    : 'bg-white dark:bg-slate-800';
  const opacity = !accepted ? 'opacity-60' : '';

  return (
    <>
      <CategoryPickerSheet
        visible={categoryPickerOpen}
        draftType={draft.type}
        currentCategory={category}
        categories={categories}
        onSelect={(cat) => {
          onCategoryChange(cat);
          setCategoryPickerOpen(false);
        }}
        onClose={() => setCategoryPickerOpen(false)}
      />

      <View
        className={`rounded-2xl border mb-3 overflow-hidden ${cardBg} ${cardBorder} ${opacity}`}
        style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}
      >
        {/* Colored left bar */}
        <View
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
          style={{ backgroundColor: isIncome ? '#10b981' : '#ef4444' }}
        />

        {/* Main row */}
        <View className="flex-row items-center pl-3 pr-2 pt-3 pb-2">
          {/* Type icon */}
          <View
            className="w-9 h-9 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: (isIncome ? '#10b981' : '#ef4444') + '22' }}
          >
            <FontAwesome
              name={isIncome ? 'arrow-down' : 'arrow-up'}
              size={14}
              color={isIncome ? '#10b981' : '#ef4444'}
            />
          </View>

          {/* Middle info */}
          <View className="flex-1 mr-2">
            <Text
              className="text-base font-bold text-slate-900 dark:text-white"
              numberOfLines={1}
            >
              {formatCurrency(draft.amount)}
            </Text>
            <Text
              className="text-xs text-slate-500 dark:text-slate-400"
              numberOfLines={1}
            >
              {merchant}
            </Text>
          </View>

          {/* Right side */}
          <View className="items-end">
            <Text className="text-xs text-slate-500 dark:text-slate-400 mb-1">
              {formatShortDate(draft.date)}
            </Text>

            {/* Accept / Skip toggles */}
            <View className="flex-row items-center gap-1">
              <TouchableOpacity
                onPress={onToggleAccept}
                className={`px-2 py-0.5 rounded-full flex-row items-center gap-1 ${ accepted ? 'bg-emerald-500' : 'bg-slate-100 dark:bg-slate-700' }`}
              >
                <FontAwesome
                  name="check"
                  size={10}
                  color={accepted ? '#fff' : '#94a3b8'}
                />
                <Text
                  className={`text-xs font-semibold ${ accepted ? 'text-white' : 'text-slate-500 dark:text-slate-400' }`}
                >
                  Accept
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onToggleAccept}
                className={`px-2 py-0.5 rounded-full flex-row items-center gap-1 ${ !accepted ? 'bg-slate-400 dark:bg-slate-600' : 'bg-slate-100 dark:bg-slate-700' }`}
              >
                <FontAwesome
                  name="times"
                  size={10}
                  color={!accepted ? '#fff' : '#94a3b8'}
                />
                <Text
                  className={`text-xs font-semibold ${ !accepted ? 'text-white' : 'text-slate-500 dark:text-slate-400' }`}
                >
                  Skip
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Chips row */}
        <View className="flex-row items-center pl-4 pr-3 pb-2">
          {/* Category badge */}
          <TouchableOpacity
            onPress={() => setCategoryPickerOpen(true)}
            className="flex-row items-center px-2 py-0.5 rounded-full mr-2"
            style={{ backgroundColor: catColor + '22' }}
          >
            <CategoryIcon icon={catIcon} size={11} color={catColor} />
            <Text
              className="text-xs font-medium ml-1"
              style={{ color: catColor }}
            >
              {category || 'Other'}
            </Text>
            <FontAwesome
              name="pencil"
              size={9}
              color={catColor}
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>

          {/* Receipt link */}
          {!!draft.receipt_url && (
            <TouchableOpacity
              onPress={() => Linking.openURL(draft.receipt_url!)}
              className="flex-row items-center px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 mr-2"
            >
              <FontAwesome name="file-text-o" size={10} color="#3b82f6" />
              <Text className="text-xs text-blue-600 dark:text-blue-400 ml-1">
                Receipt
              </Text>
            </TouchableOpacity>
          )}

          {/* Expand arrow */}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Show or hide details" accessibilityState={{ expanded }}
            onPress={onToggleExpand}
            className="ml-auto p-1"
          >
            <FontAwesome
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={10}
              color="#94a3b8"
            />
          </TouchableOpacity>
        </View>

        {/* Expanded section */}
        {expanded && (
          <View className="border-t border-slate-100 dark:border-slate-700 px-4 pt-3 pb-3 mx-1 mb-1">
            <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
              Raw SMS
            </Text>
            <Text className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-4">
              {draft.raw_sms}
            </Text>
            <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
              Description
            </Text>
            <TextInput
              value={description}
              onChangeText={onDescriptionChange}
              className="text-sm text-slate-800 dark:text-white bg-slate-100 dark:bg-slate-700 rounded-lg px-3 py-2"
              placeholder="Edit description…"
              placeholderTextColor="#94a3b8"
            />
          </View>
        )}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SMSSyncOnboardingModal({
  visible,
  account,
  allAccounts,
  onClose,
  onComplete,
}: SMSSyncOnboardingModalProps) {
  const { categories } = useTransactions();
  const { formatCurrency } = useAppSettings();

  // Step state
  const [step, setStep] = useState<Step>('confirm');
  const [selectedDays, setSelectedDays] = useState<number>(30);

  // Sync state
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Review state
  const [draftStates, setDraftStates] = useState<DraftReviewState[]>([]);
  const [draftFilter, setDraftFilter] = useState<DraftFilter>('all');

  // Save state
  const [saving, setSaving] = useState(false);

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      setStep('confirm');
      setSelectedDays(30);
      setSyncStatus('');
      setSyncProgress(0);
      setSyncing(false);
      setDraftStates([]);
      setDraftFilter('all');
      setSaving(false);
    }
  }, [visible]);

  // ---------------------------------------------------------------------------
  // Sync logic
  // ---------------------------------------------------------------------------

  const runSync = async () => {
    if (!account) return;

    setSyncing(true);
    setSyncProgress(0);
    setSyncStatus('Starting…');
    setStep('syncing');

    SMSSyncService.setSyncStatusListener(({ status, progress }) => {
      setSyncStatus(status);
      setSyncProgress(progress);
    });

    try {
      const result = await SMSSyncService.syncAccountSMS(account, [], {
        historicalDays: selectedDays,
        allAccounts,
      });
      SMSSyncService.clearSyncStatusListener();

      const states: DraftReviewState[] = result.drafts
        .filter((d) => d.status === 'PENDING')
        .map((d) => ({
          draft: d,
          accepted: true,
          description: d.description,
          category: d.category,
          expanded: false,
        }));

      setDraftStates(states);
      setStep('review');
    } catch (err) {
      SMSSyncService.clearSyncStatusListener();
      setSyncStatus('Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Review helpers
  // ---------------------------------------------------------------------------

  const filteredDraftStates = draftStates.filter((s) => {
    if (draftFilter === 'income') return s.draft.type === 'INCOME';
    if (draftFilter === 'expense') return s.draft.type === 'EXPENSE';
    return true;
  });

  const incomeCount = draftStates.filter((s) => s.draft.type === 'INCOME').length;
  const expenseCount = draftStates.filter((s) => s.draft.type === 'EXPENSE').length;
  const acceptedCount = draftStates.filter((s) => s.accepted).length;

  function toggleAccept(index: number) {
    // index is relative to filteredDraftStates — find the global index
    const targetId = filteredDraftStates[index].draft.id;
    setDraftStates((prev) =>
      prev.map((s) =>
        s.draft.id === targetId ? { ...s, accepted: !s.accepted } : s,
      ),
    );
  }

  function toggleExpand(index: number) {
    const targetId = filteredDraftStates[index].draft.id;
    setDraftStates((prev) =>
      prev.map((s) =>
        s.draft.id === targetId ? { ...s, expanded: !s.expanded } : s,
      ),
    );
  }

  function setDescription(index: number, text: string) {
    const targetId = filteredDraftStates[index].draft.id;
    setDraftStates((prev) =>
      prev.map((s) =>
        s.draft.id === targetId ? { ...s, description: text } : s,
      ),
    );
  }

  function setCategoryFor(index: number, cat: string) {
    const targetId = filteredDraftStates[index].draft.id;
    setDraftStates((prev) =>
      prev.map((s) =>
        s.draft.id === targetId ? { ...s, category: cat } : s,
      ),
    );
  }

  function acceptAll() {
    setDraftStates((prev) => prev.map((s) => ({ ...s, accepted: true })));
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function handleSave() {
    setSaving(true);
    try {
      const toSave = draftStates.filter((s) => s.accepted);

      // Update descriptions / categories on the persisted drafts
      await Promise.all(
        toSave.map(async (s) => {
          const all = await DraftTransactionService.getAll();
          const existing = all.find((d) => d.id === s.draft.id);
          if (existing) {
            // Patch via addMany is not applicable; patch in-place by replacing
            // using the internal update approach. We use updateStatus indirectly:
            // since DraftTransactionService has no updateFields, we delete + re-add.
            await DraftTransactionService.delete(s.draft.id);
            await DraftTransactionService.add({
              ...s.draft,
              description: s.description,
              category: s.category,
              status: 'PENDING',
              is_recorded: false,
            });
          }
        }),
      );

      onComplete(toSave.length);
    } catch (err) {
      console.error('[SMSSyncOnboarding] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render steps
  // ---------------------------------------------------------------------------

  function renderConfirmStep() {
    return (
      <View className="flex-1 px-5 pt-4 pb-6">
        <View className="items-center mb-6 mt-2">
          <View className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/40 items-center justify-center mb-4">
            <FontAwesome name="commenting" size={28} color="#6366f1" />
          </View>
          <Text className="text-xl font-bold text-slate-900 dark:text-white text-center mb-2">
            Import SMS Transactions
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400 text-center leading-5 px-2">
            Would you like to import past SMS transactions for{' '}
            <Text className="font-semibold text-indigo-600 dark:text-indigo-400">
              {account?.name ?? 'this account'}
            </Text>
            ?
          </Text>
        </View>

        <View className="bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl p-4 mb-6">
          <View className="flex-row items-start mb-2">
            <FontAwesome name="info-circle" size={14} color="#6366f1" style={{ marginTop: 2, marginRight: 8 }} />
            <Text className="text-xs text-indigo-700 dark:text-indigo-300 flex-1 leading-4">
              HisabTrack will read SMS messages sent by your bank and parse them
              into draft transactions that you can review before saving.
            </Text>
          </View>
          <View className="flex-row items-start">
            <FontAwesome name="lock" size={14} color="#6366f1" style={{ marginTop: 2, marginRight: 8 }} />
            <Text className="text-xs text-indigo-700 dark:text-indigo-300 flex-1 leading-4">
              Your messages are processed on-device and never uploaded.
            </Text>
          </View>
        </View>

        <View className="flex-row gap-3 mt-auto">
          <TouchableOpacity
            onPress={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 items-center"
          >
            <Text className="text-sm font-semibold text-slate-600 dark:text-slate-400">
              Skip
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setStep('days')}
            className="flex-2 py-3 px-6 rounded-xl bg-indigo-600 items-center"
            style={{ flex: 2 }}
          >
            <Text className="text-sm font-semibold text-white">
              Yes, Import SMS
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderDaysStep() {
    return (
      <View className="flex-1 px-5 pt-4 pb-6">
        <Text className="text-lg font-bold text-slate-900 dark:text-white mb-1">
          How far back should we look?
        </Text>
        <Text className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          Select the time range to import from.
        </Text>

        <View className="flex-row flex-wrap gap-3 mb-6">
          {DAY_OPTIONS.map((opt) => {
            const isSelected = selectedDays === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setSelectedDays(opt.value)}
                className={`rounded-2xl px-5 py-3 border-2 ${ isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' }`}
              >
                <Text
                  className={`text-sm font-semibold ${ isSelected ? 'text-white' : 'text-slate-700 dark:text-slate-300' }`}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 mb-6 flex-row items-start">
          <FontAwesome name="clock-o" size={13} color="#d97706" style={{ marginTop: 1, marginRight: 8 }} />
          <Text className="text-xs text-amber-700 dark:text-amber-400 flex-1 leading-4">
            Longer ranges may take a bit more time to process. You can review and
            discard drafts after scanning.
          </Text>
        </View>

        <View className="flex-row gap-3 mt-auto">
          <TouchableOpacity
            onPress={() => setStep('confirm')}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 items-center"
          >
            <Text className="text-sm font-semibold text-slate-600 dark:text-slate-400">
              Back
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={runSync}
            className="py-3 px-6 rounded-xl bg-indigo-600 items-center"
            style={{ flex: 2 }}
          >
            <Text className="text-sm font-semibold text-white">
              Start Import
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderSyncingStep() {
    return (
      <View className="flex-1 px-5 pt-6 pb-8 items-center justify-center">
        <View className="w-20 h-20 rounded-full bg-indigo-100 dark:bg-indigo-900/40 items-center justify-center mb-6">
          <CoinLoader size="large" color="#6366f1" />
        </View>
        <Text className="text-lg font-bold text-slate-900 dark:text-white mb-1 text-center">
          Scanning Messages…
        </Text>
        <Text
          className="text-sm text-slate-500 dark:text-slate-400 mb-8 text-center"
          numberOfLines={2}
        >
          {syncStatus || 'Please wait while we read your SMS history.'}
        </Text>

        <View className="w-full mb-3">
          <ProgressBar progress={syncProgress} />
        </View>
        <Text className="text-xs text-slate-500 dark:text-slate-400">
          {syncProgress}%
        </Text>
      </View>
    );
  }

  function renderReviewStep() {
    return (
      <View className="flex-1">
        {/* Stat chips */}
        <View className="flex-row px-4 pt-3 pb-2 flex-wrap">
          <StatChip label={`${draftStates.length} found`} color="slate" />
          <StatChip label={`${incomeCount} income`} color="green" />
          <StatChip label={`${expenseCount} expense`} color="red" />
        </View>

        {/* Filter row */}
        <View className="flex-row px-4 pb-3 gap-2">
          {(['all', 'income', 'expense'] as DraftFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setDraftFilter(f)}
              className={`px-4 py-1.5 rounded-full ${ draftFilter === f ? 'bg-indigo-600' : 'bg-slate-100 dark:bg-slate-700' }`}
            >
              <Text
                className={`text-xs font-semibold capitalize ${ draftFilter === f ? 'text-white' : 'text-slate-600 dark:text-slate-300' }`}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cards */}
        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          {filteredDraftStates.length === 0 ? (
            <View className="items-center py-12">
              <FontAwesome name="inbox" size={36} color="#94a3b8" />
              <Text className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                No transactions found for this filter.
              </Text>
            </View>
          ) : (
            filteredDraftStates.map((state, idx) => (
              <DraftCard
                key={state.draft.id}
                state={state}
                categories={categories}
                formatCurrency={formatCurrency}
                onToggleAccept={() => toggleAccept(idx)}
                onToggleExpand={() => toggleExpand(idx)}
                onDescriptionChange={(text) => setDescription(idx, text)}
                onCategoryChange={(cat) => setCategoryFor(idx, cat)}
              />
            ))
          )}
        </ScrollView>

        {/* Bottom bar */}
        <View className="px-4 pt-3 pb-5 border-t border-slate-100 dark:border-slate-700">
          <Text className="text-xs text-slate-500 dark:text-slate-400 mb-3 text-center">
            {acceptedCount} of {draftStates.length} selected
          </Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={acceptAll}
              className="flex-1 py-3 rounded-xl border border-indigo-300 dark:border-indigo-700 items-center"
            >
              <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                Accept All
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || acceptedCount === 0}
              className={`py-3 rounded-xl items-center ${ saving || acceptedCount === 0 ? 'bg-slate-300 dark:bg-slate-700' : 'bg-indigo-600' }`}
              style={{ flex: 2 }}
            >
              {saving ? (
                <CoinLoader size="small" color="#fff" />
              ) : (
                <Text className="text-sm font-semibold text-white">
                  Save {acceptedCount} Transaction{acceptedCount !== 1 ? 's' : ''}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Step header titles
  // ---------------------------------------------------------------------------

  const STEP_TITLES: Record<Step, string> = {
    confirm: 'SMS Import',
    days: 'Time Range',
    syncing: 'Importing…',
    review: 'Review Drafts',
  };

  const STEP_SUBTITLES: Record<Step, string> = {
    confirm: account?.name ?? '',
    days: 'Choose how far back to scan',
    syncing: account?.name ?? '',
    review: `${account?.name ?? ''} · ${DAY_OPTIONS.find((d) => d.value === selectedDays)?.label ?? ''}`,
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <TouchableOpacity
        className="flex-1 bg-black/50"
        activeOpacity={1}
        onPress={step !== 'syncing' ? onClose : undefined}
      />

      {/* Card */}
      <View
        className="bg-white dark:bg-slate-900 rounded-t-3xl"
        style={{ maxHeight: Dimensions.get('window').height * 0.9 }}
      >
        {/* Gradient header */}
        <LinearGradient
          colors={['#4f46e5', '#4338ca']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          className="rounded-t-3xl py-4 px-5"
        >
          {/* Drag handle */}
          <View className="items-center mb-3">
            <View className="w-10 h-1 rounded-full bg-white/30" />
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-base font-bold text-white">
                {STEP_TITLES[step]}
              </Text>
              {!!STEP_SUBTITLES[step] && (
                <Text className="text-xs text-indigo-200 mt-0.5" numberOfLines={1}>
                  {STEP_SUBTITLES[step]}
                </Text>
              )}
            </View>

            {step !== 'syncing' && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                className="w-8 h-8 rounded-full bg-white/20 items-center justify-center ml-2"
              >
                <FontAwesome name="times" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Step dots */}
          <View className="flex-row gap-1.5 mt-3">
            {(['confirm', 'days', 'syncing', 'review'] as Step[]).map((s) => {
              const stepOrder: Step[] = ['confirm', 'days', 'syncing', 'review'];
              const currentIdx = stepOrder.indexOf(step);
              const dotIdx = stepOrder.indexOf(s);
              const active = dotIdx <= currentIdx;
              return (
                <View
                  key={s}
                  className={`h-1 rounded-full ${active ? 'bg-white' : 'bg-white/30'}`}
                  style={{ flex: 1 }}
                />
              );
            })}
          </View>
        </LinearGradient>

        {/* Step content */}
        <View
          style={{
            maxHeight: Dimensions.get('window').height * 0.9 - 110,
          }}
        >
          {step === 'confirm' && renderConfirmStep()}
          {step === 'days' && renderDaysStep()}
          {step === 'syncing' && renderSyncingStep()}
          {step === 'review' && renderReviewStep()}
        </View>
      </View>
    </Modal>
  );
}
