import LocalAssetService from '@/services/LocalAssetService';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type AssetType = 'bundled' | 'user';
type TabType = 'my-assets' | 'bundled' | 'add-new';

export default function ManageAssets() {
  const router = useRouter();
  const [bundled, setBundled] = useState<Record<string, any>>({});
  const [userAssets, setUserAssets] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<TabType>('my-assets');
  
  // Add new asset states
  const [name, setName] = useState('');
  const [urlImport, setUrlImport] = useState('');
  
  // Edit states
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingNewName, setEditingNewName] = useState('');
  const [editingNewUrl, setEditingNewUrl] = useState('');
  const [editingBundledKey, setEditingBundledKey] = useState<string | null>(null);
  const [editingBundledName, setEditingBundledName] = useState('');
  const [editingBundledUrl, setEditingBundledUrl] = useState<any>('');
  
  // Modal states
  const [showBundledSelection, setShowBundledSelection] = useState(false);
  const [isSelectingForEdit, setIsSelectingForEdit] = useState(false);
  const [showServerList, setShowServerList] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  const load = async () => {
    try {
      // Load bundled logos
      const b = await import('@/assets/bankLogos/et');
      const bundledOnly = b.BUNDLED_LOGOS.reduce((acc, item) => {
        acc[item.name] = { src: item.src ?? item.url, url: typeof item.url === 'string' ? item.url : (typeof item.src === 'string' ? item.src : '') };
        return acc;
      }, {} as Record<string, any>);

      // Load edited bundled logos
      const editedBundledStr = await AsyncStorage.getItem('editedBundledLogos');
      if (editedBundledStr) {
        const editedBundled = JSON.parse(editedBundledStr);
        Object.assign(bundledOnly, editedBundled);
      }

      // Load user assets
      const user = await LocalAssetService.getUserAssets();

      setBundled(bundledOnly);
      setUserAssets(user || {});

      // Update document title for web
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.title = `Manage Assets - HisabTrack`;
      }
    } catch (e) {
      console.error('Failed to load assets:', e);
      Alert.alert('Error', 'Failed to load assets');
    }
  };

  useEffect(() => { load(); }, []);

  const getImageSource = (uri: any) => {
    if (typeof uri === 'number') return uri;
    if (!uri) return undefined;
    if (typeof uri === 'string') {
      let normalized = uri.replace(/\\/g, '/');
      if (normalized.includes('bankLogos/images') && !normalized.includes('/assets')) {
        normalized = '/assets/' + normalized.replace(/^\/+/, '');
      }

      if (Platform.OS === 'web' && normalized.startsWith('/')) {
        try {
          return { uri: (typeof window !== 'undefined' ? window.location.origin : '') + normalized };
        } catch (e) {
          return { uri: normalized };
        }
      }

      return { uri: normalized };
    }

    if (typeof uri === 'object' && uri.src) {
      if (typeof uri.src === 'number') return uri.src;
      if (typeof uri.src === 'string') {
        const s = uri.src.replace(/\\/g, '/');
        return { uri: s.startsWith('/') && Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.location.origin + s : s) : s };
      }
    }

    if (typeof uri === 'object' && uri.url) {
      const u = (typeof uri.url === 'string') ? uri.url.replace(/\\/g, '/') : uri.url;
      return { uri: u };
    }
    return undefined;
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const uri = reader.result as string;
      if (!name.trim()) {
        Alert.alert('Error', 'Please provide a name for the asset');
        return;
      }
      try {
        await LocalAssetService.addAsset(name.trim(), uri);
        setName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        await load();
        Alert.alert('Success', 'Asset added successfully');
        setActiveTab('my-assets');
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'Failed to save asset');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = async (key: string, type: AssetType) => {
    const message = type === 'user' ? `Remove "${key}" from your assets?` : `Reset "${key}" to original?`;

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(message);
      if (!confirmed) return;
      try {
        if (type === 'user') {
          await LocalAssetService.removeAsset(key);
        } else {
          const editedBundled = { ...bundled };
          delete editedBundled[key];
          await AsyncStorage.setItem('editedBundledLogos', JSON.stringify(editedBundled));
          setBundled(editedBundled);
        }
        await load();
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'Failed to remove asset');
      }
      return;
    }

    Alert.alert('Confirm', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: type === 'user' ? 'Remove' : 'Reset',
        style: 'destructive',
        onPress: async () => {
          if (type === 'user') {
            await LocalAssetService.removeAsset(key);
          } else {
            const editedBundled = { ...bundled };
            delete editedBundled[key];
            await AsyncStorage.setItem('editedBundledLogos', JSON.stringify(editedBundled));
            setBundled(editedBundled);
          }
          await load();
        }
      }
    ]);
  };

  const handleSaveBundledEdit = async () => {
    const newName = editingBundledName.trim();
    const newUrl = editingBundledUrl.trim();
    
    if (!newName) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    if (!newUrl) {
      Alert.alert('Error', 'URL is required');
      return;
    }

    try {
      const editedBundled = { ...bundled };
      if (editingBundledKey && editingBundledKey !== newName) {
        delete editedBundled[editingBundledKey];
      }
      editedBundled[newName] = newUrl;

      await AsyncStorage.setItem('editedBundledLogos', JSON.stringify(editedBundled));
      setBundled(editedBundled);
      setEditingBundledKey(null);
      setEditingBundledName('');
      setEditingBundledUrl('');
      Alert.alert('Success', 'Bundled logo updated');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to save changes');
    }
  };

  const handleSaveUserEdit = async () => {
    const newName = editingNewName.trim();
    const newUrl = editingNewUrl.trim();
    
    if (!newName) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    if (!newUrl) {
      Alert.alert('Error', 'URL is required');
      return;
    }

    if (newName !== editingKey && userAssets[newName]) {
      Alert.alert('Overwrite?', `"${newName}" already exists. Overwrite?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Overwrite',
          style: 'destructive',
          onPress: async () => {
            await LocalAssetService.updateAsset(editingKey!, newName, newUrl);
            await load();
            setEditingKey(null);
            setEditingNewName('');
            setEditingNewUrl('');
          }
        }
      ]);
      return;
    }

    await LocalAssetService.updateAsset(editingKey!, newName, newUrl);
    await load();
    setEditingKey(null);
    setEditingNewName('');
    setEditingNewUrl('');
  };

  const handleAddBundledToMyAssets = async (name: string, uri: any) => {
    try {
      const rawUrl = typeof uri === 'object' ? (uri.src || uri.url || name) : uri;
      const assetUrl = (typeof rawUrl === 'string' && rawUrl.includes('bankLogos/images') && !rawUrl.includes('/assets'))
        ? '/assets/' + rawUrl.replace(/^\/+/, '')
        : rawUrl;
      
      // Check if already exists in user assets
      if (userAssets[name]) {
        Alert.alert('Already Exists', `"${name}" is already in your custom assets.`);
        return;
      }
      
      await LocalAssetService.addAsset(name, assetUrl);
      await load();
      Alert.alert('Success', `"${name}" added to your assets!`);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to add asset');
    }
  };

  const renderAssetCard = (name: string, uri: any, type: AssetType, isEditing: boolean) => {
    const imageSource = getImageSource(uri);
    const isInMyAssets = userAssets[name] !== undefined;
    
    return (
      <View key={name} className="mb-4">
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
          <View className="flex-row items-center">
            {/* Logo Preview */}
            <View className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 mr-4 justify-center items-center border-2 border-slate-200 dark:border-slate-600">
              <Image
                source={imageSource}
                style={{ width: 56, height: 56 }}
                resizeMode="contain"
              />
            </View>

            {/* Content */}
            <View className="flex-1">
              {isEditing ? (
                <View>
                  <TextInput
                    value={type === 'user' ? editingNewName : editingBundledName}
                    onChangeText={type === 'user' ? setEditingNewName : setEditingBundledName}
                    placeholder="Asset name"
                    placeholderTextColor="#94a3b8"
                    className="bg-slate-50 dark:bg-slate-700 px-3 py-2 rounded-xl mb-2 text-slate-900 dark:text-white font-semibold border-2 border-indigo-300 dark:border-indigo-600"
                  />
                  <TextInput
                    value={type === 'user' ? editingNewUrl : editingBundledUrl}
                    onChangeText={type === 'user' ? setEditingNewUrl : setEditingBundledUrl}
                    placeholder="Image URL"
                    placeholderTextColor="#94a3b8"
                    className="bg-slate-50 dark:bg-slate-700 px-3 py-2 rounded-xl text-slate-900 dark:text-white text-sm border-2 border-indigo-300 dark:border-indigo-600"
                    multiline
                  />
                </View>
              ) : (
                <View>
                  <Text className="font-bold text-lg text-slate-900 dark:text-white mb-1">{name}</Text>
                  {type === 'bundled' && (
                    <Text className="text-slate-500 dark:text-slate-400 text-xs" numberOfLines={1}>
                      {typeof uri === 'string' ? uri : (uri && typeof uri === 'object' && uri.url ? uri.url : 'Static image')}
                    </Text>
                  )}
                  <View className="flex-row items-center mt-1">
                    <View className={`px-2 py-1 rounded-md ${type === 'user' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'}`}>
                      <Text className={`text-xs font-bold ${type === 'user' ? 'text-emerald-700 dark:text-emerald-400' : 'text-indigo-700 dark:text-indigo-400'}`}>
                        {type === 'user' ? 'Custom' : 'Bundled'}
                      </Text>
                    </View>
                    {type === 'bundled' && isInMyAssets && (
                      <View className="px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-900/30 ml-2">
                        <Text className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          ✓ In My Assets
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Action Buttons */}
          <View className="flex-row mt-4 space-x-2">
            {isEditing ? (
              <>
                <TouchableOpacity
                  onPress={type === 'user' ? handleSaveUserEdit : handleSaveBundledEdit}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 rounded-xl mr-2 shadow-md"
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name="check" size={16} color="#fff" />
                    <Text className="text-white font-bold ml-2">Save</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    if (type === 'user') {
                      setEditingKey(null);
                      setEditingNewName('');
                      setEditingNewUrl('');
                    } else {
                      setEditingBundledKey(null);
                      setEditingBundledName('');
                      setEditingBundledUrl('');
                    }
                  }}
                  className="flex-1 bg-slate-400 dark:bg-slate-600 py-3 rounded-xl shadow-md"
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name="times" size={16} color="#fff" />
                    <Text className="text-white font-bold ml-2">Cancel</Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {type === 'bundled' && !isInMyAssets && (
                  <TouchableOpacity
                    onPress={() => handleAddBundledToMyAssets(name, uri)}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 py-3 rounded-xl mr-2 shadow-md"
                    style={{ elevation: 2 }}
                  >
                    <View className="flex-row items-center justify-center">
                      <FontAwesome name="plus" size={16} color="#fff" />
                      <Text className="text-white font-bold ml-2 text-sm">Add to My Assets</Text>
                    </View>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => {
                    if (type === 'user') {
                      setEditingKey(name);
                      setEditingNewName(name);
                      setEditingNewUrl(uri);
                    } else {
                      setEditingBundledKey(name);
                      setEditingBundledName(name);
                      setEditingBundledUrl(typeof uri === 'object' ? (uri.url || '') : uri);
                    }
                  }}
                  className={`${type === 'bundled' && !isInMyAssets ? 'flex-none px-4' : 'flex-1'} bg-blue-500 dark:bg-blue-600 py-3 rounded-xl mr-2 shadow-md`}
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name="edit" size={16} color="#fff" />
                    {(type === 'user' || isInMyAssets) && <Text className="text-white font-bold ml-2">Edit</Text>}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRemove(name, type)}
                  className={`${type === 'bundled' && !isInMyAssets ? 'flex-none px-4' : 'flex-1'} bg-red-500 dark:bg-red-600 py-3 rounded-xl shadow-md`}
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name={type === 'user' ? 'trash' : 'refresh'} size={16} color="#fff" />
                    {(type === 'user' || isInMyAssets) && <Text className="text-white font-bold ml-2">{type === 'user' ? 'Remove' : 'Reset'}</Text>}
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  const filteredUserAssets = Object.entries(userAssets).filter(([name]) =>
    name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBundledAssets = Object.entries(bundled).filter(([name]) =>
    name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900">
      <StatusBar style="auto" />

      {/* Header with Gradient */}
      <LinearGradient
        colors={['#6366f1', '#8b5cf6', '#a855f7']}
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
            <Text className="text-white text-2xl font-bold">Asset Manager</Text>
            <Text className="text-white/80 text-sm mt-1">Manage your bank logos</Text>
          </View>
          <View className="w-12 h-12" />
        </View>

        {/* Stats Cards */}
        <View className="flex-row space-x-3">
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4" style={{ elevation: 2 }}>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-white/80 text-xs font-semibold">Custom</Text>
                <Text className="text-white text-2xl font-bold mt-1">{Object.keys(userAssets).length}</Text>
              </View>
              <View className="w-10 h-10 bg-emerald-500/30 rounded-xl justify-center items-center">
                <FontAwesome name="star" size={18} color="#fff" />
              </View>
            </View>
          </View>
          <View className="flex-1 bg-white/20 backdrop-blur-lg rounded-2xl p-4" style={{ elevation: 2 }}>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-white/80 text-xs font-semibold">Bundled</Text>
                <Text className="text-white text-2xl font-bold mt-1">{Object.keys(bundled).length}</Text>
              </View>
              <View className="w-10 h-10 bg-blue-500/30 rounded-xl justify-center items-center">
                <FontAwesome name="database" size={18} color="#fff" />
              </View>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* Tab Navigation */}
      <View className="px-6 -mt-4 mb-4">
        <View className="bg-white dark:bg-slate-800 rounded-2xl p-2 flex-row shadow-lg" style={{ elevation: 4 }}>
          <TouchableOpacity
            onPress={() => setActiveTab('my-assets')}
            className={`flex-1 py-3 rounded-xl ${activeTab === 'my-assets' ? 'bg-gradient-to-r from-indigo-500 to-purple-500' : ''}`}
          >
            <Text className={`text-center font-bold ${activeTab === 'my-assets' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              My Assets
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('bundled')}
            className={`flex-1 py-3 rounded-xl ${activeTab === 'bundled' ? 'bg-gradient-to-r from-indigo-500 to-purple-500' : ''}`}
          >
            <Text className={`text-center font-bold ${activeTab === 'bundled' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              Bundled
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('add-new')}
            className={`flex-1 py-3 rounded-xl ${activeTab === 'add-new' ? 'bg-gradient-to-r from-indigo-500 to-purple-500' : ''}`}
          >
            <Text className={`text-center font-bold ${activeTab === 'add-new' ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
              Add New
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      {(activeTab === 'my-assets' || activeTab === 'bundled') && (
        <View className="px-6 mb-4">
          <View className="bg-white dark:bg-slate-800 rounded-2xl flex-row items-center px-4 py-3 shadow-md border border-slate-200 dark:border-slate-700" style={{ elevation: 2 }}>
            <FontAwesome name="search" size={18} color="#94a3b8" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search assets..."
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
      )}

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {/* My Assets Tab */}
          {activeTab === 'my-assets' && (
            <View className="pb-6">
              {filteredUserAssets.length === 0 ? (
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-12 items-center shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
                  <View className="w-24 h-24 bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-full justify-center items-center mb-6">
                    <FontAwesome name="folder-open" size={40} color="#8b5cf6" />
                  </View>
                  <Text className="text-slate-900 dark:text-white font-bold text-xl mb-2">No Custom Assets</Text>
                  <Text className="text-slate-500 dark:text-slate-400 text-center mb-6">
                    {searchQuery ? 'No assets match your search' : 'Add your first custom asset to get started'}
                  </Text>
                  {!searchQuery && (
                    <TouchableOpacity
                      onPress={() => setActiveTab('add-new')}
                      className="bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-3 rounded-xl shadow-md"
                      style={{ elevation: 2 }}
                    >
                      <View className="flex-row items-center">
                        <FontAwesome name="plus" size={16} color="#fff" />
                        <Text className="text-white font-bold ml-2">Add Asset</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                filteredUserAssets
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, uri]) => renderAssetCard(name, uri, 'user', editingKey === name))
              )}
            </View>
          )}

          {/* Bundled Assets Tab */}
          {activeTab === 'bundled' && (
            <View className="pb-6">
              {filteredBundledAssets.length === 0 ? (
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-12 items-center shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 3 }}>
                  <View className="w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-full justify-center items-center mb-6">
                    <FontAwesome name="search" size={40} color="#6366f1" />
                  </View>
                  <Text className="text-slate-900 dark:text-white font-bold text-xl mb-2">No Results</Text>
                  <Text className="text-slate-500 dark:text-slate-400 text-center">
                    No bundled assets match your search
                  </Text>
                </View>
              ) : (
                filteredBundledAssets
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, uri]) => renderAssetCard(name, uri, 'bundled', editingBundledKey === name))
              )}
            </View>
          )}

          {/* Add New Tab */}
          {activeTab === 'add-new' && (
            <View className="pb-6">
              {/* Upload from Device */}
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
                <View className="flex-row items-center mb-4">
                  <View className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30 rounded-2xl justify-center items-center mr-4">
                    <FontAwesome name="upload" size={20} color="#10b981" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-lg">Upload Image</Text>
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">From your device</Text>
                  </View>
                </View>

                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Asset name (e.g., My Bank)"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 dark:bg-slate-700 px-4 py-4 rounded-xl mb-4 text-slate-900 dark:text-white font-semibold border-2 border-slate-200 dark:border-slate-600"
                />

                {Platform.OS === 'web' ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFilePicked}
                      style={{ display: 'none' }}
                    />
                    <TouchableOpacity
                      onPress={() => fileInputRef.current?.click()}
                      className="bg-gradient-to-r from-emerald-500 to-teal-500 py-4 rounded-xl shadow-md"
                      style={{ elevation: 2 }}
                    >
                      <View className="flex-row items-center justify-center">
                        <FontAwesome name="image" size={18} color="#fff" />
                        <Text className="text-white font-bold text-center ml-2">Choose Image</Text>
                      </View>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        const ImagePicker = await import('expo-image-picker');
                        const res = await ImagePicker.launchImageLibraryAsync({
                          mediaTypes: ImagePicker.MediaTypeOptions.Images,
                          quality: 0.9,
                          base64: true
                        });
                        if (!res.canceled && res.assets?.length) {
                          const asset = res.assets[0];
                          const uri = asset.base64
                            ? `data:${asset.type || 'image/png'};base64,${asset.base64}`
                            : asset.uri;
                          if (!name.trim()) {
                            Alert.alert('Error', 'Please provide a name');
                            return;
                          }
                          await LocalAssetService.addAsset(name.trim(), uri);
                          setName('');
                          await load();
                          Alert.alert('Success', 'Asset added');
                          setActiveTab('my-assets');
                        }
                      } catch (e) {
                        console.error(e);
                        Alert.alert('Error', 'Failed to pick image');
                      }
                    }}
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 py-4 rounded-xl shadow-md"
                    style={{ elevation: 2 }}
                  >
                    <View className="flex-row items-center justify-center">
                      <FontAwesome name="image" size={18} color="#fff" />
                      <Text className="text-white font-bold text-center ml-2">Pick from Gallery</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>

              {/* Import from URL */}
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
                <View className="flex-row items-center mb-4">
                  <View className="w-12 h-12 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-2xl justify-center items-center mr-4">
                    <FontAwesome name="link" size={20} color="#3b82f6" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-lg">Import from URL</Text>
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Use an external image</Text>
                  </View>
                </View>

                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Asset name (e.g., My Bank)"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 dark:bg-slate-700 px-4 py-4 rounded-xl mb-4 text-slate-900 dark:text-white font-semibold border-2 border-slate-200 dark:border-slate-600"
                />

                <TextInput
                  value={urlImport}
                  onChangeText={setUrlImport}
                  placeholder="https://example.com/logo.png"
                  placeholderTextColor="#94a3b8"
                  className="bg-slate-50 dark:bg-slate-700 px-4 py-4 rounded-xl mb-4 text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-600"
                />

                <TouchableOpacity
                  onPress={async () => {
                    if (!name.trim() || !urlImport.trim()) {
                      Alert.alert('Error', 'Please provide name and URL');
                      return;
                    }
                    try {
                      await LocalAssetService.addAssetFromUrl(name.trim(), urlImport.trim());
                      setName('');
                      setUrlImport('');
                      await load();
                      Alert.alert('Success', 'Asset imported');
                      setActiveTab('my-assets');
                    } catch (e) {
                      console.error(e);
                      Alert.alert('Error', 'Failed to import');
                    }
                  }}
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 py-4 rounded-xl shadow-md"
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name="download" size={18} color="#fff" />
                    <Text className="text-white font-bold text-center ml-2">Import Asset</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Select from Bundled */}
              <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
                <View className="flex-row items-center mb-4">
                  <View className="w-12 h-12 bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-2xl justify-center items-center mr-4">
                    <FontAwesome name="database" size={20} color="#a855f7" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-lg">Select from Bundled</Text>
                    <Text className="text-slate-500 dark:text-slate-400 text-sm">Choose a pre-loaded logo</Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => setShowBundledSelection(true)}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 py-4 rounded-xl shadow-md"
                  style={{ elevation: 2 }}
                >
                  <View className="flex-row items-center justify-center">
                    <FontAwesome name="th-large" size={18} color="#fff" />
                    <Text className="text-white font-bold text-center ml-2">Browse Bundled Assets</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* Bundled Selection Modal */}
      <Modal
        visible={showBundledSelection}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowBundledSelection(false);
          setIsSelectingForEdit(false);
          setShowServerList(false);
          setServerUrlInput('');
        }}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-[32px] max-h-[80%]" style={{ elevation: 8 }}>
            {/* Modal Header */}
            <View className="p-6 border-b border-slate-200 dark:border-slate-700">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-slate-900 dark:text-white font-bold text-xl">
                  {isSelectingForEdit ? 'Select Logo to Edit' : 'Select Bundled Logo'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowBundledSelection(false);
                    setIsSelectingForEdit(false);
                    setShowServerList(false);
                    setServerUrlInput('');
                  }}
                  className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl justify-center items-center"
                >
                  <FontAwesome name="times" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>

              {isSelectingForEdit && (
                <View className="flex-row mb-4">
                  <TouchableOpacity
                    onPress={() => { setShowServerList(true); setServerUrlInput(''); }}
                    className={`flex-1 p-3 mr-2 rounded-xl ${showServerList ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                  >
                    <Text className={`text-center font-bold ${showServerList ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                      Select From Server
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setShowServerList(false); setServerUrlInput(''); }}
                    className={`flex-1 p-3 rounded-xl ${!showServerList ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                  >
                    <Text className={`text-center font-bold ${!showServerList ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                      Enter URL
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {isSelectingForEdit && !showServerList && (
                <View className="mb-4">
                  <TextInput
                    value={serverUrlInput}
                    onChangeText={setServerUrlInput}
                    placeholder="Enter image URL (https://...) or project path (/assets/...)"
                    placeholderTextColor="#94a3b8"
                    className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl mb-2 text-slate-900 dark:text-white border-2 border-slate-200 dark:border-slate-700"
                  />
                  <View className="flex-row">
                    <TouchableOpacity
                      onPress={async () => {
                        if (!serverUrlInput.trim()) {
                          Alert.alert('Error', 'Please enter a URL');
                          return;
                        }
                        setEditingBundledUrl(serverUrlInput.trim());
                        setShowBundledSelection(false);
                        setIsSelectingForEdit(false);
                      }}
                      className="flex-1 bg-emerald-500 p-3 rounded-xl mr-2"
                    >
                      <Text className="text-white font-bold text-center">Use URL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setServerUrlInput(''); }}
                      className="bg-slate-400 p-3 rounded-xl px-6"
                    >
                      <Text className="text-white font-bold text-center">Clear</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* Modal Content */}
            <ScrollView className="px-6 py-4">
              {Object.entries(bundled).map(([n, uri]) => (
                <TouchableOpacity
                  key={n}
                  onPress={async () => {
                    if (isSelectingForEdit) {
                      const chosen = typeof uri === 'object' ? (uri.src || uri.url || '') : uri;
                      const normalized = (showServerList && typeof chosen === 'string' && chosen.includes('bankLogos/images') && !chosen.includes('/assets'))
                        ? '/assets/' + chosen.replace(/^\/+/, '')
                        : chosen;
                      setEditingBundledName(n);
                      setEditingBundledUrl(normalized);
                      setShowBundledSelection(false);
                      setIsSelectingForEdit(false);
                    } else {
                      const rawUrl = typeof uri === 'object' ? (uri.src || uri.url || n) : uri;
                      const assetUrl = (typeof rawUrl === 'string' && rawUrl.includes('bankLogos/images') && !rawUrl.includes('/assets'))
                        ? '/assets/' + rawUrl.replace(/^\/+/, '')
                        : rawUrl;
                      await LocalAssetService.addAsset(n, assetUrl);
                      setShowBundledSelection(false);
                      await load();
                      Alert.alert('Success', 'Asset added');
                      setActiveTab('my-assets');
                    }
                  }}
                  className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl mb-3 border border-slate-200 dark:border-slate-700"
                >
                  <View className="w-12 h-12 bg-white dark:bg-slate-700 rounded-xl overflow-hidden mr-4 justify-center items-center">
                    <Image
                      source={getImageSource(uri)}
                      style={{ width: 40, height: 40 }}
                      resizeMode="contain"
                    />
                  </View>
                  <Text className="flex-1 font-semibold text-slate-900 dark:text-white">{n}</Text>
                  <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
