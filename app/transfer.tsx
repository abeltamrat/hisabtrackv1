import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction } from '@/store/slices/transactionsSlice';
import { generateUUID } from '@/utils/uuid';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

export default function TransferScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  // @ts-ignore
  const { items: accounts } = useSelector((state: any) => state.accounts);
  
  const [amount, setAmount] = useState('');
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchAccounts());
  }, []);

  useEffect(() => {
    // Set default accounts if available
    if (accounts.length > 0) {
       if (!fromAccount) setFromAccount(accounts[0].id);
       if (!toAccount && accounts.length > 1) setToAccount(accounts[1].id);
       else if (!toAccount) setToAccount(accounts[0].id);
    }
  }, [accounts]);

  const handleTransfer = async () => {
    if (!amount || parseFloat(amount) <= 0) {
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

    const value = parseFloat(amount);
    const sourceAcc = accounts.find((a: any) => a.id === fromAccount);
    const destAcc = accounts.find((a: any) => a.id === toAccount);

    if (sourceAcc.balance < value) {
        // Optional: Allow overdraft? Warn user.
        // For now, let's allow it but maybe warn or just proceed (as per logic). 
        // Money apps usually block or warn. 
        // Let's proceed for now.
    }

    try {
      // 1. Debit Source (TRANSFER type automatically deducts in our DB logic)
      // @ts-ignore
      await dispatch(addTransaction({
        id: generateUUID(),
        account_id: fromAccount,
        type: 'TRANSFER',
        amount: value,
        category: 'Transfer',
        date: Date.now(),
        description: `Transfer to ${destAcc?.name || 'Account'} ${note ? `(${note})` : ''}`,
      }));

      // 2. Credit Destination (INCOME type adds)
      // @ts-ignore
      await dispatch(addTransaction({
        id: generateUUID(),
        account_id: toAccount,
        type: 'INCOME', // Use INCOME to ensure balance increment
        amount: value,
        category: 'Transfer',
        date: Date.now(),
        description: `Transfer from ${sourceAcc?.name || 'Account'} ${note ? `(${note})` : ''}`,
      }));
      
      // Refresh accounts to show updated balances
      // @ts-ignore
      await dispatch(fetchAccounts());

      Platform.OS === 'web' ? window.alert('Transfer successful!') : Alert.alert('Success', 'Transfer successful!');
      router.back();

    } catch (error) {
       console.error(error);
       Platform.OS === 'web' ? window.alert('Transfer failed') : Alert.alert('Error', 'Transfer failed');
    }
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
            <Text className="text-white text-5xl font-bold mr-2">$</Text>
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
                accounts.map((account: any) => {
                  const color = getAccountColor(account.id);
                  const isSelected = fromAccount === account.id;
                  
                  return (
                    <TouchableOpacity
                      key={account.id}
                      className={`flex-row items-center p-4 rounded-2xl border-2 mb-2 ${
                        isSelected
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
                          ${Math.abs(account.balance).toFixed(2)}
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
                accounts.filter((a: any) => a.id !== fromAccount).map((account: any) => {
                  const color = getAccountColor(account.id);
                  const isSelected = toAccount === account.id;
                  
                  return (
                    <TouchableOpacity
                      key={account.id}
                      className={`flex-row items-center p-4 rounded-2xl border-2 mb-2 ${
                        isSelected
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
                          ${Math.abs(account.balance).toFixed(2)}
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
