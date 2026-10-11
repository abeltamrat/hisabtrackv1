import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, Text, TouchableOpacity, View } from 'react-native';

import AppShareService, { AppShareProgress } from '@/services/AppShareService';
import { Alert } from '@/utils/alert';
import CoinLoader from './CoinLoader';

interface ShareAppModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ShareAppModal({ visible, onClose }: ShareAppModalProps) {
  const [busy, setBusy] = useState<'link' | 'apk' | null>(null);
  const [status, setStatus] = useState<AppShareProgress | null>(null);

  useEffect(() => {
    if (!visible) {
      setBusy(null);
      setStatus(null);
    }
  }, [visible]);

  const run = async (kind: 'link' | 'apk') => {
    try {
      setBusy(kind);
      setStatus(kind === 'apk' ? { message: 'Preparing APK…' } : null);
      if (kind === 'link') await AppShareService.shareInstallLink();
      else await AppShareService.shareApk(setStatus);
    } catch (error) {
      Alert.alert('Could not share app', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full max-w-sm rounded-3xl border border-white/15 bg-white p-6 dark:bg-slate-900">
          <View className="mb-5 flex-row items-start">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 dark:bg-indigo-900/40">
              <FontAwesome name="share-alt" size={21} color="#6366f1" />
            </View>
            <View className="ml-3 flex-1">
              <Text accessibilityRole="header" className="text-xl font-bold text-slate-900 dark:text-white">Share Hisab Track</Text>
              <Text className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Invite a friend or family member using their preferred app.</Text>
            </View>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !!busy, busy: busy === 'link' }}
            disabled={!!busy}
            onPress={() => void run('link')}
            className="mb-3 min-h-[68px] flex-row items-center rounded-2xl bg-indigo-600 px-4 py-3"
          >
            {busy === 'link' ? <CoinLoader size="small" /> : <FontAwesome name="link" size={19} color="#fff" />}
            <View className="ml-3 flex-1">
              <Text className="font-bold text-white">Share install link</Text>
              <Text className="mt-0.5 text-xs text-indigo-100">Small and quick to send by message, email, or social app.</Text>
            </View>
          </TouchableOpacity>

          {Platform.OS === 'android' && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: !!busy, busy: busy === 'apk' }}
              disabled={!!busy}
              onPress={() => void run('apk')}
              className="min-h-[68px] flex-row items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
            >
              {busy === 'apk' ? <CoinLoader size="small" /> : <FontAwesome name="android" size={20} color="#10b981" />}
              <View className="ml-3 flex-1">
                <Text className="font-bold text-slate-900 dark:text-white">Share APK file</Text>
                <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Downloads and verifies the latest installer before sharing.</Text>
              </View>
            </TouchableOpacity>
          )}

          {status && (
            <View className="mt-4">
              <Text accessibilityRole="alert" className="text-center text-xs text-slate-600 dark:text-slate-300">{status.message}</Text>
              <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <View className="h-full bg-emerald-500" style={{ width: `${Math.max(8, Math.round((status.progress ?? 0.08) * 100))}%` }} />
              </View>
            </View>
          )}

          <TouchableOpacity accessibilityRole="button" disabled={!!busy} onPress={onClose} className="mt-4 min-h-[44px] items-center justify-center">
            <Text className="font-semibold text-slate-500 dark:text-slate-400">Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
