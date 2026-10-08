import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';

import type { FundEntry, SharedFund } from '@/types/database';
import { entryHeadline, entryIcon, entryIsIn, formatTime } from './fundUi';

/** One line of fund activity, with its evidence and the open questions on it. */
export default function FundEntryRow({
  entry, fund, myUid, formatCurrency, onPress,
}: {
  entry: FundEntry;
  fund: SharedFund;
  myUid: string;
  formatCurrency: (value: number) => string;
  onPress: (entry: FundEntry) => void;
}) {
  const incoming = entryIsIn(entry);
  const voided = entry.status === 'VOIDED';
  const pending = entry.status === 'PENDING';
  const category = entry.ownerCategory || entry.category;
  const recorder = entry.recordedByUid === myUid ? 'You' : entry.recordedByRole === 'OWNER' ? fund.ownerName : fund.custodianName || 'Custodian';
  const tint = voided ? '#94a3b8' : incoming ? '#059669' : '#e11d48';

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${entryHeadline(entry, fund)}, ${formatCurrency(entry.amount)}${voided ? ', voided' : pending ? ', expected' : ''}`}
      onPress={() => onPress(entry)}
      className={`bg-white dark:bg-slate-800 rounded-2xl p-4 mb-2 border ${entry.flag && !entry.flag.resolved ? 'border-amber-300 dark:border-amber-700' : 'border-slate-100 dark:border-slate-700'}`}
      style={{ opacity: voided ? 0.6 : 1 }}
    >
      <View className="flex-row items-start">
        <View className="w-10 h-10 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: tint + '1f' }}>
          <FontAwesome name={entryIcon(entry) as any} size={15} color={tint} />
        </View>
        <View className="flex-1 mr-2">
          <Text className={`text-slate-900 dark:text-white font-semibold text-sm ${voided ? 'line-through' : ''}`} numberOfLines={1}>
            {entryHeadline(entry, fund)}
          </Text>
          <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5" numberOfLines={1}>
            {[category, entry.kind === 'SPEND' ? entry.description : entry.note, formatTime(entry.date)].filter(Boolean).join(' · ')}
          </Text>
          <View className="flex-row flex-wrap items-center mt-1.5 gap-1.5">
            {pending && <Badge label="Expected" color="#d97706" />}
            {voided && <Badge label={entry.voidReason ? `Voided: ${entry.voidReason}` : 'Voided'} color="#64748b" />}
            {!!entry.ackAt && <Badge label="Received ✓" color="#059669" />}
            {entry.flag && !entry.flag.resolved && <Badge label={entry.flag.reply ? 'Answered' : 'Question'} color="#d97706" />}
            {entry.kind === 'DEPOSIT' && entry.source === 'THIRD_PARTY' && !entry.ownerPurpose && !voided && !pending && <Badge label="Classify" color="#6366f1" />}
            {entry.sms_linked && <Badge label="From SMS" color="#0d9488" />}
            {(entry.tags || []).slice(0, 3).map(tag => <Badge key={tag} label={`#${tag}`} color="#6366f1" />)}
          </View>
          {(entry.receipt_url || entry.reference_number) && (
            <View className="flex-row items-center mt-1.5">
              {entry.reference_number ? (
                <Text className="text-slate-500 dark:text-slate-400 text-[11px] mr-3" numberOfLines={1}>Ref {entry.reference_number}</Text>
              ) : null}
              {entry.receipt_url ? (
                <TouchableOpacity
                  accessibilityRole="link"
                  accessibilityLabel="View receipt"
                  onPress={() => { void Linking.openURL(entry.receipt_url!).catch(() => undefined); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="flex-row items-center"
                >
                  <FontAwesome name="external-link" size={10} color="#0d9488" />
                  <Text className="text-teal-700 dark:text-teal-300 text-[11px] font-semibold ml-1">View receipt</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>
        <View className="items-end">
          <Text className={`font-bold text-sm ${voided ? 'text-slate-500 dark:text-slate-400 line-through' : incoming ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {incoming ? '+' : '−'}{formatCurrency(entry.amount)}
          </Text>
          <Text className="text-slate-500 dark:text-slate-400 text-[10px] mt-1" numberOfLines={1}>{recorder}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '1f' }}>
      <Text className="text-[10px] font-semibold" style={{ color }} numberOfLines={1}>{label}</Text>
    </View>
  );
}
