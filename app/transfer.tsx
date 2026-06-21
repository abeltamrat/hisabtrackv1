import { useAppSettings } from '@/contexts/AppSettingsContext';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction } from '@/store/slices/transactionsSlice';
import { AppDispatch, RootState } from '@/store';
import { Account } from '@/types/database';
import { parseTagInput } from '@/utils/tags';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

export default function TransferScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const { formatCurrency, currency } = useAppSettings();

  const currencySymbol = useMemo(() => {
    return formatCurrency(0).replace(/[\d,.\s]/g, '').trim() || currency;
  }, [currency, formatCurrency]);

  const [amount, setAmount] = useState('');
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [note, setNote] = useState('');
  const parsedTags = useMemo(() => parseTagInput(tagsInput) || [], [tagsInput]);

  useEffect(() => {
    dispatch(fetchAccounts());
  }, [dispatch]);

  useEffect(() => {
    // Set default accounts if available
    if (accounts.length > 0) {
      if (!fromAccount) setFromAccount(accounts[0].id);
      if (!toAccount && accounts.length > 1) setToAccount(accounts[1].id);
      else if (!toAccount) setToAccount(accounts[0].id);
    }
  }, [accounts]);

  const handleTransfer = async () => {
    const numericAmount = parseFloat(amount);
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      Platform.OS === 'web' ? window.alert('Please enter a valid amount') : Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    if (!fromAccount || !toAccount) {
      Platform.OS === 'web' ? window.alert('Please select both accounts') : Alert.alert('Error', 'Please select both accounts');
      return;
    }
    if (fromAccount === toAccount) {
      Platform.OS === 'web' ? window.alert('Cannot transfer to the same account') : Alert.alert('Error', 'Cannot transfer to the same account');
      return;
    }

    const value = numericAmount;
    const sourceAcc = accounts.find((account) => account.id === fromAccount);
    const destAcc = accounts.find((account) => account.id === toAccount);

    const doTransfer = async () => {
      const result = await dispatch(addTransaction({
        account_id: fromAccount,
        to_account_id: toAccount,
        type: 'TRANSFER',
        amount: value,
        category: 'Transfer',
        tags: parseTagInput(tagsInput),
        date: Date.now(),
        description: `Transfer to ${destAcc?.name || 'Account'}${note ? ` (${note})` : ''}`,
      }));

      if (addTransaction.rejected.match(result)) {
        Alert.alert('Error', (result.error as any)?.message || 'Transfer failed.');
        return;
      }

      router.back();
    };

    if (sourceAcc && sourceAcc.balance < value) {
      Alert.alert(
        'Insufficient Balance',
        `${sourceAcc.name} only has ${formatCurrency(sourceAcc.balance)}. Do you want to proceed anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Proceed', onPress: doTransfer },
        ]
      );
      return;
    }

    await doTransfer();
  };

  // Helper for colors/icons (since real accounts might not have them defined in properties yet or strictly typed)
  const getAccountIcon = (type: string) => {
    if (type === 'BANK') return 'bank';
    if (type === 'MOBILE_MONEY') return 'mobile-phone';
    if (type === 'CASH') return 'money';
    return 'credit-card';
  };

  const getAccountColor = (id: string) => {
    // Generate consistent color from ID or just cycle
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    let sum = 0;
    for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
    return colors[sum % colors.length];
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
      enabled={Platform.OS !== 'web'}
      className="flex-1 bg-slate-50 dark:bg-background-dark"
    >
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />

      {/* Header */}
      <LinearGradient colors={['#2563eb', '#1d4ed8']} className="px-6 pt-16 pb-8 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="close" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Transfer Money</Text>
          <TouchableOpacity onPress={handleTransfer} className="w-10 h-10 bg-secondary-500 rounded-xl justify-center items-center">
            <FontAwesome name="check" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Amount Input */}
        <View className="items-center mb-6">
          <Text className="text-blue-100 text-sm mb-2">Transfer Amount</Text>
          <View className="flex-row items-center">
            <Text className="text-white text-5xl font-bold mr-2">{currencySymbol}</Text>
            <TextInput
              className="text-white text-6xl font-bold min-w-[150px] text-center"
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.5)"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              autoFocus
              style={{ outline: Platform.OS === 'web' ? 'none' : undefined } as any}
            />
          </View>
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {/* From Account */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">From Account</Text>
          <View className="space-y-3">
            {accounts.length === 0 ? (
              <Text className="text-slate-500">No accounts available.</Text>
            ) : (
              accounts.map((account: Account) => {
                const color = getAccountColor(account.id);
                const isSelected = fromAccount === account.id;

                return (
                  <TouchableOpacity
                    key={account.id}
                    className={`flex-row items-center p-4 rounded-2xl border-2 mb-2 ${isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                    onPress={() => setFromAccount(account.id)}
                  >
                    <View
                      className="w-12 h-12 rounded-2xl justify-center items-center mr-4"
                      style={{ backgroundColor: color + '20' }}
                    >
                      <FontAwesome name={getAccountIcon(account.type)} size={20} color={color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold text-base">{account.name}</Text>
                      <Text className={`text-sm font-semibold mt-1 ${account.balance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(Math.abs(account.balance))}
                      </Text>
                    </View>
                    {isSelected && (
                      <FontAwesome name="check-circle" size={20} color="#3b82f6" />
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>

        {/* Transfer Icon */}
        <View className="items-center -my-9 z-10 relative pointer-events-none display-none" style={{ opacity: 0.8 }}>
          {/* Positioned purely visual */}
          <View className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-full justify-center items-center">
            <FontAwesome name="arrow-down" size={16} color="#64748b" />
          </View>
        </View>

        {/* To Account */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700 mt-2" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">To Account</Text>
          <View className="space-y-3">
            {accounts.length === 0 ? (
              <Text className="text-slate-500">No accounts available.</Text>
            ) : (
              accounts.filter((account) => account.id !== fromAccount).map((account: Account) => {
                const color = getAccountColor(account.id);
                const isSelected = toAccount === account.id;

                return (
                  <TouchableOpacity
                    key={account.id}
                    className={`flex-row items-center p-4 rounded-2xl border-2 mb-2 ${isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                    onPress={() => setToAccount(account.id)}
                  >
                    <View
                      className="w-12 h-12 rounded-2xl justify-center items-center mr-4"
                      style={{ backgroundColor: color + '20' }}
                    >
                      <FontAwesome name={getAccountIcon(account.type)} size={20} color={color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-900 dark:text-white font-bold text-base">{account.name}</Text>
                      <Text className={`text-sm font-semibold mt-1 ${account.balance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(Math.abs(account.balance))}
                      </Text>
                    </View>
                    {isSelected && (
                      <FontAwesome name="check-circle" size={20} color="#3b82f6" />
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>

        {/* Note */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Tags (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
            <TextInput
              className="text-slate-900 dark:text-white text-base"
              placeholder="project, event, link"
              placeholderTextColor="#94a3b8"
              value={tagsInput}
              onChangeText={setTagsInput}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ outline: Platform.OS === 'web' ? 'none' : undefined } as any}
            />
          </View>
          <Text className="text-slate-400 text-xs mt-2">Separate tags with commas.</Text>
          {parsedTags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3 -mx-1 px-1">
              {parsedTags.map((tag) => (
                <View key={tag} className="mr-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                  <Text className="text-indigo-700 dark:text-indigo-300 text-xs font-semibold">#{tag}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Note */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-8 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Note (Optional)</Text>
          <View className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
            <TextInput
              className="text-slate-900 dark:text-white text-base min-h-[80px]"
              placeholder="Add a note about this transfer..."
              placeholderTextColor="#94a3b8"
              value={note}
              onChangeText={setNote}
              multiline
              textAlignVertical="top"
              style={{ outline: Platform.OS === 'web' ? 'none' : undefined } as any}
            />
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
