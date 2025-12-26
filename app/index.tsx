import { Redirect } from 'expo-router';

export default function Index() {
  // TODO: Check authentication state here
  const isAuthenticated = false;

  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
