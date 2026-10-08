import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

/** hisabtrackv1://fund-invite?code=XXXXXXXX opens Funds with the code filled in. */
export default function FundInviteLink() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <Redirect href={{ pathname: '/funds', params: code ? { code } : {} } as any} />;
}
