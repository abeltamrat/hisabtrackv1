import { BankService } from '@/services/BankService';
import LocalAssetService from '@/services/LocalAssetService';
import { Bank } from '@/types/bank';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';


type TabType = 'all' | 'custom' | 'bundled';

export default function BanksScreen() {
  const router = useRouter();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [filteredBanks, setFilteredBanks] = useState<Bank[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);

  // Form states
  const [bankName, setBankName] = useState('');
  const [bankLogo, setBankLogo] = useState('');
  const [bankColor, setBankColor] = useState('#3b82f6');
  const [bankWebsite, setBankWebsite] = useState('');
  const [bankPhone, setBankPhone] = useState('');
  const [bankSmsNumber, setBankSmsNumber] = useState('');
  const [bankCountry, setBankCountry] = useState('');

  // Logo selection
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [localLogos, setLocalLogos] = useState<Record<string, string>>({});

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
    loadBanks();
    loadLocalLogos();
  }, []);

  const loadBanks = async () => {
    const allBanks = await BankService.getAllBanks();
    setBanks(allBanks);
    filterBanks(allBanks, activeTab, searchQuery);
  };

  const loadLocalLogos = async () => {
    const logos = await LocalAssetService.getAllLogos();
    setLocalLogos(logos);
  };

  const filterBanks = (bankList: Bank[], tab: TabType, query: string) => {
    let filtered = bankList;

    // Filter by tab
    if (tab === 'custom') {
      filtered = filtered.filter(b => !b.isBundled);
    } else if (tab === 'bundled') {
      filtered = filtered.filter(b => b.isBundled);
    }

    // Filter by search
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(b =>
        b.name.toLowerCase().includes(lowerQuery) ||
        b.country?.toLowerCase().includes(lowerQuery)
      );
    }

    setFilteredBanks(filtered);
  };

  useEffect(() => {
    filterBanks(banks, activeTab, searchQuery);
  }, [activeTab, searchQuery, banks]);

  const resetForm = () => {
    setBankName('');
    setBankLogo('');
    setBankColor('#3b82f6');
    setBankWebsite('');
    setBankPhone('');
    setBankSmsNumber('');
    setBankCountry('');
    setEditingBank(null);
  };

  const handleAddBank = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleEditBank = (bank: Bank) => {
    if (bank.isBundled) {
      Alert.alert(
        'Edit Bundled Bank',
        'Bundled banks cannot be edited directly. Would you like to create a custom copy?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create Copy',
            onPress: async () => {
              const customCopy = await BankService.importBundledBank(bank.id);
              await loadBanks();
              handleEditBank(customCopy);
            },
          },
        ]
      );
      return;
    }

    setEditingBank(bank);
    setBankName(bank.name);
    setBankLogo(bank.logo || '');
    setBankColor(bank.color || '#3b82f6');
    setBankWebsite(bank.website || '');
    setBankPhone(bank.phone || '');
    setBankSmsNumber(bank.smsNumber || '');
    setBankCountry(bank.country || '');
    setShowAddModal(true);
  };

  const handleDeleteBank = (bank: Bank) => {
    if (bank.isBundled) {
      Alert.alert('Error', 'Cannot delete bundled banks');
      return;
    }

    Alert.alert('Delete Bank', `Are you sure you want to delete "${bank.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await BankService.deleteBank(bank.id);
            await loadBanks();
            Alert.alert('Success', 'Bank deleted successfully');
          } catch (error) {
            Alert.alert('Error', 'Failed to delete bank');
          }
        },
      },
    ]);
  };

  const handleSaveBank = async () => {
    if (!bankName.trim()) {
      Alert.alert('Error', 'Please enter bank name');
      return;
    }

    try {
      if (editingBank) {
        await BankService.updateBank(editingBank.id, {
          name: bankName,
          logo: bankLogo || undefined,
          color: bankColor,
          website: bankWebsite || undefined,
          phone: bankPhone || undefined,
          smsNumber: bankSmsNumber || undefined,
          country: bankCountry || undefined,
        });
        Alert.alert('Success', 'Bank updated successfully');
      } else {
        await BankService.addBank({
          name: bankName,
          logo: bankLogo || undefined,
          color: bankColor,
          website: bankWebsite || undefined,
          phone: bankPhone || undefined,
          smsNumber: bankSmsNumber || undefined,
          country: bankCountry || undefined,
        });
        Alert.alert('Success', 'Bank added successfully');
      }

      setShowAddModal(false);
      resetForm();
      await loadBanks();
    } catch (error) {
      Alert.alert('Error', 'Failed to save bank');
      console.error(error);
    }
  };

  const predefinedColors = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
    '#ef4444', '#06b6d4', '#ec4899', '#14b8a6',
    '#6366f1', '#f97316', '#84cc16', '#a855f7',
  ];

  // Helper to get proper image source for both native and web
  const getImageSource = (bank: Bank) => {
    // 1. Prefer logoSrc (bundled result) if available
    if (bank.logoSrc !== undefined && bank.logoSrc !== null) {
      if (typeof bank.logoSrc === 'number') {
        return bank.logoSrc;
      }
      if (typeof bank.logoSrc === 'string') {
        return { uri: bank.logoSrc };
      }
      if (typeof bank.logoSrc === 'object') {
        if (bank.logoSrc.uri) return bank.logoSrc; // Already proper format
        if (bank.logoSrc.default) return { uri: bank.logoSrc.default }; // Handle ES module wrapper
        return bank.logoSrc; // Pass as is and hope it works
      }
    }

    // 2. Fallback to logo string (custom banks or legacy)
    if (bank.logo) {
      return { uri: bank.logo };
    }

    return undefined;
  };

  const renderBankCard = (bank: Bank) => {
    const imageSource = getImageSource(bank);

    return (
      <View key={bank.id} className="mb-4">
        <TouchableOpacity
          onPress={() => handleEditBank(bank)}
          className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-lg border border-slate-100 dark:border-slate-700"
          style={{ elevation: 3 }}
        >
          <View className="flex-row items-center">
            {/* Bank Logo */}
            <View
              className="w-16 h-16 rounded-xl overflow-hidden mr-4 justify-center items-center border-2"
              style={{
                backgroundColor: imageSource ? '#fff' : (bank.color || '#3b82f6') + '20',
                borderColor: bank.color || '#3b82f6',
              }}
            >
              {imageSource ? (
                <Image
                  source={imageSource}
                  style={{ width: 56, height: 56 }}
                  resizeMode="contain"
                />
              ) : (
                <FontAwesome name="bank" size={28} color={bank.color || '#3b82f6'} />
              )}
            </View>

            {/* Bank Info */}
            <View className="flex-1">
              <Text className="font-bold text-lg text-slate-900 dark:text-white mb-1">
                {bank.name}
              </Text>
              <View className="flex-row items-center flex-wrap">
                {bank.country && (
                  <View className="px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/30 mr-2 mb-1">
                    <Text className="text-xs font-bold text-blue-700 dark:text-blue-400">
                      {bank.country}
                    </Text>
                  </View>
                )}
                {bank.isBundled && (
                  <View className="px-2 py-1 rounded-md bg-indigo-100 dark:bg-indigo-900/30 mb-1">
                    <Text className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                      Bundled
                    </Text>
                  </View>
                )}
                {!bank.isBundled && (
                  <View className="px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-900/30 mb-1">
                    <Text className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      Custom
                    </Text>
                  </View>
                )}
              </View>
              {bank.website && (
                <Text className="text-slate-500 dark:text-slate-400 text-xs mt-1" numberOfLines={1}>
                  🌐 {bank.website}
                </Text>
              )}
              {bank.phone && (
                <Text className="text-slate-500 dark:text-slate-400 text-xs">
                  📞 {bank.phone}
                </Text>
              )}
            </View>

            {/* Actions */}
            {!bank.isBundled && (
              <TouchableOpacity
                onPress={() => handleDeleteBank(bank)}
                className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl justify-center items-center ml-2"
              >
                <FontAwesome name="trash" size={16} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-900">
      <StatusBar style="auto" />

      {/* Header with Gradient */}
      <LinearGradient
        colors={['#3b82f6', '#2563eb', '#1d4ed8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 8 }}
      >
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-12 h-12 bg-white/20 backdrop-blur-lg rounded-2xl justify-center items-center"
            style={{ elevation: 2 }}
          >
            <FontAwesome name="arrow-left" size={20} color="#fff" />
          </TouchableOpacity>
          <View className="flex-1 items-center">
            <Text className="text-white text-2xl font-bold">Banks</Text>
            <Text className="text-white/80 text-sm mt-1">Manage your banks</Text>
          </View>
          <TouchableOpacity
            onPress={handleAddBank}
            className="w-12 h-12 bg-white/20 backdrop-blur-lg rounded-2xl justify-center items-center"
            style={{ elevation: 2 }}
          >
            <FontAwesome name="plus" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Stats Cards */}
        <View className="flex-row space-x-3">
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4" style={{ elevation: 2 }}>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-white/80 text-xs font-semibold">Total Banks</Text>
                <Text className="text-white text-2xl font-bold mt-1">{banks.length}</Text>
              </View>
              <View className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
                <FontAwesome name="bank" size={18} color="#fff" />
              </View>
            </View>
          </View>
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4" style={{ elevation: 2 }}>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-white/80 text-xs font-semibold">Custom</Text>
                <Text className="text-white text-2xl font-bold mt-1">
                  {banks.filter(b => !b.isBundled).length}
                </Text>
              </View>
              <View className="w-10 h-10 bg-emerald-500/30 rounded-xl justify-center items-center">
                <FontAwesome name="star" size={18} color="#fff" />
              </View>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* Tab Navigation */}
      <View className="px-6 -mt-4 mb-4">
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-2 flex-row shadow-lg" style={{ elevation: 4 }}>
          <TouchableOpacity
            onPress={() => setActiveTab('all')}
            className={`flex-1 py-3 rounded-xl ${activeTab === 'all' ? 'bg-gradient-to-r from-blue-500 to-blue-600' : ''}`}
          >
            <Text className={`text-center font-bold ${activeTab === 'all' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('custom')}
            className={`flex-1 py-3 rounded-xl ${activeTab === 'custom' ? 'bg-gradient-to-r from-blue-500 to-blue-600' : ''}`}
          >
            <Text className={`text-center font-bold ${activeTab === 'custom' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              Custom
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('bundled')}
            className={`flex-1 py-3 rounded-xl ${activeTab === 'bundled' ? 'bg-gradient-to-r from-blue-500 to-blue-600' : ''}`}
          >
            <Text className={`text-center font-bold ${activeTab === 'bundled' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              Bundled
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View className="px-6 mb-4">
        <View className="bg-white dark:bg-slate-800 rounded-2xl flex-row items-center px-4 py-3 shadow-md border border-slate-200 dark:border-slate-700" style={{ elevation: 2 }}>
          <FontAwesome name="search" size={18} color="#94a3b8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search banks..."
            placeholderTextColor="#94a3b8"
            className="flex-1 ml-3 text-slate-900 dark:text-white font-medium"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <FontAwesome name="times-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Banks List */}
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {filteredBanks.length === 0 ? (
            <View className="bg-white dark:bg-slate-800 rounded-3xl p-12 items-center shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
              <View className="w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-full justify-center items-center mb-6">
                <FontAwesome name="bank" size={40} color="#3b82f6" />
              </View>
              <Text className="text-slate-900 dark:text-white font-bold text-xl mb-2">
                {searchQuery ? 'No Results' : 'No Banks'}
              </Text>
              <Text className="text-slate-500 dark:text-slate-400 text-center mb-6">
                {searchQuery
                  ? 'No banks match your search'
                  : 'Add your first bank to get started'}
              </Text>
              {!searchQuery && (
                <TouchableOpacity
                  onPress={handleAddBank}
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-3 rounded-xl shadow-md"
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="plus" size={16} color="#fff" />
                    <Text className="text-white font-bold ml-2">Add Bank</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filteredBanks.map(renderBankCard)
          )}
          <View className="h-6" />
        </ScrollView>
      </Animated.View>

      {/* Add/Edit Bank Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-[32px] max-h-[90%]" style={{ elevation: 8 }}>
            <ScrollView className="px-6 py-6" showsVerticalScrollIndicator={false}>
              {/* Modal Header */}
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-slate-900 dark:text-white font-bold text-2xl">
                  {editingBank ? 'Edit Bank' : 'Add Bank'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl justify-center items-center"
                >
                  <FontAwesome name="times" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Logo Preview */}
              {bankLogo && (
                <View className="items-center mb-6">
                  <View
                    className="w-24 h-24 rounded-2xl overflow-hidden border-4 justify-center items-center"
                    style={{ borderColor: bankColor, backgroundColor: '#fff' }}
                  >
                    <Image
                      source={{ uri: bankLogo }}
                      style={{ width: 88, height: 88 }}
                      resizeMode="contain"
                    />
                  </View>
                  <Text className="text-slate-500 text-sm mt-2">Bank Logo</Text>
                </View>
              )}

              {/* Bank Name */}
              <View className="mb-4">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Bank Name *</Text>
                <TextInput
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="e.g., Chase Bank"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white font-semibold border-2 border-slate-200 dark:border-slate-700"
                />
              </View>

              {/* Logo URL */}
              <View className="mb-4">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Logo URL</Text>
                <View className="flex-row">
                  <TextInput
                    value={bankLogo}
                    onChangeText={setBankLogo}
                    placeholder="https://example.com/logo.png"
                    placeholderTextColor="#94a3b8"
                    className="flex-1 bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700 mr-2"
                  />
                  <TouchableOpacity
                    onPress={() => {
                      setShowLogoModal(true);
                      loadLocalLogos();
                    }}
                    className="bg-blue-500 px-4 py-4 rounded-xl justify-center items-center"
                  >
                    <FontAwesome name="folder" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Brand Color */}
              <View className="mb-4">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Brand Color</Text>
                <View className="flex-row flex-wrap">
                  {predefinedColors.map((color) => (
                    <TouchableOpacity
                      key={color}
                      onPress={() => setBankColor(color)}
                      className="w-12 h-12 rounded-xl mr-2 mb-2 justify-center items-center border-4"
                      style={{
                        backgroundColor: color,
                        borderColor: bankColor === color ? '#000' : 'transparent',
                      }}
                    >
                      {bankColor === color && (
                        <FontAwesome name="check" size={20} color="#fff" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Country */}
              <View className="mb-4">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Country Code</Text>
                <TextInput
                  value={bankCountry}
                  onChangeText={(text) => setBankCountry(text.toUpperCase())}
                  placeholder="e.g., US, ET, GB"
                  placeholderTextColor="#94a3b8"
                  maxLength={2}
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white font-semibold border-2 border-slate-200 dark:border-slate-700"
                />
              </View>

              {/* Website */}
              <View className="mb-4">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Website</Text>
                <TextInput
                  value={bankWebsite}
                  onChangeText={setBankWebsite}
                  placeholder="https://www.bank.com"
                  placeholderTextColor="#94a3b8"
                  keyboardType="url"
                  autoCapitalize="none"
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700"
                />
              </View>

              {/* Phone */}
              <View className="mb-4">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Phone Number</Text>
                <TextInput
                  value={bankPhone}
                  onChangeText={setBankPhone}
                  placeholder="+1 (555) 123-4567"
                  placeholderTextColor="#94a3b8"
                  keyboardType="phone-pad"
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700"
                />
              </View>

              {/* SMS Number */}
              <View className="mb-6">
                <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">SMS Number</Text>
                <TextInput
                  value={bankSmsNumber}
                  onChangeText={setBankSmsNumber}
                  placeholder="Short code for SMS notifications"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 dark:bg-slate-800 px-4 py-4 rounded-xl text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700"
                />
                <Text className="text-slate-500 text-xs mt-2">
                  Used for automatic transaction detection from SMS
                </Text>
              </View>

              {/* Action Buttons */}
              <View className="flex-row space-x-3 mb-6">
                <TouchableOpacity
                  onPress={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="flex-1 bg-slate-200 dark:bg-slate-700 py-4 rounded-xl"
                >
                  <Text className="text-slate-700 dark:text-slate-300 font-bold text-center">
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveBank}
                  className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-500 py-4 rounded-xl shadow-md"
                  style={{ elevation: 2 }}
                >
                  <Text className="text-white font-bold text-center">
                    {editingBank ? 'Save Changes' : 'Add Bank'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Logo Selection Modal */}
      <Modal
        visible={showLogoModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowLogoModal(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-[32px] max-h-[70%]" style={{ elevation: 8 }}>
            <View className="p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-slate-900 dark:text-white font-bold text-xl">
                  Select Logo
                </Text>
                <TouchableOpacity
                  onPress={() => setShowLogoModal(false)}
                  className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl justify-center items-center"
                >
                  <FontAwesome name="times" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {Object.entries(localLogos).map(([name, url]) => (
                  <TouchableOpacity
                    key={name}
                    onPress={() => {
                      setBankLogo(url);
                      setShowLogoModal(false);
                    }}
                    className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl mb-3 border border-slate-200 dark:border-slate-700"
                  >
                    <View className="w-12 h-12 bg-white dark:bg-slate-700 rounded-xl overflow-hidden mr-4 justify-center items-center">
                      <Image
                        source={{ uri: url }}
                        style={{ width: 40, height: 40 }}
                        resizeMode="contain"
                      />
                    </View>
                    <Text className="flex-1 font-semibold text-slate-900 dark:text-white">
                      {name}
                    </Text>
                    <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  onPress={() => {
                    setShowLogoModal(false);
                    router.push('/old-manage-assets');
                  }}
                  className="bg-blue-500 p-4 rounded-xl mt-4"
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name="plus" size={16} color="#fff" />
                    <Text className="text-white font-bold ml-2">Add New Logo</Text>
                  </View>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
