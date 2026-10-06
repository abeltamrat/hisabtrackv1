import { useAuth } from '@/contexts/AuthContext';
import { AuthService, validatePhone } from '@/services/AuthService';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@/services/SessionStorage';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Returns true when the string looks like a phone number (no @ sign). */
function isPhoneNumber(value: string): boolean {
  return !value.includes('@');
}

export default function LoginScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [identifier, setIdentifier] = useState(''); // email or phone
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
    if (!identifier.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter your email or phone number and password');
      return;
    }

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
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

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
    if (!identifier.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    // Reset by email only — if they entered a phone, ask for email
    if (isPhoneNumber(identifier.trim())) {
      Alert.alert('Error', 'Please enter your email address to reset your password');
      return;
    }

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
    <LinearGradient colors={['#2563eb', '#1d4ed8']} className="flex-1">
      <SafeAreaView className="flex-1">
        <StatusBar style="light" />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Logo/Header */}
            <View className="items-center mb-12">
              <View className="w-24 h-24 bg-white/20 rounded-full justify-center items-center mb-6">
                <FontAwesome name="lock" size={48} color="#fff" />
              </View>
              <Text className="text-white text-4xl font-bold mb-2">HisabTrack</Text>
              <Text className="text-white/80 text-center text-base">
                {mode === 'signin' && 'Welcome back! Sign in to continue'}
                {mode === 'signup' && 'Create your account to get started'}
                {mode === 'reset' && 'Reset your password'}
              </Text>
            </View>

            {/* Login Card */}
            <View className="bg-white rounded-3xl p-8 shadow-2xl">
              {mode === 'signin' && (
                <>
                  <Text className="text-slate-900 text-2xl font-bold mb-2">Sign In</Text>
                  <Text className="text-slate-500 mb-8">Enter your credentials to continue</Text>

                  {/* Email */}
                  <View className="mb-4">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Email Number</Text>
                    <TextInput
                      className="bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 border-slate-200"
                      placeholder="your@email.com or +251912345678"
                      value={identifier}
                      onChangeText={setIdentifier}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      autoFocus
                    />
                  </View>

                  {/* Password */}
                  <View className="mb-6">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Password</Text>
                    <View className="relative">
                      <TextInput
                        className="bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 border-slate-200 pr-12"
                        placeholder="••••••••"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        autoComplete="password"
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-4"
                      >
                        <FontAwesome name={showPassword ? 'eye-slash' : 'eye'} size={20} color="#64748b" />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => setMode('reset')} className="mt-2">
                      <Text className="text-blue-600 text-sm">Forgot password?</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Remember Me */}
                  <TouchableOpacity
                    onPress={() => setRememberMe(!rememberMe)}
                    className="flex-row items-center mb-6"
                  >
                    <View className={`w-6 h-6 rounded-md border-2 ${rememberMe ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'} justify-center items-center mr-3`}>
                      {rememberMe && <FontAwesome name="check" size={14} color="#fff" />}
                    </View>
                    <Text className="text-slate-600 text-sm">Remember me</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleSignIn}
                    disabled={loading}
                    className={`bg-blue-600 h-14 rounded-xl justify-center items-center shadow-lg mb-4 ${loading ? 'opacity-50' : ''}`}
                  >
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Signing in...' : 'Sign In'}
                    </Text>
                  </TouchableOpacity>

                  {/* Divider */}
                  <View className="flex-row items-center mb-4">
                    <View className="flex-1 h-px bg-slate-200" />
                    <Text className="text-slate-400 text-sm mx-3">or</Text>
                    <View className="flex-1 h-px bg-slate-200" />
                  </View>

                  {/* Google Sign-In */}
                  <TouchableOpacity
                    onPress={handleGoogleSignIn}
                    disabled={loading}
                    className={`h-14 rounded-xl justify-center items-center border-2 border-slate-200 bg-white flex-row gap-3 mb-4 ${loading ? 'opacity-50' : ''}`}
                  >
                    <FontAwesome name="google" size={20} color="#EA4335" />
                    <Text className="text-slate-700 font-semibold text-base">Continue with Google</Text>
                  </TouchableOpacity>

                  <View className="flex-row justify-center items-center">
                    <Text className="text-slate-500">Don't have an account? </Text>
                    <TouchableOpacity onPress={() => setMode('signup')}>
                      <Text className="text-blue-600 font-semibold">Sign Up</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {mode === 'signup' && (
                <>
                  <Text className="text-slate-900 text-2xl font-bold mb-2">Create Account</Text>
                  <Text className="text-slate-500 mb-8">Sign up to start tracking your finances</Text>

                  {/* Name */}
                  <View className="mb-4">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Name (Optional)</Text>
                    <TextInput
                      className="bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 border-slate-200"
                      placeholder="Your Name"
                      value={name}
                      onChangeText={setName}
                      autoComplete="name"
                    />
                  </View>

                  {/* Phone Number */}
                  <View className="mb-4">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Phone Number (Optional)</Text>
                    <TextInput
                      className={`bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 ${phoneError ? 'border-red-400' : 'border-slate-200'}`}
                      placeholder="09 or +251 or just 9..."
                      value={phone}
                      onChangeText={(v) => { setPhone(v); setPhoneError(null); }}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                    />
                    {phoneError ? (
                      <Text className="text-red-500 text-xs mt-1">{phoneError}</Text>
                    ) : (
                      <Text className="text-slate-400 text-xs mt-1">
                        Accepts 09…, 9…, or +251… — allows sign-in with phone
                      </Text>
                    )}
                  </View>

                  {/* Email */}
                  <View className="mb-4">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Email</Text>
                    <TextInput
                      className="bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 border-slate-200"
                      placeholder="your@email.com"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                  </View>

                  {/* Password */}
                  <View className="mb-6">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Password</Text>
                    <View className="relative">
                      <TextInput
                        className="bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 border-slate-200 pr-12"
                        placeholder="••••••••"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        autoComplete="password-new"
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-4"
                      >
                        <FontAwesome name={showPassword ? 'eye-slash' : 'eye'} size={20} color="#64748b" />
                      </TouchableOpacity>
                    </View>
                    <Text className="text-slate-400 text-xs mt-2">
                      Must be at least 6 characters
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={handleSignUp}
                    disabled={loading}
                    className={`bg-blue-600 h-14 rounded-xl justify-center items-center shadow-lg mb-4 ${loading ? 'opacity-50' : ''}`}
                  >
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Creating account...' : 'Create Account'}
                    </Text>
                  </TouchableOpacity>

                  <View className="flex-row justify-center items-center">
                    <Text className="text-slate-500">Already have an account? </Text>
                    <TouchableOpacity onPress={() => setMode('signin')}>
                      <Text className="text-blue-600 font-semibold">Sign In</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {mode === 'reset' && (
                <>
                  <TouchableOpacity
                    onPress={() => setMode('signin')}
                    className="flex-row items-center mb-6"
                  >
                    <FontAwesome name="arrow-left" size={20} color="#64748b" />
                    <Text className="text-slate-600 ml-2">Back to Sign In</Text>
                  </TouchableOpacity>

                  <Text className="text-slate-900 text-2xl font-bold mb-2">Reset Password</Text>
                  <Text className="text-slate-500 mb-8">
                    Enter your email and we'll send you a reset link
                  </Text>

                  <View className="mb-6">
                    <Text className="text-slate-500 text-sm font-bold mb-2">Email</Text>
                    <TextInput
                      className="bg-slate-50 text-slate-900 p-4 rounded-xl text-base border-2 border-slate-200"
                      placeholder="your@email.com"
                      value={identifier}
                      onChangeText={setIdentifier}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      autoFocus
                    />
                  </View>

                  <TouchableOpacity
                    onPress={handleResetPassword}
                    disabled={loading}
                    className={`bg-blue-600 h-14 rounded-xl justify-center items-center shadow-lg ${loading ? 'opacity-50' : ''}`}
                  >
                    <Text className="text-white font-bold text-base">
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Footer */}
            <Text className="text-white/60 text-center mt-8 text-sm">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
