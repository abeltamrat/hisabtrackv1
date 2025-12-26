import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';


interface AmortizationScheduleItem {
  period: number;
  payment: number;
  paymentLabel?: string;
  principal: number;
  interest: number;
  balance: number;
}

export default function AmortizationScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { formatCurrency } = useAppSettings();
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [years, setYears] = useState('');
  const [frequencyValue, setFrequencyValue] = useState(12);
  const [showTableModal, setShowTableModal] = useState(false);

  const [result, setResult] = useState<{
    paymentAmount: number;
    totalPayment: number;
    totalInterest: number;
    paymentLabel: string;
    schedule: AmortizationScheduleItem[];
  } | null>(null);

  const frequencies = [
    { label: 'Monthly', value: 12 },
    { label: 'Every 2 Months', value: 6 },
    { label: 'Quarterly', value: 4 },
    { label: 'Every 6 Months', value: 2 },
    { label: 'Yearly', value: 1 },
    { label: 'One Time', value: 0 },
  ];

  const calculate = () => {
    const p = parseFloat(principal);
    const rVal = parseFloat(rate);
    const y = parseFloat(years);

    if (isNaN(p) || isNaN(rVal) || isNaN(y) || p <= 0 || rVal < 0 || y <= 0) {
      return;
    }

    let schedule: AmortizationScheduleItem[] = [];

    // One Time Payment (Compounded Monthly)
    if (frequencyValue === 0) {
      const totalPayment = p * Math.pow(1 + (rVal / 100 / 12), y * 12);
      const totalInterest = totalPayment - p;

      schedule.push({
        period: 1,
        payment: totalPayment,
        principal: p,
        interest: totalInterest,
        balance: 0
      });

      setResult({
        paymentAmount: totalPayment,
        totalPayment,
        totalInterest,
        paymentLabel: 'One Time Payment',
        schedule
      });
      return;
    }

    // Periodic Amortization
    const r = rVal / 100 / frequencyValue;
    const n = y * frequencyValue;

    // A = P * (r * (1+r)^n) / ((1+r)^n - 1)
    const payment = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const totalPayment = payment * n;

    // Generate Schedule
    let balance = p;
    for (let i = 1; i <= n; i++) {
      const interest = balance * r;
      const principalPayment = payment - interest;
      balance -= principalPayment;
      if (balance < 0) balance = 0; // Floating point correction

      schedule.push({
        period: i,
        payment: payment,
        principal: principalPayment,
        interest: interest,
        balance: balance
      });
    }

    // Mapping value back to label for display (e.g. "Monthly Payment")
    const freqObj = frequencies.find(f => f.value === frequencyValue);
    // Let's just use specific map logic
    let displayLabel = 'Payment';
    if (frequencyValue === 12) displayLabel = 'Monthly Payment';
    else if (frequencyValue === 6) displayLabel = 'Bi-Monthly Payment';
    else if (frequencyValue === 4) displayLabel = 'Quarterly Payment';
    else if (frequencyValue === 2) displayLabel = 'Semi-Annual Payment';
    else if (frequencyValue === 1) displayLabel = 'Annual Payment';

    setResult({
      paymentAmount: payment,
      totalPayment,
      totalInterest: totalPayment - p,
      paymentLabel: displayLabel,
      schedule
    });
  };

  const reset = () => {
    setPrincipal('');
    setRate('');
    setYears('');
    setResult(null);
    setFrequencyValue(12);
    setShowTableModal(false);
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={colorScheme === 'dark' ? ['#334155', '#1e293b'] : ['#2563eb', '#1d4ed8']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center mb-4">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Amortization Calculator</Text>
          <TouchableOpacity onPress={reset} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="refresh" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
          {/* Inputs */}
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
            <Text className="text-slate-900 dark:text-white text-lg font-bold mb-4">Loan Details</Text>

            <View className="mb-4">
              <Text className="text-slate-500 text-sm font-bold mb-2">Principal Amount ($)</Text>
              <TextInput
                className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                placeholder="e.g. 10000"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
                value={principal}
                onChangeText={setPrincipal}
              />
            </View>

            <View className="mb-4">
              <Text className="text-slate-500 text-sm font-bold mb-2">Annual Interest Rate (%)</Text>
              <TextInput
                className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                placeholder="e.g. 5.5"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
                value={rate}
                onChangeText={setRate}
              />
            </View>

            <View className="mb-4">
              <Text className="text-slate-500 text-sm font-bold mb-2">Loan Term (Years)</Text>
              <TextInput
                className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                placeholder="e.g. 5"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
                value={years}
                onChangeText={setYears}
              />
            </View>

            <View className="mb-6">
              <Text className="text-slate-500 text-sm font-bold mb-2">Payment Frequency</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                {frequencies.map((f) => (
                  <TouchableOpacity
                    key={f.value}
                    onPress={() => setFrequencyValue(f.value)}
                    className={`mr-2 px-4 py-3 rounded-xl border ${frequencyValue === f.value
                        ? 'bg-blue-600 border-blue-600'
                        : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                      }`}
                  >
                    <Text className={`font-bold ${frequencyValue === f.value ? 'text-white' : 'text-slate-600 dark:text-slate-400'
                      }`}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <TouchableOpacity
              onPress={calculate}
              className="bg-blue-600 h-14 rounded-xl justify-center items-center shadow-lg shadow-blue-600/30"
            >
              <Text className="text-white font-bold text-base">Calculate</Text>
            </TouchableOpacity>
          </View>

          {/* Results */}
          {result && (
            <View className="bg-slate-900 rounded-3xl p-6 mb-6 shadow-lg" style={{ elevation: 4 }}>
              <Text className="text-white text-lg font-bold mb-6">Calculation Results</Text>

              <View className="flex-row justify-between items-center mb-4 border-b border-slate-800 pb-4">
                <Text className="text-slate-400">{result.paymentLabel}</Text>
                <Text className="text-white text-2xl font-bold text-green-400">
                  {formatCurrency(result.paymentAmount)}
                </Text>
              </View>

              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-slate-400">Total Payment</Text>
                <Text className="text-white font-bold text-lg">
                  {formatCurrency(result.totalPayment)}
                </Text>
              </View>

              <View className="flex-row justify-between items-center mb-6">
                <Text className="text-slate-400">Total Interest</Text>
                <Text className="text-white font-bold text-lg text-red-400">
                  {formatCurrency(result.totalInterest)}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setShowTableModal(true)}
                className="bg-slate-700 py-3 rounded-xl items-center"
              >
                <Text className="text-white font-bold">View Amortization Table</Text>
              </TouchableOpacity>
            </View>
          )}
          <View className="h-4" />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Amortization Table Modal */}
      <Modal
        visible={showTableModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTableModal(false)}
      >
        <View className="flex-1 bg-slate-50 dark:bg-slate-900">
          <View className="px-6 py-4 flex-row justify-between items-center border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <Text className="text-xl font-bold text-slate-900 dark:text-white">Amortization Table</Text>
            <TouchableOpacity onPress={() => setShowTableModal(false)} className="bg-slate-100 dark:bg-slate-800 p-2 rounded-full">
              <FontAwesome name="times" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View className="flex-row px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <Text className="flex-1 text-xs font-bold text-slate-500 uppercase text-center">Period</Text>
            <Text className="flex-[2] text-xs font-bold text-slate-500 uppercase text-right">Payment</Text>
            <Text className="flex-[2] text-xs font-bold text-slate-500 uppercase text-right">Principal</Text>
            <Text className="flex-[2] text-xs font-bold text-slate-500 uppercase text-right">Interest</Text>
            <Text className="flex-[2] text-xs font-bold text-slate-500 uppercase text-right">Balance</Text>
          </View>

          <ScrollView className="flex-1">
            {result?.schedule.map((row) => (
              <View key={row.period} className="flex-row px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <Text className="flex-1 text-slate-900 dark:text-white font-medium text-center">{row.period}</Text>
                <Text className="flex-[2] text-slate-900 dark:text-white font-medium text-right text-xs">{formatCurrency(row.payment)}</Text>
                <Text className="flex-[2] text-green-600 font-medium text-right text-xs">{formatCurrency(row.principal)}</Text>
                <Text className="flex-[2] text-red-500 font-medium text-right text-xs">{formatCurrency(row.interest)}</Text>
                <Text className="flex-[2] text-slate-500 font-medium text-right text-xs">{formatCurrency(row.balance)}</Text>
              </View>
            ))}
            <View className="h-8" />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
