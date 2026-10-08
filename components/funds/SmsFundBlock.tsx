import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import CategoryTreeSelect from '@/components/CategoryTreeSelect';
import type { FundEntry, SharedFund } from '@/types/database';
import { fundCategoryTree } from './fundUi';

/**
 * "For someone's fund" in the SMS confirm sheet. A debit becomes a payment
 * from the fund; a credit is matched to money the owner said is coming, or
 * recorded as sent by the owner or by someone else on their behalf.
 */
export default function SmsFundBlock({
  funds, isSpend, on, fundId, source, payer, category, candidates, matchId, formatCurrency,
  onToggle, onFund, onSource, onPayer, onCategory, onMatch,
}: {
  funds: SharedFund[];
  isSpend: boolean;
  on: boolean;
  fundId: string;
  source: 'owner' | 'third';
  payer: string;
  category: string;
  candidates: FundEntry[];
  matchId: string;
  formatCurrency: (value: number) => string;
  onToggle: () => void;
  onFund: (id: string) => void;
  onSource: (source: 'owner' | 'third') => void;
  onPayer: (name: string) => void;
  onCategory: (name: string) => void;
  onMatch: (entryId: string) => void;
}) {
  const fund = funds.find(item => item.id === fundId) ?? funds[0];
  const tree = useMemo(() => fundCategoryTree(fund?.categories ?? [], 'expense'), [fund?.categories]);
  const chip = (selected: boolean) => `mr-2 mb-2 px-3 py-2 rounded-xl border ${selected ? 'bg-teal-600 border-teal-600' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`;
  const chipText = (selected: boolean) => `text-xs font-semibold ${selected ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`;

  return (
    <View className={`rounded-2xl p-4 mb-5 border-2 ${on ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-400 dark:border-teal-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onToggle} className="flex-row items-center">
        <View className={`w-7 h-7 rounded-lg justify-center items-center mr-3 ${on ? 'bg-teal-600' : 'bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600'}`}>
          {on && <FontAwesome name="check" size={14} color="#fff" />}
        </View>
        <View className="flex-1">
          <Text className="text-slate-900 dark:text-white font-bold">{isSpend ? "Paid from someone's fund" : "Money for someone's fund"}</Text>
          <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            {isSpend ? 'They see it right away, with the receipt. It stays out of your own reports.' : 'It is their money: it stays out of your income.'}
          </Text>
        </View>
        <FontAwesome name="briefcase" size={17} color={on ? '#0d9488' : '#94a3b8'} />
      </TouchableOpacity>

      {on && fund && (
        <View className="mt-4">
          {funds.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
              {funds.map(item => (
                <TouchableOpacity key={item.id} accessibilityRole="radio" accessibilityState={{ selected: item.id === fund.id }} onPress={() => onFund(item.id)} className={chip(item.id === fund.id)}>
                  <Text className={chipText(item.id === fund.id)}>{item.name} · {item.ownerName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <Text className="text-slate-500 dark:text-slate-400 text-xs mb-3">
            {fund.name}: you hold {formatCurrency(fund.balance)} for {fund.ownerName}.
          </Text>

          {isSpend ? (
            <View>
              <Text className="text-slate-700 dark:text-slate-300 text-xs font-bold mb-2">Category in {fund.ownerName}'s list</Text>
              <CategoryTreeSelect categories={tree} value={category} onChange={onCategory} placeholder="Use the category above" accessibilityLabel="Fund category" compact />
            </View>
          ) : (
            <View>
              {candidates.length > 0 && (
                <>
                  <Text className="text-slate-700 dark:text-slate-300 text-xs font-bold mb-2">Is this one of these?</Text>
                  {candidates.map(item => (
                    <TouchableOpacity key={item.id} accessibilityRole="radio" accessibilityState={{ selected: matchId === item.id }} onPress={() => onMatch(item.id)}
                      className={`flex-row items-center p-3 rounded-xl mb-2 border ${matchId === item.id ? 'bg-white dark:bg-slate-900 border-teal-500' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                      <FontAwesome name={matchId === item.id ? 'dot-circle-o' : 'circle-o'} size={16} color="#0d9488" />
                      <Text className="text-slate-900 dark:text-white text-xs font-semibold ml-2 flex-1">
                        {formatCurrency(item.amount)} {item.payerName ? `from ${item.payerName}` : `sent by ${fund.ownerName}`}{item.status === 'PENDING' ? ' (expected)' : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: !matchId }} onPress={() => onMatch('')} className="flex-row items-center p-2 mb-2">
                    <FontAwesome name={!matchId ? 'dot-circle-o' : 'circle-o'} size={16} color="#0d9488" />
                    <Text className="text-slate-700 dark:text-slate-300 text-xs ml-2">Something else</Text>
                  </TouchableOpacity>
                </>
              )}
              {!matchId && (
                <>
                  <View className="flex-row flex-wrap">
                    <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: source === 'owner' }} onPress={() => onSource('owner')} className={chip(source === 'owner')}>
                      <Text className={chipText(source === 'owner')}>{fund.ownerName} sent it</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: source === 'third' }} onPress={() => onSource('third')} className={chip(source === 'third')}>
                      <Text className={chipText(source === 'third')}>Someone else, for {fund.ownerName}</Text>
                    </TouchableOpacity>
                  </View>
                  {source === 'third' && (
                    <TextInput
                      value={payer}
                      onChangeText={onPayer}
                      placeholder="Who sent it?"
                      placeholderTextColor="#94a3b8"
                      accessibilityLabel="Who sent it"
                      className="bg-white dark:bg-slate-900 rounded-xl px-3 py-3 text-slate-900 dark:text-white text-sm border border-slate-200 dark:border-slate-700"
                    />
                  )}
                </>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
