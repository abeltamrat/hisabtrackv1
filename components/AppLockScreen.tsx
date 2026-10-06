import { useAppLock } from '@/contexts/AppLockContext';
import { useAuth } from '@/contexts/AuthContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PIN_LENGTH = 4;

export default function AppLockScreen() {
  const { isLocked, biometricEnabled, biometricAvailable, hasPin, unlockWithBiometric, unlockWithPin } = useAppLock();
  const { user, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const bioTriggered = useRef(false);

  const shake = useCallback(() => {
    Vibration.vibrate(200);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const tryBiometric = useCallback(async () => {
    if (!biometricEnabled || !biometricAvailable) return;
    const ok = await unlockWithBiometric();
    if (!ok) setError('Biometric failed — enter your PIN');
  }, [biometricEnabled, biometricAvailable, unlockWithBiometric]);

  // Auto-trigger biometric when lock screen appears
  useEffect(() => {
    if (isLocked && !bioTriggered.current) {
      bioTriggered.current = true;
      setTimeout(() => tryBiometric(), 400);
    }
    if (!isLocked) {
      bioTriggered.current = false;
      setPin('');
      setError('');
    }
  }, [isLocked, tryBiometric]);

  // Submit PIN automatically when 4 digits entered
  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      unlockWithPin(pin).then(ok => {
        if (!ok) {
          shake();
          setError('Incorrect PIN');
          setTimeout(() => setPin(''), 500);
        }
      }).catch(error => { setError(error.message); setPin(''); });
    }
    if (pin.length > 0) setError('');
  }, [pin, unlockWithPin, shake]);

  const pressKey = (key: string) => {
    if (pin.length < PIN_LENGTH) setPin(p => p + key);
  };

  const deleteKey = () => setPin(p => p.slice(0, -1));

  if (!isLocked) return null;

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
      <LinearGradient colors={['#1e3a8a', '#1d4ed8']} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          {/* Header */}
          <View style={{ alignItems: 'center', paddingTop: 48, paddingBottom: 32 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <FontAwesome name="lock" size={36} color="#fff" />
            </View>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 4 }}>HisabTrack</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
              Welcome back, {displayName}
            </Text>
          </View>

          {/* PIN dots */}
          <Animated.View style={{ alignItems: 'center', marginBottom: 8, transform: [{ translateX: shakeAnim }] }}>
            <View style={{ flexDirection: 'row', gap: 20, marginBottom: 16 }}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: i < pin.length ? '#fff' : 'transparent',
                    borderWidth: 2,
                    borderColor: '#fff',
                  }}
                />
              ))}
            </View>
            {!!error && (
              <Text style={{ color: '#fca5a5', fontSize: 13, marginTop: 4 }}>{error}</Text>
            )}
          </Animated.View>

          {/* Biometric button */}
          {biometricEnabled && biometricAvailable && (
            <TouchableOpacity
              onPress={tryBiometric}
              style={{ alignItems: 'center', marginBottom: 24 }}
            >
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 6 }}>
                <FontAwesome name="mobile" size={28} color="#fff" />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>Use Fingerprint</Text>
            </TouchableOpacity>
          )}

          {/* Number pad */}
          <View style={{ paddingHorizontal: 48 }}>
            {[['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']].map((row, ri) => (
              <View key={ri} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                {row.map((key, ki) => (
                  <TouchableOpacity
                    key={ki}
                    onPress={() => key === '⌫' ? deleteKey() : key ? pressKey(key) : null}
                    disabled={!key}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 36,
                      backgroundColor: key ? 'rgba(255,255,255,0.15)' : 'transparent',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: '#fff', fontSize: key === '⌫' ? 22 : 26, fontWeight: '500' }}>
                      {key}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>

          {/* Sign out link */}
          <TouchableOpacity
            onPress={() => signOut()}
            style={{ alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Sign out</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}
