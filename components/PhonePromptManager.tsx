import { useAuth } from '@/contexts/AuthContext';
import { AuthService, validatePhone } from '@/services/AuthService';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@/services/SessionStorage';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';

const KEY_LOGIN_COUNT = '@hisabtrack_login_count';
const KEY_PHONE_PROMPT_LAST = '@hisabtrack_phone_prompt_last';
const PHONE_HAS_KEY = (uid: string) => `@hisabtrack_has_phone_${uid}`;

const EVERY_N_LOGINS = 10;
const DAYS_BETWEEN_PROMPTS = 7;

export default function PhonePromptManager() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!user?.uid || checkedRef.current) return;
    checkedRef.current = true;
    void checkAndMaybeShow(user.uid, user.email);
  }, [user?.uid]);

  const checkAndMaybeShow = async (uid: string, email: string | null) => {
    try {
      // Fast path: cached local flag
      const cached = await AsyncStorage.getItem(PHONE_HAS_KEY(uid));
      if (cached === 'true') return;

      // Check Firestore (once per session)
      const existingPhone = await AuthService.getUserPhone(uid);
      if (existingPhone) {
        await AsyncStorage.setItem(PHONE_HAS_KEY(uid), 'true');
        return;
      }

      // Increment login count
      const raw = await AsyncStorage.getItem(KEY_LOGIN_COUNT);
      const loginCount = (parseInt(raw ?? '0', 10) || 0) + 1;
      await AsyncStorage.setItem(KEY_LOGIN_COUNT, String(loginCount));

      // Check last shown
      const lastRaw = await AsyncStorage.getItem(KEY_PHONE_PROMPT_LAST);
      const lastShown = lastRaw ? parseInt(lastRaw, 10) : 0;
      const daysSinceLast = (Date.now() - lastShown) / (1000 * 60 * 60 * 24);

      const shouldShow =
        loginCount === 1 ||
        loginCount % EVERY_N_LOGINS === 0 ||
        daysSinceLast >= DAYS_BETWEEN_PROMPTS;

      if (shouldShow) {
        setVisible(true);
      }
    } catch (err) {
      console.warn('[PhonePromptManager] check failed:', err);
    }
  };

  const dismiss = async () => {
    await AsyncStorage.setItem(KEY_PHONE_PROMPT_LAST, String(Date.now()));
    setVisible(false);
  };

  const handleSave = async () => {
    if (!phone.trim()) {
      setPhoneError('Please enter a phone number');
      return;
    }
    const err = validatePhone(phone.trim());
    if (err) {
      setPhoneError(err);
      return;
    }
    setPhoneError(null);
    if (!user?.uid || !user?.email) return;

    setSaving(true);
    try {
      await AuthService.savePhoneIndex(user.uid, user.email, phone.trim());
      await AsyncStorage.setItem(PHONE_HAS_KEY(user.uid), 'true');
      setVisible(false);
      Alert.alert('Saved', 'Your phone number has been linked to your account.');
    } catch (err) {
      Alert.alert('Error', 'Failed to save phone number. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 24,
            padding: 28,
            width: '100%',
            maxWidth: 380,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 20,
            elevation: 10,
          }}>
            {/* Icon */}
            <View style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: '#eff6ff',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 16,
            }}>
              <FontAwesome name="phone" size={24} color="#2563eb" />
            </View>

            <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 6 }}>
              Add your phone number
            </Text>
            <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 20 }}>
              Link a phone number to your account so you can sign in without typing your email.
            </Text>

            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 6 }}>
              PHONE NUMBER
            </Text>
            <TextInput
              style={{
                backgroundColor: '#f8fafc',
                borderWidth: 1.5,
                borderColor: phoneError ? '#ef4444' : '#e2e8f0',
                borderRadius: 12,
                padding: 14,
                fontSize: 16,
                color: '#0f172a',
                marginBottom: phoneError ? 4 : 20,
              }}
              placeholder="09… or +251… or 9…"
              placeholderTextColor="#94a3b8"
              value={phone}
              onChangeText={(v) => { setPhone(v); setPhoneError(null); }}
              keyboardType="phone-pad"
              autoComplete="tel"
              autoFocus
            />
            {phoneError && (
              <Text style={{ color: '#ef4444', fontSize: 12, marginBottom: 16 }}>{phoneError}</Text>
            )}

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={{
                backgroundColor: '#2563eb',
                borderRadius: 12,
                height: 50,
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 10,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save Phone Number</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={dismiss} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: '#94a3b8', fontSize: 14 }}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
