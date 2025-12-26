import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, Platform, Dimensions } from 'react-native';

import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

export default function CalculatorScreen() {
  const router = useRouter();
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState(true);
  const [history, setHistory] = useState<string[]>([]);

  // --- Logic Handlers ---
  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleNumberPress = (num: string) => {
    triggerHaptic();
    if (newNumber) {
      setDisplay(num);
      setNewNumber(false);
    } else {
      setDisplay(display === '0' ? num : display + num);
    }
  };

  const handleOperationPress = (op: string) => {
    triggerHaptic();
    if (previousValue !== null && operation !== null && !newNumber) {
      handleEquals();
    }
    setPreviousValue(display);
    setOperation(op);
    setNewNumber(true);
  };

  const handleEquals = () => {
    triggerHaptic();
    if (previousValue === null || operation === null) return;

    const prev = parseFloat(previousValue);
    const current = parseFloat(display);
    let result = 0;

    switch (operation) {
      case '+': result = prev + current; break;
      case '-': result = prev - current; break;
      case '×': result = prev * current; break;
      case '÷': result = current !== 0 ? prev / current : 0; break;
      case '%': result = (prev * current) / 100; break;
    }

    setHistory([`${previousValue} ${operation} ${display} = ${result}`, ...history.slice(0, 5)]);
    setDisplay(result.toString());
    setPreviousValue(null);
    setOperation(null);
    setNewNumber(true);
  };

  const handleClear = () => {
    triggerHaptic();
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setNewNumber(true);
  };

  const handleBackspace = () => {
    triggerHaptic();
    if (display.length > 1) {
      setDisplay(display.slice(0, -1));
    } else {
      setDisplay('0');
    }
  };

  // --- UI Components ---
  const CalcButton = ({
    value,
    onPress,
    variant = 'default'
  }: {
    value: string;
    onPress: () => void;
    variant?: 'default' | 'operator' | 'equals' | 'function';
  }) => {
    const isOperator = variant === 'operator';
    const isEquals = variant === 'equals';
    const isFunction = variant === 'function';

    return (
      <TouchableOpacity
        onPress={onPress}
        delayPressIn={0} // FIX: Immediate response inside scroll views
        activeOpacity={0.5}
        style={{
          width: '22%', // Roughly 4 columns with margins
          aspectRatio: 1,
          marginBottom: 12,
        }}
      >
        <View
          className={`w-full h-full justify-center items-center rounded-3xl
            ${isOperator ? 'bg-indigo-500' :
              isEquals ? 'bg-emerald-500' :
                isFunction ? 'bg-slate-200 dark:bg-slate-700' :
                  'bg-white dark:bg-slate-800'}`}
          style={{
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 3,
            elevation: 2
          }}
        >
          <Text className={`text-2xl font-semibold 
            ${(isOperator || isEquals) ? 'text-white' :
              isFunction ? 'text-indigo-600 dark:text-indigo-400' :
                'text-slate-800 dark:text-white'}`}>
            {value}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <StatusBar style="auto" />

      {/* 1. Header Area */}
      <View className="px-6 py-4 flex-row justify-between items-center">
        <TouchableOpacity onPress={() => router.back()} className="p-2 bg-white dark:bg-slate-900 rounded-2xl shadow-sm">
          <FontAwesome name="chevron-left" size={16} color="#64748b" />
        </TouchableOpacity>
        <Text className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-tighter text-xs">Calculator</Text>
        <TouchableOpacity onPress={handleClear} className="p-2">
          <Text className="text-red-500 font-bold">Clear</Text>
        </TouchableOpacity>
      </View>

      {/* 2. Display Area */}
      <View className="flex-1 justify-end px-8 pb-10">
        <View className="items-end">
          {operation && (
            <Text className="text-indigo-500 dark:text-indigo-400 text-2xl font-light mb-2">
              {previousValue} {operation}
            </Text>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse' }}>
            <Text className="text-slate-900 dark:text-white text-7xl font-light tracking-tighter">
              {display}
            </Text>
          </ScrollView>
        </View>
      </View>

      {/* 3. Keypad "Sheet" */}
      <View
        className="bg-white dark:bg-slate-900 rounded-t-[40px] px-6 pt-10 pb-6 shadow-2xl"
        style={{
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -10 },
          shadowOpacity: 0.05,
          shadowRadius: 15,
        }}
      >
        {/* Row 1 */}
        <View className="flex-row justify-between">
          <CalcButton value="C" onPress={handleClear} variant="function" />
          <CalcButton value="⌫" onPress={handleBackspace} variant="function" />
          <CalcButton value="%" onPress={() => handleOperationPress('%')} variant="function" />
          <CalcButton value="÷" onPress={() => handleOperationPress('÷')} variant="operator" />
        </View>

        {/* Row 2 */}
        <View className="flex-row justify-between">
          <CalcButton value="7" onPress={() => handleNumberPress('7')} />
          <CalcButton value="8" onPress={() => handleNumberPress('8')} />
          <CalcButton value="9" onPress={() => handleNumberPress('9')} />
          <CalcButton value="×" onPress={() => handleOperationPress('×')} variant="operator" />
        </View>

        {/* Row 3 */}
        <View className="flex-row justify-between">
          <CalcButton value="4" onPress={() => handleNumberPress('4')} />
          <CalcButton value="5" onPress={() => handleNumberPress('5')} />
          <CalcButton value="6" onPress={() => handleNumberPress('6')} />
          <CalcButton value="-" onPress={() => handleOperationPress('-')} variant="operator" />
        </View>

        {/* Row 4 */}
        <View className="flex-row justify-between">
          <CalcButton value="1" onPress={() => handleNumberPress('1')} />
          <CalcButton value="2" onPress={() => handleNumberPress('2')} />
          <CalcButton value="3" onPress={() => handleNumberPress('3')} />
          <CalcButton value="+" onPress={() => handleOperationPress('+')} variant="operator" />
        </View>

        {/* Row 5 */}
        <View className="flex-row justify-between">
          <CalcButton value="±" onPress={() => { }} />
          <CalcButton value="0" onPress={() => handleNumberPress('0')} />
          <CalcButton value="." onPress={() => handleNumberPress('.')} />
          <CalcButton value="=" onPress={handleEquals} variant="equals" />
        </View>
      </View>
    </View>
  );
}