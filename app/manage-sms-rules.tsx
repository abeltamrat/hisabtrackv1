import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Animated,
  ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { SMSLearningService, SMSRule } from '@/services/SMSLearningService';
import { StorageService } from '@/utils/storage';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/contexts/I18nContext';

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
}

export default function ManageSMSRulesScreen() {
  const router = useRouter();
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
  const [editCategory, setEditCategory] = useState('');
  const [showCategorySelector, setShowCategorySelector] = useState(false);

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
    loadData();
  }, []);

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
        };
      });

      setRules(mapped);
      
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
    if (!editDescription.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }

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
                className={`px-2.5 py-1 rounded-full mr-2 ${
                  rule.matchBy === 'merchant'
                    ? 'bg-teal-50 dark:bg-teal-900/30'
                    : rule.matchBy === 'reference'
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'bg-amber-50 dark:bg-amber-900/30'
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    rule.matchBy === 'merchant'
                      ? 'text-teal-700 dark:text-teal-400'
                      : rule.matchBy === 'reference'
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {rule.matchBy.toUpperCase()}
                </Text>
              </View>

              <Text className="text-xs text-slate-400 font-semibold">
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

            <Text className="text-slate-500 text-xs mb-2">
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
            </View>

            {/* Translation Output */}
            <View className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-[10px] uppercase font-bold text-slate-400">Maps to Details</Text>
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
            <TouchableOpacity
              onPress={() => handleEditRule(rule)}
              className="w-9 h-9 bg-teal-50 dark:bg-teal-900/30 rounded-xl justify-center items-center mr-2 border border-teal-100 dark:border-teal-900"
            >
              <FontAwesome name="pencil" size={14} color="#14b8a6" />
            </TouchableOpacity>
            <TouchableOpacity
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
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-12 h-12 bg-white/20 backdrop-blur-lg rounded-2xl justify-center items-center"
          >
            <FontAwesome name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <View className="flex-1 items-center">
            <Text className="text-white text-xl font-bold">SMS Learning Rules</Text>
            <Text className="text-white/80 text-xs mt-1">Auto-normalizing banking texts</Text>
          </View>
          <TouchableOpacity
            onPress={handleClearAll}
            disabled={rules.length === 0}
            className={`w-12 h-12 rounded-2xl justify-center items-center ${
              rules.length === 0 ? 'bg-white/10 opacity-50' : 'bg-white/20'
            }`}
          >
            <FontAwesome name="trash-o" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View className="flex-row space-x-3">
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4">
            <Text className="text-white/70 text-xs font-semibold">Learned Rules</Text>
            <Text className="text-white text-2xl font-bold mt-1">{rules.length}</Text>
          </View>
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4">
            <Text className="text-white/70 text-xs font-semibold">Active Filtered</Text>
            <Text className="text-white text-2xl font-bold mt-1">{filteredRules.length}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Account Selectors & Search */}
      <View className="px-6 -mt-4 mb-4">
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
            <TouchableOpacity onPress={() => setSearchQuery('')}>
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
            className={`px-4 py-2 rounded-full mr-2 border ${
              selectedAccountId === 'all'
                ? 'bg-teal-600 border-teal-600'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                selectedAccountId === 'all' ? 'text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              All Accounts
            </Text>
          </TouchableOpacity>
          {accounts.map(acc => (
            <TouchableOpacity
              key={acc.id}
              onPress={() => setSelectedAccountId(acc.id)}
              className={`px-4 py-2 rounded-full mr-2 border ${
                selectedAccountId === acc.id
                  ? 'bg-teal-600 border-teal-600'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  selectedAccountId === acc.id ? 'text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
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
              className={`flex-1 py-2.5 rounded-xl ${
                selectedTab === tab ? 'bg-teal-600' : ''
              }`}
            >
              <Text
                className={`text-center text-xs font-bold capitalize ${
                  selectedTab === tab ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Main List */}
      {loading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#14b8a6" />
        </View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
            {filteredRules.length === 0 ? (
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-12 items-center shadow-lg border border-slate-100 dark:border-slate-700 mt-4">
                <View className="w-20 h-20 bg-teal-50 dark:bg-teal-900/20 rounded-full justify-center items-center mb-5">
                  <FontAwesome name="magic" size={32} color="#14b8a6" />
                </View>
                <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">
                  No Learning Rules Found
                </Text>
                <Text className="text-slate-500 dark:text-slate-400 text-center text-xs leading-5">
                  {searchQuery
                    ? 'Try adjusting your search criteria'
                    : 'The app learns your mappings when you correct draft category/merchant descriptions on transaction reconciliation.'}
                </Text>
              </View>
            ) : (
              filteredRules.map(renderRuleCard)
            )}
            <View className="h-6" />
          </ScrollView>
        </Animated.View>
      )}

      {/* Edit Rule Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowEditModal(false);
          setEditingRule(null);
        }}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-[32px] max-h-[85%] pb-8">
            <View className="p-6">
              {/* Modal Header */}
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-slate-900 dark:text-white font-bold text-xl">
                  Edit Mapping Rule
                </Text>
                <TouchableOpacity
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
                  onChangeText={setEditDescription}
                  placeholder="e.g. CBE Transfer"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white font-semibold border-2 border-slate-200 dark:border-slate-700"
                />
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
                          className={`flex-row items-center p-3 rounded-xl mb-1 ${
                            editCategory.toLowerCase() === cat.name.toLowerCase()
                              ? 'bg-teal-50 dark:bg-teal-900/20'
                              : ''
                          }`}
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
              <View className="flex-row space-x-3 mt-4">
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
          </View>
        </View>
      </Modal>
    </View>
  );
}
