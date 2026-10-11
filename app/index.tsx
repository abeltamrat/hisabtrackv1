import CoinLoader from '@/components/CoinLoader';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' }}>
        <CoinLoader size={72} accessibilityLabel="Opening HisabTrack" />
        <Text style={{ color: '#cbd5e1', marginTop: 12 }}>Opening HisabTrack…</Text>
      </View>
    );
  }

  return <Redirect href={user ? '/(tabs)' : '/(auth)/login'} />;
}
