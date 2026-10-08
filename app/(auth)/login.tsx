import AuthBackground, { AUTH_BASE } from '@/components/AuthBackground';
import CoinLoader from '@/components/CoinLoader';
import { useAuth } from '@/contexts/AuthContext';
import { AuthService, validatePhone } from '@/services/AuthService';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@/services/SessionStorage';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { useFormErrors } from '@/hooks/useFormErrors';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Returns true when the string looks like a phone number (no @ sign). */
function isPhoneNumber(value: string): boolean {
  return !value.includes('@');
}

export default function LoginScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [identifier, setIdentifier] = useState(''); // email or phone
  const { errors, validate, clearError, resetErrors } = useFormErrors<'identifier' | 'email' | 'password'>();
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [email, setEmail] = useState(''); // signup-only email field
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    loadSavedIdentifier();
  }, []);

  const loadSavedIdentifier = async () => {
    try {
      const saved = await AsyncStorage.getItem('rememberedEmail');
      if (saved) {
        setIdentifier(saved);
        setRememberMe(true);
      }
    } catch (error) {
      console.error('Error loading saved identifier:', error);
    }
  };

  const saveIdentifier = async (value: string) => {
    try {
      await AsyncStorage.setItem('rememberedEmail', value);
    } catch (error) {
      console.error('Error saving identifier:', error);
    }
  };

  const clearSavedIdentifier = async () => {
    try {
      await AsyncStorage.removeItem('rememberedEmail');
    } catch (error) {
      console.error('Error clearing identifier:', error);
    }
  };

  if (!authLoading && user) {
    return <Redirect href="/(tabs)" />;
  }

  const handleSignIn = async () => {
    if (!validate({
      identifier: !identifier.trim() && 'Enter your email address or phone number.',
      password: !password.trim() && 'Enter your password.',
    })) return;

    setLoading(true);

    let loginEmail = identifier.trim();

    if (isPhoneNumber(loginEmail)) {
      setLoading(false);
      Alert.alert('Use your email', 'Sign in with your email address. Phone-directory lookup is available only after sign-in.');
      return;
    }

    const result = await AuthService.signIn(loginEmail, password);
    setLoading(false);

    if (result.success && result.user) {
      if (rememberMe) {
        await saveIdentifier(identifier.trim());
      } else {
        await clearSavedIdentifier();
      }
      router.replace('/(tabs)');
    } else {
      Alert.alert('Error', result.error || 'Failed to sign in');
    }
  };

  const handleSignUp = async () => {
    if (!validate({
      email: !email.trim() && 'Enter an email address.',
      password: !password.trim()
        ? 'Choose a password.'
        : password.length < 6 && 'Use at least 6 characters.',
    })) return;

    if (phone.trim()) {
      const phoneErr = validatePhone(phone.trim());
      if (phoneErr) {
        setPhoneError(phoneErr);
        return;
      }
    }
    setPhoneError(null);

    setLoading(true);
    const result = await AuthService.signUp(
      email.trim(),
      password,
      name.trim() || undefined,
      phone.trim() || undefined,
    );
    setLoading(false);

    if (result.success && result.user) {
      router.replace('/(tabs)');
    } else {
      Alert.alert('Error', result.error || 'Failed to create account');
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const result = await AuthService.signInWithGoogle();
    setLoading(false);
    if (result.success) {
      router.replace('/(tabs)');
    } else if (result.error !== 'Sign-in cancelled') {
      Alert.alert('Google Sign-In Failed', result.error || 'Could not sign in with Google');
    }
  };

  const handleResetPassword = async () => {
    if (!validate({
      identifier: !identifier.trim()
        ? 'Enter your email address.'
        : isPhoneNumber(identifier.trim()) && 'A reset link can only be sent to an email address.',
    })) return;

    setLoading(true);
    const result = await AuthService.resetPassword(identifier.trim());
    setLoading(false);

    if (result.success) {
      Alert.alert('Success', 'Password reset email sent! Check your inbox.', [
        { text: 'OK', onPress: () => setMode('signin') },
      ]);
    } else {
      Alert.alert('Error', result.error || 'Failed to send reset email');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: AUTH_BASE }}>
      <AuthBackground />
      <SafeAreaView className="flex-1">
        <StatusBar style="light" />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, width: '100%', maxWidth: 520, alignSelf: 'center' }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo/Header */}
            <View className="items-center mb-8">
              <Image source={require('../../assets/images/hisab-coin-loader.png')} accessibilityLabel="Hisab Track coin logo" style={{ width: 88, height: 88, marginBottom: 16 }} />
              <Text className="text-white text-4xl font-bold mb-2">Hisab Track</Text>
              <Text className="text-white/90 text-center text-base">
                {mode === 'signin' && 'Welcome back! Sign in to continue'}
                {mode === 'signup' && 'Create your account to get started'}
                {mode === 'reset' && 'Reset your password'}
              </Text>
            </View>

            {/* Login Card */}
            <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderRadius: 28, padding: 24 }}>
              {mode === 'signin' && (
                <>
                  <Text className="text-white text-2xl font-bold mb-2">Sign In</Text>
                  <Text className="text-slate-300 mb-8">Enter your credentials to continue</Text>

                  {/* Email */}
                  <View className="mb-4">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Email or phone</Text>
                    <TextInput
                      placeholderTextColor="#94a3b8"
                      selectionColor="#67e8f9"
                      className={`bg-white/5 text-white p-4 rounded-xl text-base border-2 ${errors.identifier ? 'border-red-500' : 'border-white/[0.16]'}`}
                      placeholder="your@email.com or +251912345678"
                      value={identifier}
                      onChangeText={(value) => { clearError('identifier'); setIdentifier(value); }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      accessibilityLabel="Email address or phone number"
                      aria-invalid={!!errors.identifier}
                    />
                    {errors.identifier ? (
                      <Text accessibilityRole="alert" className="text-red-300 text-xs mt-1.5 font-semibold">{errors.identifier}</Text>
                    ) : null}
                  </View>

                  {/* Password */}
                  <View className="mb-6">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Password</Text>
                    <View className="relative">
                      <TextInput
                        placeholderTextColor="#94a3b8"
                        selectionColor="#67e8f9"
                        className={`bg-white/5 text-white p-4 rounded-xl text-base border-2 pr-12 ${errors.password ? 'border-red-500' : 'border-white/[0.16]'}`}
                        placeholder="••••••••"
                        value={password}
                        onChangeText={(value) => { clearError('password'); setPassword(value); }}
                        secureTextEntry={!showPassword}
                        autoComplete="password"
                        accessibilityLabel="Password"
                        aria-invalid={!!errors.password}
                      />
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                        onPress={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: 4, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <FontAwesome name={showPassword ? 'eye-slash' : 'eye'} size={20} color="#cbd5e1" />
                      </TouchableOpacity>
                    </View>
                    {errors.password ? (
                      <Text accessibilityRole="alert" className="text-red-300 text-xs mt-1.5 font-semibold">{errors.password}</Text>
                    ) : null}
                    <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} disabled={loading} onPress={() => { resetErrors(); setMode('reset'); }} className="mt-2">
                      <Text className="text-cyan-200 text-sm">Forgot password?</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Remember Me */}
                  <TouchableOpacity
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: rememberMe }}
                    style={{ minHeight: 44 }}
                    onPress={() => setRememberMe(!rememberMe)}
                    className="flex-row items-center mb-6"
                  >
                    <View className={`w-6 h-6 rounded-md border-2 ${rememberMe ? 'bg-indigo-600 border-indigo-400' : 'bg-white/5 border-white/20'} justify-center items-center mr-3`}>
                      {rememberMe && <FontAwesome name="check" size={14} color="#fff" />}
                    </View>
                    <Text className="text-slate-300 text-sm">Remember me</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleSignIn}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading, busy: loading }}
                    className={`bg-indigo-600 min-h-[56px] py-3 rounded-xl flex-row gap-2 justify-center items-center mb-4 ${loading ? 'opacity-50' : ''}`}
                  >
                    {loading && <CoinLoader size="small" />}
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Signing in...' : 'Sign In'}
                    </Text>
                  </TouchableOpacity>

                  {/* Divider */}
                  <View className="flex-row items-center mb-4">
                    <View className="flex-1 h-px bg-white/[0.15]" />
                    <Text className="text-slate-300 text-sm mx-3">or</Text>
                    <View className="flex-1 h-px bg-white/[0.15]" />
                  </View>

                  {/* Google Sign-In */}
                  <TouchableOpacity
                    onPress={handleGoogleSignIn}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading, busy: loading }}
                    className={`h-14 rounded-xl justify-center items-center border-2 border-white/[0.16] bg-white/5 flex-row gap-3 mb-4 ${loading ? 'opacity-50' : ''}`}
                  >
                    <FontAwesome name="google" size={20} color="#EA4335" />
                    <Text className="text-slate-200 font-semibold text-base">Continue with Google</Text>
                  </TouchableOpacity>

                  <View className="flex-row flex-wrap justify-center items-center gap-y-2">
                    <Text className="text-slate-300">Don't have an account? </Text>
                    <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} disabled={loading} onPress={() => { resetErrors(); setMode('signup'); }}>
                      <Text className="text-cyan-200 font-semibold">Sign Up</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {mode === 'signup' && (
                <>
                  <Text className="text-white text-2xl font-bold mb-2">Create Account</Text>
                  <Text className="text-slate-300 mb-8">Sign up to start tracking your finances</Text>

                  {/* Name */}
                  <View className="mb-4">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Name (Optional)</Text>
                    <TextInput
                      placeholderTextColor="#94a3b8"
                      selectionColor="#67e8f9"
                      className="bg-white/5 text-white p-4 rounded-xl text-base border-2 border-white/[0.16]"
                      placeholder="Your Name"
                      accessibilityLabel="Name (optional)"
                      value={name}
                      onChangeText={setName}
                      autoComplete="name"
                    />
                  </View>

                  {/* Phone Number */}
                  <View className="mb-4">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Phone Number (Optional)</Text>
                    <TextInput
                      placeholderTextColor="#94a3b8"
                      selectionColor="#67e8f9"
                      className={`bg-white/5 text-white p-4 rounded-xl text-base border-2 ${phoneError ? 'border-red-400' : 'border-white/[0.16]'}`}
                      placeholder="09 or +251 or just 9..."
                      accessibilityLabel="Phone number (optional)"
                      value={phone}
                      onChangeText={(v) => { setPhone(v); setPhoneError(null); }}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                    />
                    {phoneError ? (
                      <Text className="text-red-300 text-xs mt-1">{phoneError}</Text>
                    ) : (
                      <Text className="text-slate-300 text-xs mt-1 ">
                        Accepts 09…, 9…, or +251… — allows sign-in with phone
                      </Text>
                    )}
                  </View>

                  {/* Email */}
                  <View className="mb-4">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Email</Text>
                    <TextInput
                      placeholderTextColor="#94a3b8"
                      selectionColor="#67e8f9"
                      className={`bg-white/5 text-white p-4 rounded-xl text-base border-2 ${errors.email ? 'border-red-500' : 'border-white/[0.16]'}`}
                      placeholder="your@email.com"
                      value={email}
                      onChangeText={(value) => { clearError('email'); setEmail(value); }}
                      keyboardType="email-address"
                      accessibilityLabel="Email address"
                      aria-invalid={!!errors.email}
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                    {errors.email ? (
                      <Text accessibilityRole="alert" className="text-red-300 text-xs mt-1.5 font-semibold">{errors.email}</Text>
                    ) : null}
                  </View>

                  {/* Password */}
                  <View className="mb-6">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Password</Text>
                    <View className="relative">
                      <TextInput
                        placeholderTextColor="#94a3b8"
                        selectionColor="#67e8f9"
                        className="bg-white/5 text-white p-4 rounded-xl text-base border-2 border-white/[0.16] pr-12"
                        placeholder="••••••••"
                        value={password}
                        onChangeText={(value) => { clearError('password'); setPassword(value); }}
                        secureTextEntry={!showPassword}
                        accessibilityLabel="Choose a password"
                        aria-invalid={!!errors.password}
                        autoComplete="password-new"
                      />
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                        onPress={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: 4, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <FontAwesome name={showPassword ? 'eye-slash' : 'eye'} size={20} color="#cbd5e1" />
                      </TouchableOpacity>
                    </View>
                    {errors.password ? (
                      <Text accessibilityRole="alert" className="text-red-300 text-xs mt-2 font-semibold">{errors.password}</Text>
                    ) : (
                      <Text className="text-slate-300 text-xs mt-2 ">
                        Must be at least 6 characters
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity
                    onPress={handleSignUp}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading, busy: loading }}
                    className={`bg-indigo-600 min-h-[56px] py-3 rounded-xl flex-row gap-2 justify-center items-center mb-4 ${loading ? 'opacity-50' : ''}`}
                  >
                    {loading && <CoinLoader size="small" />}
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Creating account...' : 'Create Account'}
                    </Text>
                  </TouchableOpacity>

                  <View className="flex-row flex-wrap justify-center items-center gap-y-2">
                    <Text className="text-slate-300">Already have an account? </Text>
                    <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} disabled={loading} onPress={() => { resetErrors(); setMode('signin'); }}>
                      <Text className="text-cyan-200 font-semibold">Sign In</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {mode === 'reset' && (
                <>
                  <TouchableOpacity
                    disabled={loading} onPress={() => { resetErrors(); setMode('signin'); }}
                    accessibilityRole="button"
                    style={{ minHeight: 44 }}
                    className="flex-row items-center mb-6"
                  >
                    <FontAwesome name="arrow-left" size={20} color="#cbd5e1" />
                    <Text className="text-slate-300 ml-2">Back to Sign In</Text>
                  </TouchableOpacity>

                  <Text className="text-white text-2xl font-bold mb-2">Reset Password</Text>
                  <Text className="text-slate-300 mb-8">
                    Enter your email and we'll send you a reset link
                  </Text>

                  <View className="mb-6">
                    <Text className="text-slate-300 text-sm font-bold mb-2">Email</Text>
                    <TextInput
                      placeholderTextColor="#94a3b8"
                      selectionColor="#67e8f9"
                      className="bg-white/5 text-white p-4 rounded-xl text-base border-2 border-white/[0.16]"
                      placeholder="your@email.com"
                      value={identifier}
                      onChangeText={(value) => { clearError('identifier'); setIdentifier(value); }}
                      keyboardType="email-address"
                      accessibilityLabel="Email address"
                      aria-invalid={!!errors.identifier}
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                    {errors.identifier ? (
                      <Text accessibilityRole="alert" className="text-red-300 text-xs mt-1.5 font-semibold">{errors.identifier}</Text>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    onPress={handleResetPassword}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading, busy: loading }}
                    className={`bg-indigo-600 min-h-[56px] py-3 rounded-xl flex-row gap-2 justify-center items-center ${loading ? 'opacity-50' : ''}`}
                  >
                    {loading && <CoinLoader size="small" />}
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Footer */}
            <Text className="text-white/90 text-center mt-8 text-sm">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
