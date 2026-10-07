import Storage from '@/services/SessionStorage';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import FormSheet from '@/components/FormSheet';


interface Goal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  icon: string;
  color: string;
  category: string;
}

export default function FinancialGoalsScreen() {
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { Storage.getItem('financial_goals').then(raw => { if (raw) setGoals(JSON.parse(raw)); setLoaded(true); }).catch(() => Alert.alert('Goals unavailable', 'Saved goals could not be loaded. Reopen this screen to retry.')); }, []);
  useEffect(() => { if (loaded) void Storage.setItem('financial_goals', JSON.stringify(goals)).catch(() => Alert.alert('Save failed', 'Goal changes could not be saved. Please retry.')); }, [goals, loaded]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    targetAmount: '',
    currentAmount: '',
    deadline: '',
    icon: 'star',
    color: '#6366f1',
    category: ''
  });

  const availableIcons = [
    'shield', 'plane', 'laptop', 'home', 'car', 'graduation-cap',
    'heart', 'briefcase', 'shopping-bag', 'gift', 'trophy', 'rocket'
  ];

  const availableColors = [
    '#ef4444', '#f59e0b', '#10b981', '#14b8a6', '#3b82f6',
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'
  ];

  const getProgress = (current: number, target: number) => {
    return target > 0 ? Math.max(0, Math.min((current / target) * 100, 100)) : 0;
  };

  const getDaysRemaining = (deadline: string) => {
    const today = new Date();
    const deadlineDate = new Date(deadline);
    const diffTime = deadlineDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const validForm = () => loaded && !!formData.title.trim() && Number.isFinite(Number(formData.targetAmount)) && Number(formData.targetAmount) > 0 && Number.isFinite(Number(formData.currentAmount || 0)) && Number(formData.currentAmount || 0) >= 0 && Number.isFinite(Date.parse(formData.deadline));
  const handleAddGoal = () => {
    if (!validForm()) { Alert.alert('Invalid goal', 'Enter a title, positive target, non-negative saved amount and valid deadline.'); return; }
    if (!formData.title.trim() || !Number.isFinite(Number(formData.targetAmount)) || Number(formData.targetAmount) <= 0 || !Number.isFinite(Date.parse(formData.deadline))) return;
    const newGoal: Goal = {
      id: Date.now().toString(),
      title: formData.title,
      targetAmount: parseFloat(formData.targetAmount),
      currentAmount: parseFloat(formData.currentAmount || '0'),
      deadline: formData.deadline,
      icon: formData.icon,
      color: formData.color,
      category: formData.category,
    };
    setGoals([...goals, newGoal]);
    resetForm();
  };

  const handleEditGoal = () => {
    if (!editingGoal || !validForm()) { Alert.alert('Invalid goal', 'Check the amounts, title and deadline.'); return; }
    setGoals(goals.map(g =>
      g.id === editingGoal.id
        ? {
          ...g,
          title: formData.title,
          targetAmount: parseFloat(formData.targetAmount),
          currentAmount: parseFloat(formData.currentAmount),
          deadline: formData.deadline,
          icon: formData.icon,
          color: formData.color,
          category: formData.category,
        }
        : g
    ));
    resetForm();
  };

  const handleDeleteGoal = (id: string) => {
    setGoals(goals.filter(g => g.id !== id));
  };

  const handleAddMoney = (id: string, amount: number) => {
    setGoals(goals.map(g =>
      g.id === id
        ? { ...g, currentAmount: Math.min(g.currentAmount + amount, g.targetAmount) }
        : g
    ));
  };

  const openEditModal = (goal: Goal) => {
    setEditingGoal(goal);
    setFormData({
      title: goal.title,
      targetAmount: goal.targetAmount.toString(),
      currentAmount: goal.currentAmount.toString(),
      deadline: goal.deadline,
      icon: goal.icon,
      color: goal.color,
      category: goal.category,
    });
  };

  const resetForm = () => {
    setShowAddModal(false);
    setEditingGoal(null);
    setFormData({
      title: '',
      targetAmount: '',
      currentAmount: '',
      deadline: '',
      icon: 'star',
      color: '#6366f1',
      category: ''
    });
  };



  const totalGoals = goals.length;
  const completedGoals = goals.filter(g => g.currentAmount >= g.targetAmount).length;
  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const totalSaved = goals.reduce((sum, g) => sum + g.currentAmount, 0);

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={['#eab308', '#ca8a04']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Financial Goals</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add"
            onPress={() => setShowAddModal(true)}
            className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
          >
            <FontAwesome name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View className="flex-row justify-between mt-4">
          <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 mr-2">
            <Text className="text-yellow-100 text-xs">Total Goals</Text>
            <Text className="text-white text-2xl font-bold">{totalGoals}</Text>
          </View>
          <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 mx-1">
            <Text className="text-yellow-100 text-xs">Completed</Text>
            <Text className="text-white text-2xl font-bold">{completedGoals}</Text>
          </View>
          <View className="flex-1 bg-white/10 backdrop-blur-lg rounded-2xl p-3 ml-2">
            <Text className="text-yellow-100 text-xs">Progress</Text>
            <Text className="text-white text-2xl font-bold">
              {totalTarget > 0 ? ((totalSaved / totalTarget) * 100).toFixed(0) : 0}%
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Goals List */}
      <ScrollView className="flex-1 px-6 pt-6" showsVerticalScrollIndicator={false}>
        {goals.length === 0 ? (
          <View className="items-center justify-center mt-20">
            <View className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full justify-center items-center mb-4">
              <FontAwesome name="star-o" size={32} color="#cbd5e1" />
            </View>
            <Text className="text-slate-900 dark:text-white font-bold text-lg mb-2">No Goals Yet</Text>
            <Text className="text-slate-500 text-sm text-center dark:text-slate-400">Set your first financial goal to start tracking</Text>
          </View>
        ) : (
          goals.map((goal) => {
            const progress = getProgress(goal.currentAmount, goal.targetAmount);
            const daysRemaining = getDaysRemaining(goal.deadline);
            const isCompleted = goal.currentAmount >= goal.targetAmount;

            return (
              <View
                key={goal.id}
                className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700"
                style={{ elevation: 4 }}
              >
                {/* Header */}
                <View className="flex-row items-center mb-4">
                  <View
                    className="w-16 h-16 rounded-2xl justify-center items-center mr-4"
                    style={{ backgroundColor: goal.color + '20' }}
                  >
                    <FontAwesome name={goal.icon as any} size={28} color={goal.color} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-900 dark:text-white font-bold text-lg mb-1">
                      {goal.title}
                    </Text>
                    <Text className="text-slate-500 text-sm">{goal.category}</Text>
                  </View>
                  <View className="flex-row">
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit"
                      onPress={() => openEditModal(goal)}
                      className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl justify-center items-center mr-2"
                    >
                      <FontAwesome name="edit" size={16} color="#3b82f6" />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete"
                      onPress={() => handleDeleteGoal(goal.id)}
                      className="w-10 h-10 bg-red-50 dark:bg-red-900/30 rounded-xl justify-center items-center"
                    >
                      <FontAwesome name="trash" size={16} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Progress */}
                <View className="mb-4">
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-slate-500 text-sm">Progress</Text>
                    <Text className="text-slate-900 dark:text-white font-bold text-sm">
                      {progress.toFixed(1)}%
                    </Text>
                  </View>
                  <View className="bg-slate-100 dark:bg-slate-900 h-3 rounded-full overflow-hidden">
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: goal.color,
                      }}
                    />
                  </View>
                </View>

                {/* Amounts */}
                <View className="flex-row justify-between mb-4">
                  <View>
                    <Text className="text-slate-500 text-xs mb-1">Saved</Text>
                    <Text className="text-slate-900 dark:text-white font-bold text-lg">
                      {formatCurrency(goal.currentAmount)}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-slate-500 text-xs mb-1">Target</Text>
                    <Text className="text-slate-900 dark:text-white font-bold text-lg">
                      {formatCurrency(goal.targetAmount)}
                    </Text>
                  </View>
                </View>

                {/* Footer */}
                <View className="flex-row justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-700">
                  <View className="flex-row items-center">
                    <FontAwesome name="calendar" size={14} color="#94a3b8" />
                    <Text className="text-slate-500 text-xs ml-2">
                      {daysRemaining > 0 ? `${daysRemaining} days left` : 'Deadline passed'}
                    </Text>
                  </View>
                  {!isCompleted && (
                    <View className="flex-row">
                      <TouchableOpacity
                        onPress={() => handleAddMoney(goal.id, 50)}
                        className="bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-xl mr-2"
                      >
                        <Text className="text-green-600 dark:text-green-400 text-xs font-bold">{formatCurrency(50)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleAddMoney(goal.id, 100)}
                        className="bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-xl"
                      >
                        <Text className="text-green-600 dark:text-green-400 text-xs font-bold">{formatCurrency(100)}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {isCompleted && (
                    <View className="bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-xl flex-row items-center">
                      <FontAwesome name="check-circle" size={14} color="#10b981" />
                      <Text className="text-green-600 dark:text-green-400 text-xs font-bold ml-2">Completed!</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
        <View className="h-8" />
      </ScrollView>

      <FormSheet
        visible={showAddModal || editingGoal !== null}
        onClose={resetForm}
        scrollable={false}
        accessibilityLabel={editingGoal ? 'Edit goal' : 'Add goal'}
      >
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-slate-900 dark:text-white text-xl font-bold">
                {editingGoal ? 'Edit Goal' : 'Add New Goal'}
              </Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={resetForm}>
                <FontAwesome name="times" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Goal Title */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Goal Title</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="e.g., Emergency Fund"
                  placeholderTextColor="#94a3b8"
                  value={formData.title}
                  onChangeText={(text) => setFormData({ ...formData, title: text })}
                />
              </View>

              {/* Category */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Category</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="e.g., Travel, Security, Tech"
                  placeholderTextColor="#94a3b8"
                  value={formData.category}
                  onChangeText={(text) => setFormData({ ...formData, category: text })}
                />
              </View>

              {/* Target Amount */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Target Amount</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter target amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={formData.targetAmount}
                  onChangeText={(text) => setFormData({ ...formData, targetAmount: text })}
                />
              </View>

              {/* Current Amount */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Current Amount</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="Enter current amount"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={formData.currentAmount}
                  onChangeText={(text) => setFormData({ ...formData, currentAmount: text })}
                />
              </View>

              {/* Deadline */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Deadline (YYYY-MM-DD)</Text>
              <View className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 mb-4">
                <TextInput
                  className="text-slate-900 dark:text-white text-base h-14"
                  placeholder="2024-12-31"
                  placeholderTextColor="#94a3b8"
                  value={formData.deadline}
                  onChangeText={(text) => setFormData({ ...formData, deadline: text })}
                />
              </View>

              {/* Icon Selection */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-3">Select Icon</Text>
              <View className="flex-row flex-wrap mb-4">
                {availableIcons.map((icon) => (
                  <TouchableOpacity
                    key={icon}
                    accessibilityRole="radio"
                    accessibilityLabel={`${icon} icon`}
                    accessibilityState={{ selected: formData.icon === icon }}
                    onPress={() => setFormData({ ...formData, icon })}
                    className={`w-14 h-14 justify-center items-center m-1 rounded-xl ${formData.icon === icon ? 'bg-primary-500' : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                  >
                    <FontAwesome
                      name={icon as any}
                      size={20}
                      color={formData.icon === icon ? '#fff' : '#64748b'}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Color Selection */}
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-3">Select Color</Text>
              <View className="flex-row flex-wrap mb-6">
                {availableColors.map((color) => (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm"
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

              {/* Submit Button */}
              <TouchableOpacity
                onPress={editingGoal ? handleEditGoal : handleAddGoal}
                disabled={!formData.title || !formData.targetAmount}
                className={`bg-primary-500 h-14 rounded-2xl justify-center items-center ${(!formData.title || !formData.targetAmount) ? 'opacity-50' : ''
                  }`}
              >
                <Text className="text-white text-base font-bold">
                  {editingGoal ? 'Update Goal' : 'Add Goal'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
      </FormSheet>
    </View>
  );
}
