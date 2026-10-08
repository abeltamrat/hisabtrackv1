import CoinLoader from '@/components/CoinLoader';
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Animated, Platform, KeyboardAvoidingView } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';
import { useFormErrors } from '@/hooks/useFormErrors';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { FontAwesome } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSLearningService, SMSRule } from '@/services/SMSLearningService';
import { StorageService } from '@/utils/storage';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/contexts/I18nContext';
import { SMSSyncService, SMSMessage } from '@/services/SMSSyncService';
import { AIFinancialAssistant } from '@/services/AIFinancialAssistant';
import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';
import { SMSAICalibrationService, SMSCalibrationFields } from '@/services/SMSAICalibrationService';
import ScreenInfoCard from '@/components/ScreenInfoCard';

interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface SMSRuleItem {
  key: string;
  accountId: string;
  matchBy: 'merchant' | 'reference' | 'sender';
  sender: string;
  merchant?: string;
  referencePrefix?: string;
  category: string;
  description: string;
  hitCount?: number;
  confidence?: number;
  transactionType?: 'INCOME' | 'EXPENSE';
}

export default function ManageSMSRulesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { actualTheme } = useTheme();
  const { t } = useI18n();
  const accounts = useSelector((state: RootState) => state.accounts.items);

  const [rules, setRules] = useState<SMSRuleItem[]>([]);
  const [filteredRules, setFilteredRules] = useState<SMSRuleItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState<'all' | 'merchant' | 'reference' | 'sender'>('all');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRule, setEditingRule] = useState<SMSRuleItem | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const { errors, validate, clearError } = useFormErrors<'description'>();
  const [editCategory, setEditCategory] = useState('');
  const [showCategorySelector, setShowCategorySelector] = useState(false);

  // AI calibration wizard
  const [showAICalibration, setShowAICalibration] = useState(false);
  const [calibrationAccountId, setCalibrationAccountId] = useState<string | null>(null);
  const [smsSamples, setSmsSamples] = useState<SMSMessage[]>([]);
  const [selectedSample, setSelectedSample] = useState<SMSMessage | null>(null);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [aiFields, setAIFields] = useState<Record<string, string>>({});
  const [aiType, setAIType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [aiCategory, setAICategory] = useState('');
  const [aiDescription, setAIDescription] = useState('');
  const [calibrationCounts, setCalibrationCounts] = useState<Record<string, number>>({});

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
    loadData();
  }, []);

  useEffect(() => {
    if (typeof params.accountId === 'string' && accounts.some(account => account.id === params.accountId)) {
      setSelectedAccountId(params.accountId);
    }
  }, [params.accountId, accounts]);

  const loadData = async () => {
    setLoading(true);
    try {
      const allRules = await SMSLearningService.getAllRules();
      const mapped: SMSRuleItem[] = Object.entries(allRules).map(([key, rule]) => {
        const parts = key.split('_');
        const accountId = parts[0] || '';
        const matchBy = rule.matchBy || 'merchant';
        const sender = parts[2] || '';
        return {
          key,
          accountId,
          matchBy,
          sender,
          merchant: rule.merchant,
          referencePrefix: rule.referencePrefix,
          category: rule.category,
          description: rule.description,
          hitCount: rule.hitCount,
          confidence: rule.confidence,
          transactionType: rule.transactionType,
        };
      });

      setRules(mapped);

      const counts = await Promise.all(accounts.map(async account => [
        account.id,
        (await SMSAICalibrationService.getForAccount(account.id)).length,
      ] as const));
      setCalibrationCounts(Object.fromEntries(counts));
      
      const loadedCats = await StorageService.loadCategories();
      setCategories(loadedCats);
    } catch (e) {
      console.error('[manage-sms-rules] Error loading data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = rules;

    // Search query filter
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(
        r =>
          r.description.toLowerCase().includes(lowerQuery) ||
          r.category.toLowerCase().includes(lowerQuery) ||
          r.sender.toLowerCase().includes(lowerQuery) ||
          (r.merchant && r.merchant.toLowerCase().includes(lowerQuery)) ||
          (r.referencePrefix && r.referencePrefix.toLowerCase().includes(lowerQuery))
      );
    }

    // Tab filter
    if (selectedTab !== 'all') {
      filtered = filtered.filter(r => r.matchBy === selectedTab);
    }

    // Account ID filter
    if (selectedAccountId !== 'all') {
      filtered = filtered.filter(r => r.accountId === selectedAccountId);
    }

    setFilteredRules(filtered);
  }, [searchQuery, selectedTab, selectedAccountId, rules]);

  const handleDeleteRule = (rule: SMSRuleItem) => {
    Alert.alert(
      'Delete Rule',
      `Are you sure you want to delete this rule mapping to "${rule.description}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await SMSLearningService.deleteRule(rule.key);
            setRules(prev => prev.filter(r => r.key !== rule.key));
            Alert.alert('Success', 'Rule deleted successfully');
          },
        },
      ]
    );
  };

  const handleEditRule = (rule: SMSRuleItem) => {
    setEditingRule(rule);
    setEditDescription(rule.description);
    setEditCategory(rule.category);
    setShowEditModal(true);
  };

  const handleSaveRule = async () => {
    if (!editingRule) return;
    if (!validate({ description: !editDescription.trim() && 'Enter a description for this rule.' })) return;

    try {
      await SMSLearningService.updateRule(editingRule.key, {
        description: editDescription,
        category: editCategory,
      });

      setRules(prev =>
        prev.map(r => {
          if (r.key === editingRule.key) {
            return {
              ...r,
              description: editDescription,
              category: editCategory,
            };
          }
          return r;
        })
      );

      setShowEditModal(false);
      setEditingRule(null);
      Alert.alert('Success', 'Rule updated successfully');
    } catch (e) {
      Alert.alert('Error', 'Failed to update rule');
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Rules',
      'This will permanently delete all your customized SMS translation rules. Are you sure you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await SMSLearningService.clearAllRules();
            setRules([]);
            Alert.alert('Success', 'All rules cleared');
          },
        },
      ]
    );
  };

  const handleReviewAccount = (accountId: string) => {
    router.push({
      pathname: '/draft-transactions',
      params: { accountId, filter: 'unrecorded' },
    } as any);
  };

  const handleRecalibrateAccount = (accountId: string) => {
    const account = accounts.find(item => item.id === accountId);
    Alert.alert(
      `Recalibrate ${account?.name ?? 'account'}?`,
      'This removes only this account\'s learned SMS rules, then scans the last 30 days again. Your recorded transactions will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset & Scan',
          style: 'destructive',
          onPress: async () => {
            await SMSLearningService.clearRulesForAccount(accountId);
            await SMSAICalibrationService.clearForAccount(accountId);
            await loadData();
            router.push({
              pathname: '/draft-transactions',
              params: { accountId, filter: 'unrecorded', recalibrate: '1' },
            } as any);
          },
        },
      ]
    );
  };

  const openAICalibration = async (accountId: string) => {
    const account = accounts.find(item => item.id === accountId);
    if (!account?.sms_number) return;
    if (Platform.OS !== 'android') {
      Alert.alert('Android required', 'Reading real bank SMS samples is available on Android devices.');
      return;
    }

    const settings = await loadStoredAppSettings();
    if (!settings.geminiApiKey && !settings.groqApiKey && !settings.openRouterApiKey) {
      Alert.alert('Set up AI first', 'Add a Gemini, Groq, or OpenRouter API key in Settings, then return here.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/settings' as any) },
      ]);
      return;
    }

    let granted = await SMSSyncService.hasReadSmsPermission();
    if (!granted) granted = await SMSSyncService.requestPermissions();
    if (!granted) {
      Alert.alert('SMS permission needed', 'Allow SMS access so you can choose a real sample from this bank.');
      return;
    }

    setCalibrationAccountId(accountId);
    setShowAICalibration(true);
    setCalibrationLoading(true);
    setSelectedSample(null);
    setAIFields({});
    try {
      const messages: SMSMessage[] = [];
      for (const sender of account.sms_number.split(',').map(value => value.trim()).filter(Boolean)) {
        messages.push(...await SMSSyncService.readSMSFromSender(sender, Date.now() - 90 * 24 * 60 * 60 * 1000));
      }
      messages.sort((a, b) => b.date - a.date);
      setSmsSamples(messages.slice(0, 12));
    } finally {
      setCalibrationLoading(false);
    }
  };

  const runAIParse = async (sample: SMSMessage) => {
    setSelectedSample(sample);
    setCalibrationLoading(true);
    try {
      const settings = await loadStoredAppSettings();
      const previous = calibrationAccountId
        ? await SMSAICalibrationService.getForAccount(calibrationAccountId)
        : [];
      const parsed = await AIFinancialAssistant.parseSMS(sample.body, {
        geminiApiKey: settings.geminiApiKey,
        groqApiKey: settings.groqApiKey,
        openRouterApiKey: settings.openRouterApiKey,
      }, previous);
      if (!parsed) {
        Alert.alert('Could not parse this SMS', 'Try another sample or check your AI provider key in Settings.');
        setSelectedSample(null);
        return;
      }
      setAIType(parsed.type ?? 'EXPENSE');
      setAIDescription(parsed.merchant ?? 'Bank transaction');
      setAICategory(categories[0]?.name ?? 'Other');
      setAIFields({
        amount: parsed.amount?.toString() ?? '',
        accountNumber: parsed.accountNumber ?? '',
        merchant: parsed.merchant ?? '',
        referenceNumber: parsed.referenceNumber ?? '',
        balance: parsed.balance?.toString() ?? '',
        fees: parsed.fees?.toString() ?? '',
        tax: parsed.tax?.toString() ?? '',
      });
    } finally {
      setCalibrationLoading(false);
    }
  };

  const saveAICalibration = async () => {
    if (!calibrationAccountId || !selectedSample || !Number(aiFields.amount)) {
      Alert.alert('Check the amount', 'Enter the correct transaction amount before confirming.');
      return;
    }
    const numberOrUndefined = (value: string) => value.trim() ? Number(value) : undefined;
    const fields: SMSCalibrationFields = {
      amount: numberOrUndefined(aiFields.amount),
      type: aiType,
      accountNumber: aiFields.accountNumber?.trim() || undefined,
      merchant: aiFields.merchant?.trim() || undefined,
      referenceNumber: aiFields.referenceNumber?.trim() || undefined,
      balance: numberOrUndefined(aiFields.balance),
      fees: numberOrUndefined(aiFields.fees),
      tax: numberOrUndefined(aiFields.tax),
    };
    await SMSAICalibrationService.save({
      accountId: calibrationAccountId,
      sender: selectedSample.address,
      rawMessage: selectedSample.body,
      fields,
    });
    if (fields.merchant && aiDescription.trim() && aiCategory) {
      await SMSLearningService.learn({
        accountId: calibrationAccountId,
        sender: selectedSample.address,
        rawMerchant: fields.merchant,
        referenceNumber: fields.referenceNumber,
        correctedDescription: aiDescription.trim(),
        correctedCategory: aiCategory,
        isCorrection: true,
      });
    }
    setCalibrationCounts(previous => ({
      ...previous,
      [calibrationAccountId]: Math.min((previous[calibrationAccountId] ?? 0) + 1, 8),
    }));
    setShowAICalibration(false);
    await loadData();
    Alert.alert('AI calibrated', 'This verified example will guide future AI parsing for this bank.');
  };

  const getAccountName = (id: string) => {
    const acc = accounts.find(a => a.id === id);
    return acc ? acc.name : 'Unknown Account';
  };

  const getCategoryColor = (name: string) => {
    const cat = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    return cat ? cat.color : '#64748b';
  };

  const getCategoryIcon = (name: string) => {
    const cat = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    return cat ? cat.icon : 'tag';
  };

  const renderRuleCard = (rule: SMSRuleItem) => {
    const catColor = getCategoryColor(rule.category);
    const catIcon = getCategoryIcon(rule.category);

    return (
      <View
        key={rule.key}
        className="bg-white dark:bg-slate-800 rounded-2xl p-5 mb-4 shadow-md border border-slate-100 dark:border-slate-700"
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            {/* Match Type Badge */}
            <View className="flex-row items-center flex-wrap mb-2">
              <View
                className={`px-2.5 py-1 rounded-full mr-2 ${ rule.matchBy === 'merchant' ? 'bg-teal-50 dark:bg-teal-900/30' : rule.matchBy === 'reference' ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-amber-50 dark:bg-amber-900/30' }`}
              >
                <Text
                  className={`text-xs font-bold ${ rule.matchBy === 'merchant' ? 'text-teal-700 dark:text-teal-400' : rule.matchBy === 'reference' ? 'text-blue-700 dark:text-blue-400' : 'text-amber-700 dark:text-amber-400' }`}
                >
                  {rule.matchBy.toUpperCase()}
                </Text>
              </View>

              <Text className="text-xs text-slate-500 font-semibold dark:text-slate-400">
                {getAccountName(rule.accountId)}
              </Text>
            </View>

            {/* Condition Text */}
            <Text className="text-slate-900 dark:text-white font-bold text-lg mb-1">
              {rule.matchBy === 'merchant'
                ? rule.merchant
                : rule.matchBy === 'reference'
                ? `Ref Prefix: ${rule.referencePrefix}`
                : `Sender: ${rule.sender}`}
            </Text>

            <Text className="text-slate-500 dark:text-slate-400 text-xs mb-2">
              Sender Short Code: {rule.sender}
            </Text>

            {/* Rule Stats (Confidence & Hit Count) */}
            <View className="flex-row items-center mb-3 flex-wrap gap-2">
              <View className="flex-row items-center bg-teal-50 dark:bg-teal-900/30 px-2.5 py-1 rounded-lg">
                <FontAwesome name="check-circle" size={10} color="#14b8a6" />
                <Text className="text-teal-700 dark:text-teal-400 text-[10px] ml-1.5 font-bold">
                  {Math.round((rule.confidence ?? 0.8) * 100)}% Confidence
                </Text>
              </View>
              <View className="flex-row items-center bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1 rounded-lg">
                <FontAwesome name="repeat" size={10} color="#6366f1" />
                <Text className="text-indigo-700 dark:text-indigo-300 text-[10px] ml-1.5 font-bold">
                  {rule.hitCount ?? 0} {(rule.hitCount ?? 0) === 1 ? 'Hit' : 'Hits'}
                </Text>
              </View>
              {rule.transactionType && <View className="bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg"><Text className="text-slate-700 dark:text-slate-300 text-[10px] font-bold">{rule.transactionType}</Text></View>}
            </View>

            {/* Translation Output */}
            <View className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Maps to Details</Text>
                <View className="flex-row items-center">
                  <View
                    className="w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: catColor }}
                  />
                  <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {rule.category}
                  </Text>
                </View>
              </View>
              <Text className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {rule.description}
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View className="flex-row ml-3 mt-1">
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit"
              onPress={() => handleEditRule(rule)}
              className="w-9 h-9 bg-teal-50 dark:bg-teal-900/30 rounded-xl justify-center items-center mr-2 border border-teal-100 dark:border-teal-900"
            >
              <FontAwesome name="pencil" size={14} color="#14b8a6" />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete"
              onPress={() => handleDeleteRule(rule)}
              className="w-9 h-9 bg-red-50 dark:bg-red-900/30 rounded-xl justify-center items-center border border-red-100 dark:border-red-900"
            >
              <FontAwesome name="trash" size={14} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={actualTheme === 'dark' ? ['#0d9488', '#115e59'] : ['#14b8a6', '#0f766e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 8 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="w-12 h-12 bg-white/20 backdrop-blur-lg rounded-2xl justify-center items-center"
          >
            <FontAwesome name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <View className="flex-1 items-center">
            <Text className="text-white text-xl font-bold">SMS Learning Rules</Text>
            <Text className="text-white/90 text-xs mt-1">Auto-normalizing banking texts</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete"
            onPress={handleClearAll}
            disabled={rules.length === 0}
            className={`w-12 h-12 rounded-2xl justify-center items-center ${ rules.length === 0 ? 'bg-white/10 opacity-50' : 'bg-white/20' }`}
          >
            <FontAwesome name="trash-o" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View className="flex-row gap-3">
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4">
            <Text className="text-white/90 text-xs font-semibold">Learned Rules</Text>
            <Text className="text-white text-2xl font-bold mt-1">{rules.length}</Text>
          </View>
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4">
            <Text className="text-white/90 text-xs font-semibold">Active Filtered</Text>
            <Text className="text-white text-2xl font-bold mt-1">{filteredRules.length}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

      {/* Friendly account-by-account teaching flow */}
      <View className="px-6 -mt-4 mb-4">
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-5 shadow-lg border border-slate-100 dark:border-slate-700 mb-4">
          <View className="flex-row items-center mb-3">
            <View className="w-11 h-11 rounded-2xl bg-teal-50 dark:bg-teal-900/30 justify-center items-center mr-3">
              <FontAwesome name="graduation-cap" size={19} color="#0d9488" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-base">Teach HisabTrack your bank SMS</Text>
              <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">Review a draft, correct it, then save. Future messages improve automatically.</Text>
            </View>
          </View>
          <View className="flex-row items-center justify-between bg-slate-50 dark:bg-slate-900 rounded-2xl px-4 py-3">
            {[
              ['1', 'Choose bank'],
              ['2', 'Correct SMS'],
              ['3', 'Save & learn'],
            ].map(([step, label], index) => (
              <React.Fragment key={step}>
                <View className="items-center flex-1">
                  <View className="w-6 h-6 rounded-full bg-teal-600 justify-center items-center mb-1">
                    <Text className="text-white text-[10px] font-bold">{step}</Text>
                  </View>
                  <Text className="text-slate-600 dark:text-slate-300 text-[10px] font-semibold text-center">{label}</Text>
                </View>
                {index < 2 && <FontAwesome name="chevron-right" size={10} color="#94a3b8" />}
              </React.Fragment>
            ))}
          </View>
        </View>

        <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2 ml-1">Your SMS-enabled accounts</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {accounts.filter(item => !!item.sms_number).map(account => {
            const accountRuleCount = rules.filter(rule => rule.accountId === account.id).length;
            return (
              <View key={account.id} className="w-72 bg-white dark:bg-slate-800 rounded-3xl p-4 mr-3 border border-slate-100 dark:border-slate-700 shadow-md">
                <View className="flex-row items-center mb-3">
                  <View className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 justify-center items-center mr-3">
                    <FontAwesome name={account.type === 'MOBILE_MONEY' ? 'mobile' : 'bank'} size={18} color="#6366f1" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold" numberOfLines={1}>{account.name}</Text>
                    <Text className="text-slate-500 text-xs mt-0.5 dark:text-slate-400">
                      {accountRuleCount} rules · {calibrationCounts[account.id] ?? 0} AI examples
                    </Text>
                  </View>
                  <View className={`px-2 py-1 rounded-full ${accountRuleCount ? 'bg-green-50 dark:bg-green-900/30' : 'bg-amber-50 dark:bg-amber-900/30'}`}>
                    <Text className={`text-[10px] font-bold ${accountRuleCount ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
                      {accountRuleCount ? 'Learning' : 'New'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => handleReviewAccount(account.id)} className="bg-teal-600 rounded-2xl py-3 flex-row justify-center items-center mb-2">
                  <FontAwesome name="check-square-o" size={14} color="#fff" />
                  <Text className="text-white font-bold text-sm ml-2">Review & Teach</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void openAICalibration(account.id)} className="bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl py-3 flex-row justify-center items-center mb-1 border border-indigo-100 dark:border-indigo-800">
                  <FontAwesome name="magic" size={14} color="#6366f1" />
                  <Text className="text-indigo-700 dark:text-indigo-300 font-bold text-sm ml-2">AI Calibration</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRecalibrateAccount(account.id)} className="py-2 flex-row justify-center items-center">
                  <FontAwesome name="refresh" size={12} color="#64748b" />
                  <Text className="text-slate-500 dark:text-slate-400 font-semibold text-xs ml-2">Recalibrate this bank</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {accounts.filter(item => !!item.sms_number).length === 0 && (
            <TouchableOpacity onPress={() => router.push('/accounts' as any)} className="w-72 bg-white dark:bg-slate-800 rounded-3xl p-5 border border-dashed border-teal-300 dark:border-teal-700 items-center">
              <FontAwesome name="plus-circle" size={24} color="#14b8a6" />
              <Text className="text-slate-900 dark:text-white font-bold mt-2">Connect a bank account</Text>
              <Text className="text-slate-500 dark:text-slate-400 text-xs text-center mt-1">Add its SMS sender to start teaching the parser.</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {/* Account Selectors & Search */}
      <View className="px-6 mb-4">
        {/* Search */}
        <View className="bg-white dark:bg-slate-800 rounded-2xl flex-row items-center px-4 py-3.5 shadow-lg border border-slate-100 dark:border-slate-700 mb-3">
          <FontAwesome name="search" size={16} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search rules, merchants, categories..."
            placeholderTextColor="#94a3b8"
            className="flex-1 ml-3 text-slate-900 dark:text-white font-medium text-sm"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSearchQuery('')}>
              <FontAwesome name="times-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Account Selector Horizontal Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-row mb-1"
        >
          <TouchableOpacity
            onPress={() => setSelectedAccountId('all')}
            className={`px-4 py-2 rounded-full mr-2 border ${ selectedAccountId === 'all' ? 'bg-teal-600 border-teal-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' }`}
          >
            <Text
              className={`text-xs font-bold ${ selectedAccountId === 'all' ? 'text-white' : 'text-slate-600 dark:text-slate-300' }`}
            >
              All Accounts
            </Text>
          </TouchableOpacity>
          {accounts.map(acc => (
            <TouchableOpacity
              key={acc.id}
              onPress={() => setSelectedAccountId(acc.id)}
              className={`px-4 py-2 rounded-full mr-2 border ${ selectedAccountId === acc.id ? 'bg-teal-600 border-teal-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' }`}
            >
              <Text
                className={`text-xs font-bold ${ selectedAccountId === acc.id ? 'text-white' : 'text-slate-600 dark:text-slate-300' }`}
              >
                {acc.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Tabs */}
      <View className="px-6 mb-4">
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-1.5 flex-row shadow-md">
          {['all', 'merchant', 'reference', 'sender'].map(tab => (
            <TouchableOpacity
              key={tab}
              onPress={() => setSelectedTab(tab as any)}
              className={`flex-1 py-2.5 rounded-xl ${ selectedTab === tab ? 'bg-teal-600' : '' }`}
            >
              <Text
                className={`text-center text-xs font-bold capitalize ${ selectedTab === tab ? 'text-white' : 'text-slate-500 dark:text-slate-400' }`}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Main List */}
      {loading ? (
        <View className="py-16 justify-center items-center">
          <CoinLoader size="large" color="#14b8a6" />
        </View>
      ) : (
        <Animated.View style={{ opacity: fadeAnim }} className="px-6">
            {filteredRules.length === 0 ? (
              <ScreenInfoCard
                icon="magic"
                title={searchQuery ? 'No matching rules' : 'Teach your SMS parser'}
                description={searchQuery ? 'Try a different search or clear the filter.' : 'HisabTrack gets better when you verify a draft and correct its merchant or category.'}
                suggestions={searchQuery ? ['Clear the search to see all learned rules.'] : ['Use AI Calibration to verify a real bank SMS.', 'Correct a draft before recording it so the bank pattern is remembered.', 'Teach each bank account separately for more accurate parsing.']}
              />
            ) : (
              filteredRules.map(renderRuleCard)
            )}
            <View className="h-6" />
        </Animated.View>
      )}
      </ScrollView>

      {/* AI calibration wizard */}
      <Modal
        visible={showAICalibration}
        animationType="slide"
        onRequestClose={() => setShowAICalibration(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 bg-slate-50 dark:bg-slate-900"
        >
          <LinearGradient colors={['#4f46e5', '#7c3aed']} className="px-6 pt-8 pb-6 rounded-b-[28px]">
            <View className="flex-row items-center">
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={() => setShowAICalibration(false)} className="w-10 h-10 rounded-xl bg-white/20 justify-center items-center">
                <FontAwesome name="times" size={18} color="#fff" />
              </TouchableOpacity>
              <View className="flex-1 ml-4">
                <Text className="text-white text-xl font-bold">AI SMS Calibration</Text>
                <Text className="text-white/90 text-xs mt-1">AI suggests. You verify. HisabTrack remembers.</Text>
              </View>
            </View>
          </LinearGradient>

          {calibrationLoading ? (
            <View className="flex-1 justify-center items-center px-8">
              <CoinLoader size="large" color="#6366f1" />
              <Text className="text-slate-700 dark:text-slate-300 font-bold mt-4">
                {selectedSample ? 'AI is reading the sample…' : 'Loading recent bank messages…'}
              </Text>
              <Text className="text-slate-500 text-xs text-center mt-2 dark:text-slate-400">The selected SMS is sent to your configured AI provider.</Text>
            </View>
          ) : !selectedSample ? (
            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingVertical: 20, paddingBottom: 40 }}>
              <View className="bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl p-4 mb-4 border border-indigo-100 dark:border-indigo-800">
                <Text className="text-indigo-900 dark:text-indigo-200 font-bold">1. Choose a clear sample</Text>
                <Text className="text-indigo-700 dark:text-indigo-300 text-xs mt-1 leading-5">Pick a normal debit or credit message. You will see and correct the AI result before anything is saved.</Text>
              </View>
              {smsSamples.length === 0 ? (
                <View className="items-center py-16">
                  <FontAwesome name="comment-o" size={36} color="#94a3b8" />
                  <Text className="text-slate-900 dark:text-white font-bold mt-4">No recent SMS found</Text>
                  <Text className="text-slate-500 dark:text-slate-400 text-xs text-center mt-2">Check this account's SMS sender in Accounts, then try again.</Text>
                </View>
              ) : smsSamples.map(sample => (
                <TouchableOpacity key={sample.id} onPress={() => void runAIParse(sample)} className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-slate-700">
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-indigo-600 dark:text-indigo-400 text-xs font-bold">{sample.address}</Text>
                    <Text className="text-slate-500 text-[10px] dark:text-slate-400">{new Date(sample.date).toLocaleDateString()}</Text>
                  </View>
                  <Text className="text-slate-700 dark:text-slate-200 text-xs leading-5" numberOfLines={4}>{sample.body}</Text>
                  <View className="flex-row items-center mt-3">
                    <FontAwesome name="magic" size={11} color="#6366f1" />
                    <Text className="text-indigo-600 dark:text-indigo-400 text-xs font-bold ml-2">Parse this sample with AI</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingVertical: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-4 mb-4 border border-green-100 dark:border-green-800">
                <Text className="text-green-900 dark:text-green-200 font-bold">2. Verify the AI result</Text>
                <Text className="text-green-700 dark:text-green-300 text-xs mt-1">Correct anything that is wrong. Your confirmed version becomes a bank-specific example.</Text>
              </View>

              <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2">Transaction type</Text>
              <View className="flex-row mb-4 bg-white dark:bg-slate-800 rounded-2xl p-1 border border-slate-200 dark:border-slate-700">
                {(['EXPENSE', 'INCOME'] as const).map(type => (
                  <TouchableOpacity key={type} onPress={() => setAIType(type)} className={`flex-1 py-3 rounded-xl ${aiType === type ? (type === 'INCOME' ? 'bg-green-600' : 'bg-red-500') : ''}`}>
                    <Text className={`text-center font-bold text-xs ${aiType === type ? 'text-white' : 'text-slate-500'}`}>{type === 'INCOME' ? 'Money in' : 'Money out'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {[
                ['amount', 'Amount *', 'numeric'],
                ['merchant', 'Sender / recipient', 'default'],
                ['accountNumber', 'Account number / tail', 'default'],
                ['referenceNumber', 'Reference number', 'default'],
                ['balance', 'Balance after transaction', 'numeric'],
                ['fees', 'Fee', 'numeric'],
                ['tax', 'Tax', 'numeric'],
              ].map(([key, label, keyboard]) => (
                <View key={key} className="mb-3">
                  <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold mb-1.5">{label}</Text>
                  <TextInput
                    value={aiFields[key] ?? ''}
                    onChangeText={value => setAIFields(previous => ({ ...previous, [key]: value }))}
                    keyboardType={keyboard === 'numeric' ? 'decimal-pad' : 'default'}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white"
                    placeholder="Not found"
                    placeholderTextColor="#94a3b8"
                  />
                </View>
              ))}

              <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold mb-1.5">Description shown in transactions</Text>
              <TextInput value={aiDescription} onChangeText={setAIDescription} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white mb-3" />

              <Text className="text-slate-500 dark:text-slate-400 text-xs font-bold mb-2">Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-5">
                {categories.map(category => (
                  <TouchableOpacity key={category.id} onPress={() => setAICategory(category.name)} className={`px-4 py-2.5 rounded-full mr-2 border ${aiCategory === category.name ? 'bg-indigo-600 border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                    <Text className={`text-xs font-bold ${aiCategory === category.name ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>{category.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View className="flex-row gap-3">
                <TouchableOpacity onPress={() => setSelectedSample(null)} className="flex-1 py-4 rounded-2xl bg-slate-200 dark:bg-slate-700">
                  <Text className="text-slate-700 dark:text-slate-200 text-center font-bold">Try another</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void saveAICalibration()} className="flex-1 py-4 rounded-2xl bg-indigo-600">
                  <Text className="text-white text-center font-bold">Confirm & teach</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Rule Modal */}
      <FormSheet
        visible={showEditModal}
        onClose={() => { setShowEditModal(false); setEditingRule(null); }}
        maxHeight="85%"
        accessibilityLabel="Edit SMS rule"
      >
            <View>
              {/* Modal Header */}
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-slate-900 dark:text-white font-bold text-xl">
                  Edit Mapping Rule
                </Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close"
                  onPress={() => {
                    setShowEditModal(false);
                    setEditingRule(null);
                  }}
                  className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl justify-center items-center"
                >
                  <FontAwesome name="times" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Description Input */}
              <View className="mb-5">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2 text-sm">
                  Description Map To *
                </Text>
                <TextInput
                  value={editDescription}
                  onChangeText={(value) => { clearError('description'); setEditDescription(value); }}
                  placeholder="e.g. CBE Transfer"
                  placeholderTextColor="#94a3b8"
                  accessibilityLabel="Rule description"
                  aria-invalid={!!errors.description}
                  className={`bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white font-semibold border-2 ${errors.description ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'}`}
                />
                {errors.description ? (
                  <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-xs mt-1.5 font-semibold">{errors.description}</Text>
                ) : null}
              </View>

              {/* Category Selector */}
              <View className="mb-6">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2 text-sm">
                  Category *
                </Text>
                <TouchableOpacity
                  onPress={() => setShowCategorySelector(!showCategorySelector)}
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 flex-row justify-between items-center"
                >
                  <View className="flex-row items-center">
                    <View
                      className="w-3.5 h-3.5 rounded-full mr-3"
                      style={{ backgroundColor: getCategoryColor(editCategory) }}
                    />
                    <Text className="text-slate-900 dark:text-white font-semibold">
                      {editCategory}
                    </Text>
                  </View>
                  <FontAwesome
                    name={showCategorySelector ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#64748b"
                  />
                </TouchableOpacity>

                {showCategorySelector && (
                  <View className="mt-2 bg-slate-50 dark:bg-slate-800 rounded-2xl p-3 border border-slate-200 dark:border-slate-700 max-h-[160px]">
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                      {categories.map(cat => (
                        <TouchableOpacity
                          key={cat.id}
                          onPress={() => {
                            setEditCategory(cat.name);
                            setShowCategorySelector(false);
                          }}
                          className={`flex-row items-center p-3 rounded-xl mb-1 ${ editCategory.toLowerCase() === cat.name.toLowerCase() ? 'bg-teal-50 dark:bg-teal-900/20' : '' }`}
                        >
                          <View
                            className="w-3.5 h-3.5 rounded-full mr-3"
                            style={{ backgroundColor: cat.color }}
                          />
                          <Text className="font-semibold text-slate-800 dark:text-slate-200">
                            {cat.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Action Buttons */}
              <View className="flex-row gap-3 mt-4">
                <TouchableOpacity
                  onPress={() => {
                    setShowEditModal(false);
                    setEditingRule(null);
                  }}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 py-4 rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  <Text className="text-slate-700 dark:text-slate-300 font-bold text-center">
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveRule}
                  className="flex-1 bg-teal-600 py-4 rounded-xl shadow-md"
                >
                  <Text className="text-white font-bold text-center">Save Changes</Text>
                </TouchableOpacity>
              </View>
            </View>
      </FormSheet>
    </View>
  );
}
