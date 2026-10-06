import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';

type FloatingCalculatorProps = {
  onUseAmount: (amount: string) => void;
};

const evaluate = (input: string): number | null => {
  const tokens = input.match(/\d*\.?\d+|[+\-×÷]/g) ?? [];
  if (!tokens.length || tokens.join('') !== input.replace(/\s/g, '')) return null;
  const values: Array<number | string> = tokens.map(token => ['+', '-', '×', '÷'].includes(token) ? token : Number(token));
  for (let i = 1; i < values.length - 1; i += 2) {
    if (values[i] !== '×' && values[i] !== '÷') continue;
    const left = Number(values[i - 1]);
    const right = Number(values[i + 1]);
    if (!Number.isFinite(left) || !Number.isFinite(right) || (values[i] === '÷' && right === 0)) return null;
    values.splice(i - 1, 3, values[i] === '×' ? left * right : left / right);
    i -= 2;
  }
  let result = Number(values[0]);
  for (let i = 1; i < values.length; i += 2) {
    const right = Number(values[i + 1]);
    result = values[i] === '+' ? result + right : result - right;
  }
  return Number.isFinite(result) ? result : null;
};

export default function FloatingCalculator({ onUseAmount }: FloatingCalculatorProps) {
  const [visible, setVisible] = useState(false);
  const [expression, setExpression] = useState('');
  const result = useMemo(() => evaluate(expression), [expression]);
  const display = expression || '0';

  const add = (value: string) => {
    if (value === '.') {
      const current = expression.split(/[+\-×÷]/).pop() ?? '';
      if (current.includes('.')) return;
    }
    setExpression(prev => `${prev}${value}`);
  };

  const useResult = () => {
    if (result === null || !Number.isFinite(result)) return;
    onUseAmount(String(Number(result.toFixed(2))));
    setVisible(false);
  };

  const buttons = [
    ['C', () => setExpression(''), 'function'], ['⌫', () => setExpression(expression.slice(0, -1)), 'function'], ['÷', () => add('÷'), 'operator'], ['×', () => add('×'), 'operator'],
    ['7', () => add('7'), 'number'], ['8', () => add('8'), 'number'], ['9', () => add('9'), 'number'], ['-', () => add('-'), 'operator'],
    ['4', () => add('4'), 'number'], ['5', () => add('5'), 'number'], ['6', () => add('6'), 'number'], ['+', () => add('+'), 'operator'],
    ['1', () => add('1'), 'number'], ['2', () => add('2'), 'number'], ['3', () => add('3'), 'number'], ['.', () => add('.'), 'number'],
    ['0', () => add('0'), 'number'],
  ] as const;

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Open quick calculator"
        className="absolute right-5 bottom-5 w-14 h-14 rounded-full bg-indigo-600 items-center justify-center shadow-lg"
        style={{ elevation: 8, zIndex: 20 }}
      >
        <FontAwesome name="calculator" size={21} color="#fff" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-50 dark:bg-slate-900 rounded-t-3xl p-5">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-slate-900 dark:text-white text-lg font-bold">Quick calculator</Text>
              <TouchableOpacity onPress={() => setVisible(false)} className="p-2"><FontAwesome name="times" size={20} color="#64748b" /></TouchableOpacity>
            </View>
            <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 mb-4 items-end">
              <Text className="text-slate-500 dark:text-slate-400 text-sm" numberOfLines={1}>{display}</Text>
              <Text className="text-slate-900 dark:text-white text-3xl font-bold mt-1">{result === null ? '—' : result.toFixed(2)}</Text>
            </View>
            <View className="flex-row flex-wrap justify-between">
              {buttons.map(([label, handler, kind]) => (
                <TouchableOpacity key={label} onPress={handler} className={`w-[23%] h-12 rounded-xl items-center justify-center mb-2 ${kind === 'operator' ? 'bg-indigo-600' : kind === 'function' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-white dark:bg-slate-800'}`}>
                  <Text className={`text-lg font-bold ${kind === 'operator' ? 'text-white' : 'text-slate-800 dark:text-white'}`}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={useResult} disabled={result === null} className={`rounded-xl py-3 mt-2 ${result === null ? 'bg-slate-300 dark:bg-slate-700' : 'bg-emerald-600'}`}>
              <Text className="text-white text-center font-bold">Use amount</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
