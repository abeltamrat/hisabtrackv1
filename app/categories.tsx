
import { FontAwesome } from '@expo/vector-icons';
import CategoryIcon from '@/components/CategoryIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, useColorScheme, View } from 'react-native';

import { Category, useTransactions } from '../context/TransactionContext';

type IconGroup = {
  id: string;
  title: string;
  items: string[];
};

const iconGroups: IconGroup[] = [
  {
    id: 'finance',
    title: 'Finance and Work',
    items: [
      'money', 'credit-card', 'bank', 'calculator', 'briefcase',
      'pie-chart', 'bar-chart', 'line-chart', 'area-chart',
      'usd', 'eur', 'gbp', 'jpy', 'bitcoin', 'ticket',
    ],
  },
  {
    id: 'shopping',
    title: 'Shopping and Food',
    items: [
      'shopping-cart', 'shopping-bag', 'shopping-basket', 'cart-plus',
      'cutlery', 'coffee', 'glass', 'beer', 'birthday-cake',
      'gift', 'tag', 'tags',
    ],
  },
  {
    id: 'transport',
    title: 'Transport and Travel',
    items: [
      'bus', 'taxi', 'car', 'motorcycle', 'bicycle',
      'train', 'subway', 'truck', 'road', 'plane', 'ship',
      'rocket', 'map-marker',
    ],
  },
  {
    id: 'home',
    title: 'Home and Lifestyle',
    items: [
      'home', 'building-o', 'university', 'industry',
      'key', 'lock', 'shield', 'leaf', 'tree', 'paw',
      'sun-o', 'moon-o', 'fire', 'bolt',
    ],
  },
  {
    id: 'tech',
    title: 'Tech and Media',
    items: [
      'phone', 'mobile', 'laptop', 'desktop', 'tablet',
      'wifi', 'globe', 'envelope', 'camera', 'film',
      'video-camera', 'music', 'headphones', 'gamepad', 'book', 'graduation-cap',
    ],
  },
  {
    id: 'people',
    title: 'People and Health',
    items: [
      'heart', 'heartbeat', 'medkit', 'stethoscope', 'hospital-o',
      'user-md', 'users', 'user', 'child', 'male', 'female',
      'folder', 'bookmark', 'flag', 'star', 'trophy',
    ],
  },
  {
    id: 'emoji-money',
    title: 'Emoji Money',
    items: [
      'emoji:💰', 'emoji:💸', 'emoji:💳', 'emoji:🏦', 'emoji:🧾', 'emoji:📈',
      'emoji:📉', 'emoji:📊', 'emoji:🪙', 'emoji:💵', 'emoji:💶', 'emoji:💷',
      'emoji:💴',
    ],
  },
  {
    id: 'emoji-life',
    title: 'Emoji Lifestyle',
    items: [
      'emoji:🍔', 'emoji:🍕', 'emoji:☕', 'emoji:🛒', 'emoji:🛍️', 'emoji:🚗',
      'emoji:⛽', 'emoji:🏠', 'emoji:📱', 'emoji:💻', 'emoji:🎓', 'emoji:🏥',
      'emoji:🎮', 'emoji:🎵', 'emoji:🎁', 'emoji:✈️', 'emoji:🚌', 'emoji:🚕',
      'emoji:🚆',
    ],
  },
];

export default function ManageCategoriesScreen() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { categories, addCategory, updateCategory, deleteCategory } = useTransactions();

  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [openIconGroup, setOpenIconGroup] = useState<string>('finance');
  const [formData, setFormData] = useState<Partial<Category>>({ name: '', icon: 'folder', color: '#6366f1', type: 'expense', parentId: undefined });

  const availableColors = [
    '#ef4444', '#f59e0b', '#eab308', '#10b981', '#14b8a6', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e'
  ];

  const filteredCategories = categories.filter(c => filter === 'all' || c.type === filter);

  // Organize into hierarchy
  const rootCategories = filteredCategories.filter(c => !c.parentId);
  const getChildCategories = (parentId: string) => filteredCategories.filter(c => c.parentId === parentId);

  const handleAddCategory = async () => {
    const trimmedName = (formData.name ?? '').trim();
    if (!trimmedName) {
      Alert.alert('Validation', 'Please enter a category name.');
      return;
    }
    try {
      await addCategory({
        name: trimmedName,
        icon: formData.icon!,
        color: formData.color!,
        type: formData.type!,
        parentId: formData.parentId,
      });
      setShowAddModal(false);
      setFormData({ name: '', icon: 'folder', color: '#6366f1', type: 'expense', parentId: undefined });
    } catch (error) {
      console.error('Error adding category:', error);
      Alert.alert('Error', 'Failed to save category. Please try again.');
    }
  };

  const handleEditCategory = async () => {
    if (!editingCategory) return;
    const trimmedName = (formData.name ?? '').trim();
    if (!trimmedName) {
      Alert.alert('Validation', 'Please enter a category name.');
      return;
    }
    try {
      await updateCategory(editingCategory.id, {
        name: trimmedName,
        icon: formData.icon!,
        color: formData.color!,
        type: formData.type!,
        parentId: formData.parentId,
      });
      setEditingCategory(null);
      setFormData({ name: '', icon: 'folder', color: '#6366f1', type: 'expense', parentId: undefined });
    } catch (error) {
      console.error('Error updating category:', error);
      Alert.alert('Error', 'Failed to update category. Please try again.');
    }
  };

  const handleDeleteCategory = (id: string) => {
    const hasChildren = categories.some(c => c.parentId === id);
    const msg = hasChildren
      ? 'This will also delete all sub-categories. Are you sure?'
      : 'Are you sure you want to delete this category?';
    Alert.alert('Delete Category', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(id);
          } catch (error) {
            console.error('Error deleting category:', error);
            Alert.alert('Error', 'Failed to delete category. Please try again.');
          }
        },
      },
    ]);
  };

  const openEditModal = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      icon: category.icon,
      color: category.color,
      type: category.type,
      parentId: category.parentId
    });
  };

  const renderCategoryItem = (category: Category, level = 0) => (
    <View key={category.id}>
      <View
        className="flex-row items-center bg-white dark:bg-slate-800 p-4 rounded-2xl mb-2 shadow-sm border border-slate-100 dark:border-slate-700"
        style={{ marginLeft: level * 20, marginTop: level > 0 ? -4 : 0 }}
      >
        {level > 0 && <View className="absolute left-[-20px] top-[50%] w-[20px] h-[1px] bg-slate-300 dark:bg-slate-600" />}
        <View
          className="w-14 h-14 rounded-2xl justify-center items-center mr-4"
          style={{ backgroundColor: category.color + '20' }}
        >
          <CategoryIcon icon={category.icon} size={24} color={category.color} />
        </View>
        <View className="flex-1">
          <Text className="text-slate-900 dark:text-white font-bold text-base mb-1">
            {category.name}
          </Text>
          <View className="flex-row items-center">
            <View className={`px-2 py-1 rounded-full ${category.type === 'income' ? 'bg-green-100' : 'bg-red-100'
              }`}>
              <Text className={`text-xs font-semibold ${category.type === 'income' ? 'text-green-700' : 'text-red-700'
                }`}>
                {category.type}
              </Text>
            </View>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => openEditModal(category)}
          className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl justify-center items-center mr-2"
        >
          <FontAwesome name="edit" size={16} color="#3b82f6" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDeleteCategory(category.id)}
          className="w-10 h-10 bg-red-50 dark:bg-red-900/30 rounded-xl justify-center items-center"
        >
          <FontAwesome name="trash" size={16} color="#ef4444" />
        </TouchableOpacity>
      </View>
      {getChildCategories(category.id).map(child => renderCategoryItem(child, level + 1))}
    </View>
  );

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'dark' ? ['#334155', '#1e293b'] : ['#9333ea', '#7e22ce']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Manage Categories</Text>
          <TouchableOpacity
            onPress={() => {
              setFormData({ name: '', icon: 'folder', color: '#6366f1', type: 'expense', parentId: undefined });
              setShowAddModal(true);
            }}
            className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
          >
            <FontAwesome name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View className="flex-row justify-between mt-4">
          <View className="flex-1 bg-white/10 dark:bg-white/5 backdrop-blur-lg rounded-2xl p-3 mr-2">
            <Text className="text-purple-100 text-xs">Total</Text>
            <Text className="text-white text-2xl font-bold">{categories.length}</Text>
          </View>
          <View className="flex-1 bg-white/10 dark:bg-white/5 backdrop-blur-lg rounded-2xl p-3 mx-1">
            <Text className="text-purple-100 text-xs">Income</Text>
            <Text className="text-white text-2xl font-bold">
              {categories.filter(c => c.type === 'income').length}
            </Text>
          </View>
          <View className="flex-1 bg-white/10 dark:bg-white/5 backdrop-blur-lg rounded-2xl p-3 ml-2">
            <Text className="text-purple-100 text-xs">Expense</Text>
            <Text className="text-white text-2xl font-bold">
              {categories.filter(c => c.type === 'expense').length}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Filter Tabs */}
      <View className="px-6 py-4">
        <View className="flex-row bg-white dark:bg-slate-800 p-1.5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
          {(['all', 'income', 'expense'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`flex-1 py-3 rounded-xl items-center ${filter === f ? 'bg-purple-500' : ''
                }`}
            >
              <Text className={`text-sm font-bold capitalize ${filter === f ? 'text-white' : 'text-slate-500'
                }`}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Categories List */}
      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        {rootCategories.length === 0 ? (
          <View className="items-center justify-center mt-20">
            <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
              <FontAwesome name="folder-open" size={32} color="#cbd5e1" />
            </View>
            <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">No Categories</Text>
            <Text className="text-slate-400 text-sm">Add a category to get started</Text>
          </View>
        ) : (
          rootCategories.map(category => renderCategoryItem(category))
        )}
        <View className="h-8" />
      </ScrollView>

      <Modal
        visible={showAddModal || editingCategory !== null}
        transparent
        animationType="none"
        onRequestClose={() => {
          setShowAddModal(false);
          setEditingCategory(null);
        }}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white dark:bg-slate-900 rounded-t-3xl p-6" style={{ maxHeight: '90%' }}>
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-slate-900 dark:text-white text-xl font-bold">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </Text>
              <TouchableOpacity onPress={() => {
                setShowAddModal(false);
                setEditingCategory(null);
              }}>
                <FontAwesome name="times" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Category Name */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Category Name</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-6">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter category name"
                  placeholderTextColor="#94a3b8"
                  value={formData.name}
                  onChangeText={(text) => setFormData({ ...formData, name: text })}
                />
              </View>

              {/* Type Selection */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Type</Text>
              <View className="flex-row bg-slate-50 dark:bg-slate-800 p-1.5 rounded-2xl mb-6">
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, type: 'expense', parentId: undefined })}
                  className={`flex-1 py-3 rounded-xl items-center ${formData.type === 'expense' ? 'bg-red-500' : ''}`}
                >
                  <Text className={`text-sm font-bold ${formData.type === 'expense' ? 'text-white' : 'text-slate-500'}`}>
                    Expense
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, type: 'income', parentId: undefined })}
                  className={`flex-1 py-3 rounded-xl items-center ${formData.type === 'income' ? 'bg-green-500' : ''}`}
                >
                  <Text className={`text-sm font-bold ${formData.type === 'income' ? 'text-white' : 'text-slate-500'}`}>
                    Income
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Parent Category Selection */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Parent Category (Optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-6">
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, parentId: undefined })}
                  className={`mr-2 px-4 py-2 rounded-xl flex-row items-center border ${!formData.parentId ? 'bg-primary-50 borderColor-primary-500' : 'bg-slate-50 border-slate-200'
                    }`}
                >
                  <Text className={!formData.parentId ? 'text-primary-700 font-bold' : 'text-slate-600'}>None</Text>
                </TouchableOpacity>
                {categories
                  .filter(c => c.type === formData.type && c.id !== editingCategory?.id && !c.parentId) // Only matching types, not self, and only top-level can be parents for now (1 level deep)
                  .map(c => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setFormData({ ...formData, parentId: c.id })}
                      className={`mr-2 px-4 py-2 rounded-xl flex-row items-center border ${formData.parentId === c.id ? 'bg-primary-50 borderColor-primary-500' : 'bg-slate-50 border-slate-200'
                        }`}
                    >
                      <View style={{ marginRight: 6 }}>
                        <CategoryIcon icon={c.icon} size={14} color={c.color} />
                      </View>
                      <Text className={formData.parentId === c.id ? 'text-primary-700 font-bold' : 'text-slate-600'}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>

              {/* Icon Selection */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-3">Select Icon</Text>
              <View className="mb-6">
                {iconGroups.map((group) => {
                  const isOpen = openIconGroup === group.id;
                  return (
                    <View key={group.id} className="mb-3 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
                      <TouchableOpacity
                        onPress={() => setOpenIconGroup((prev) => (prev === group.id ? '' : group.id))}
                        className="flex-row items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800"
                      >
                        <Text className="text-slate-900 dark:text-white font-semibold">{group.title}</Text>
                        <FontAwesome
                          name={isOpen ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color="#64748b"
                        />
                      </TouchableOpacity>
                      {isOpen && (
                        <View className="flex-row flex-wrap p-3 bg-white dark:bg-slate-900">
                          {group.items.map((icon) => (
                            <TouchableOpacity
                              key={`${group.id}-${icon}`}
                              onPress={() => setFormData({ ...formData, icon })}
                              className={`w-14 h-14 justify-center items-center m-1 rounded-xl border ${formData.icon === icon
                                ? 'bg-primary-500 border-primary-500'
                                : 'bg-slate-100 dark:bg-slate-800 border-transparent'
                                }`}
                            >
                              <CategoryIcon
                                icon={icon}
                                size={20}
                                color={formData.icon === icon ? '#fff' : '#64748b'}
                              />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Color Selection */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-3">Select Color</Text>
              <View className="flex-row flex-wrap mb-6">
                {availableColors.map((color) => (
                  <TouchableOpacity
                    key={color}
                    onPress={() => setFormData({ ...formData, color })}
                    className="w-12 h-12 rounded-full m-2 justify-center items-center"
                    style={{ backgroundColor: color }}
                  >
                    {formData.color === color && (
                      <FontAwesome name="check" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Preview */}
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 mb-6">
                <Text className="text-slate-500 text-xs mb-3">Preview</Text>
                <View className="flex-row items-center">
                  <View
                    className="w-14 h-14 rounded-2xl justify-center items-center mr-4"
                    style={{ backgroundColor: formData.color + '20' }}
                  >
                    <CategoryIcon icon={formData.icon} size={24} color={formData.color} />
                  </View>
                  <View>
                    <Text className="text-slate-900 dark:text-white font-bold text-lg">
                      {formData.name || 'Category Name'}
                    </Text>
                    <Text className="text-slate-500 text-sm capitalize">{formData.type}</Text>
                  </View>
                </View>
              </View>

              {/* Action Buttons */}
              <TouchableOpacity
                onPress={editingCategory ? handleEditCategory : handleAddCategory}
                disabled={!formData.name}
                className={`bg-primary-500 h-14 rounded-2xl justify-center items-center ${!formData.name ? 'opacity-50' : ''
                  }`}
              >
                <Text className="text-white text-base font-bold">
                  {editingCategory ? 'Update Category' : 'Add Category'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
