import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { LinkedLoanService } from '@/services/LinkedLoanService';
import { SharedLoan } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';

interface PendingRequest {
  sharedLoan: SharedLoan & { id: string };
  iAmBorrower: boolean;
}

interface Props {
  onAccepted: (sharedLoan: SharedLoan & { id: string }, iAmBorrower: boolean) => Promise<void>;
}

export default function LinkedLoanPendingBanner({ onAccepted }: Props) {
  const { user } = useAuth();
  const { actualTheme } = useTheme();
  const isDark = actualTheme === 'dark';
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user?.uid) return;

    unsubRef.current = LinkedLoanService.listenToMySharedLoans(user.uid, (loans) => {
      const pendingForMe = loans
        .filter(l => l.linkStatus === 'PENDING' && l.initiatorUid !== user.uid)
        .map(l => ({
          sharedLoan: l,
          iAmBorrower: l.borrowerUid === user.uid,
        }));
      setPending(pendingForMe);
    });

    return () => { unsubRef.current?.(); };
  }, [user?.uid]);

  if (pending.length === 0) return null;

  const handleAccept = async (req: PendingRequest) => {
    if (!user) return;
    setProcessing(req.sharedLoan.id);
    try {
      await onAccepted(req.sharedLoan, req.iAmBorrower);
    } catch (err) {
      Alert.alert('Error', 'Failed to accept link. Please try again.');
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = (req: PendingRequest) => {
    if (!user) return;
    Alert.alert(
      'Reject Link',
      `Reject loan link from ${req.iAmBorrower ? req.sharedLoan.lenderName : req.sharedLoan.borrowerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setProcessing(req.sharedLoan.id);
            try {
              await LinkedLoanService.rejectLink(
                req.sharedLoan.id,
                user.uid,
                user.displayName || user.email || 'User',
              );
            } catch {
              Alert.alert('Error', 'Failed to reject. Try again.');
            } finally {
              setProcessing(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ marginHorizontal: 24, marginBottom: 8 }}>
      {pending.map(req => {
        const otherName = req.iAmBorrower
          ? req.sharedLoan.lenderName
          : req.sharedLoan.borrowerName;
        const role = req.iAmBorrower ? 'borrowed from you' : 'lent to you';
        const isProcessing = processing === req.sharedLoan.id;

        return (
          <View
            key={req.sharedLoan.id}
            style={{
              backgroundColor: isDark ? '#1e3a2f' : '#f0fdf4',
              borderColor: isDark ? '#166534' : '#86efac',
              borderWidth: 1,
              borderRadius: 16,
              padding: 14,
              marginBottom: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: isDark ? '#166534' : '#dcfce7',
                alignItems: 'center', justifyContent: 'center', marginRight: 10,
              }}>
                <FontAwesome name="link" size={14} color="#16a34a" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: isDark ? '#fff' : '#15803d', fontWeight: '700', fontSize: 14 }}>
                  Loan Link Request
                </Text>
                <Text style={{ color: isDark ? '#86efac' : '#166534', fontSize: 12, marginTop: 1 }}>
                  {otherName} says they {role} ETB {req.sharedLoan.amount.toLocaleString()}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => handleReject(req)}
                disabled={isProcessing}
                style={{
                  flex: 1, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: isDark ? '#3f1e1e' : '#fee2e2',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 13 }}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAccept(req)}
                disabled={isProcessing}
                style={{
                  flex: 2, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: '#16a34a',
                  alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
                }}
              >
                {isProcessing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <FontAwesome name="check" size={12} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Accept</Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}
