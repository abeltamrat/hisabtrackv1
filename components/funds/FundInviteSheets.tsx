import { FontAwesome } from '@expo/vector-icons';
import * as ExpoLinking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { Share, Text, TouchableOpacity, View } from 'react-native';

import FormField from '@/components/FormField';
import FormSheet from '@/components/FormSheet';
import { useFormErrors } from '@/hooks/useFormErrors';
import { formatInviteCode, fundErrorMessage, SharedFundService, type FundInviteResult } from '@/services/SharedFundService';
import type { FundType } from '@/types/database';
import { generateUUID } from '@/utils/uuid';
import { FUND_TYPES, snapshotCategories } from './fundUi';

type OwnCategory = { id: string; name: string; icon: string; color: string; type: string; parentId?: string };

export function inviteMessage(code: string, ownerName: string, fundName: string) {
  const link = ExpoLinking.createURL('fund-invite', { queryParams: { code } });
  return `${ownerName} invited you to hold "${fundName}" on HisabTrack.\n\nOpen HisabTrack → Funds → Join with code and enter ${formatInviteCode(code)}\nor tap ${link}\n\nThe code works once and expires in 7 days.`;
}

/** The code, ready to send by SMS, WhatsApp or Telegram. */
export function InviteShareCard({ code, ownerName, fundName, found, displayName, emailHint }: {
  code: string; ownerName: string; fundName: string; found?: boolean; displayName?: string | null; emailHint?: string | null;
}) {
  return (
    <View className="rounded-2xl bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-4">
      {found ? (
        <Text className="text-teal-800 dark:text-teal-200 text-xs font-semibold mb-3">
          ✓ {displayName || 'They'} ({emailHint}) will see the invite in their Funds screen. You can also send the code.
        </Text>
      ) : emailHint ? (
        <Text className="text-amber-700 dark:text-amber-300 text-xs font-semibold mb-3">
          No verified HisabTrack account uses {emailHint} yet. Send them the code instead.
        </Text>
      ) : null}
      <Text className="text-slate-500 dark:text-slate-400 text-xs">Invite code</Text>
      <Text selectable className="text-slate-900 dark:text-white text-3xl font-bold tracking-widest my-1" accessibilityLabel={`Invite code ${code.split('').join(' ')}`}>
        {formatInviteCode(code)}
      </Text>
      <Text className="text-slate-500 dark:text-slate-400 text-[11px] mb-3">Works once · expires in 7 days</Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => { void Share.share({ message: inviteMessage(code, ownerName, fundName) }).catch(() => undefined); }}
        className="flex-row items-center justify-center rounded-xl py-3 bg-teal-600"
      >
        <FontAwesome name="share-alt" size={14} color="#fff" />
        <Text className="text-white font-bold ml-2">Share invite</Text>
      </TouchableOpacity>
    </View>
  );
}

type CreateField = 'name' | 'target' | 'email';

export function CreateFundSheet({ visible, myName, currency, categories, formatCurrency, onClose, onCreated }: {
  visible: boolean;
  myName: string;
  currency: string;
  categories: OwnCategory[];
  formatCurrency: (value: number) => string;
  onClose: () => void;
  onCreated: (fundId: string) => void;
}) {
  const { errors, validate, clearError, setError, resetErrors } = useFormErrors<CreateField>();
  const [fundType, setFundType] = useState<FundType>('PETTY_CASH');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<(FundInviteResult & { name: string }) | null>(null);

  useEffect(() => {
    if (!visible) return;
    resetErrors();
    setFundType('PETTY_CASH');
    setName('');
    setTarget('');
    setEmail('');
    setSaving(false);
    setResult(null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const floatTarget = target.trim() ? Number(target.replace(',', '.')) : null;
    const ok = validate({
      name: !name.trim() ? 'Give the fund a name, like "Office petty cash".' : false,
      target: floatTarget !== null && !(floatTarget > 0) ? 'Enter the float amount, or leave it empty.' : false,
      email: email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? 'That email address looks incomplete.' : false,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const created = await SharedFundService.create({
        fundId: generateUUID(), name: name.trim(), fundType, currency,
        floatTarget: fundType === 'HELD_FOR_ME' ? null : floatTarget,
        categories: snapshotCategories(categories), email: email.trim() || undefined, myName,
      });
      setResult({ ...created, name: name.trim() });
    } catch (error) {
      setError('name', fundErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet visible={visible} onClose={onClose} accessibilityLabel="New fund" maxHeight="92%">
      <View className="flex-row items-center justify-between mb-5">
        <Text className="text-slate-900 dark:text-white text-lg font-bold">{result ? 'Invite the person holding it' : 'New fund'}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 items-center justify-center">
          <FontAwesome name="times" size={14} color="#64748b" />
        </TouchableOpacity>
      </View>

      {result?.code ? (
        <>
          <InviteShareCard code={result.code} ownerName={myName} fundName={result.name} found={result.found} displayName={result.displayName} emailHint={result.emailHint} />
          <Text className="text-slate-500 dark:text-slate-400 text-xs mt-4 mb-4">
            Once they join, use "Send money" to record what you give them. Everything they spend from it shows up here and in your reports.
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => onCreated(result.fundId)} className="rounded-2xl py-4 items-center bg-slate-900 dark:bg-white">
            <Text className="text-white dark:text-slate-900 font-bold">Open the fund</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">What kind of fund?</Text>
          {FUND_TYPES.map(option => (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: fundType === option.value }}
              onPress={() => setFundType(option.value)}
              className={`flex-row items-center p-3 rounded-2xl mb-2 border ${fundType === option.value ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-500' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
            >
              <View className="w-9 h-9 rounded-xl bg-white dark:bg-slate-900 items-center justify-center mr-3">
                <FontAwesome name={option.icon as any} size={15} color="#0d9488" />
              </View>
              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-bold text-sm">{option.label}</Text>
                <Text className="text-slate-500 dark:text-slate-400 text-xs">{option.hint}</Text>
              </View>
              {fundType === option.value && <FontAwesome name="check-circle" size={18} color="#0d9488" />}
            </TouchableOpacity>
          ))}
          <View className="h-3" />
          <FormField label="Name" required value={name} onChangeText={value => { setName(value); clearError('name'); }} placeholder={fundType === 'HELD_FOR_ME' ? 'e.g. Held by Abebe' : 'e.g. Office petty cash'} error={errors.name} />
          {fundType !== 'HELD_FOR_ME' && (
            <FormField
              label="Float amount"
              value={target}
              onChangeText={value => { setTarget(value); clearError('target'); }}
              keyboardType="decimal-pad"
              placeholder="Optional, e.g. 5000"
              error={errors.target}
              hint={`Lets HisabTrack say how much to send to refill it${target && Number(target) > 0 ? ` (${formatCurrency(Number(target))})` : ''}.`}
            />
          )}
          <FormField
            label="Their HisabTrack email"
            value={email}
            onChangeText={value => { setEmail(value); clearError('email'); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Optional"
            error={errors.email}
            hint="You'll also get a code to send them by SMS, WhatsApp or Telegram."
          />
          <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={save} className={`rounded-2xl py-4 items-center ${saving ? 'bg-teal-400' : 'bg-teal-600'}`}>
            <Text className="text-white font-bold">{saving ? 'Creating…' : 'Create and get invite code'}</Text>
          </TouchableOpacity>
        </>
      )}
    </FormSheet>
  );
}

export function JoinFundSheet({ visible, myName, initialCode, onClose, onJoined }: {
  visible: boolean;
  myName: string;
  initialCode?: string;
  onClose: () => void;
  onJoined: (fundId: string) => void;
}) {
  const { errors, validate, clearError, setError, resetErrors } = useFormErrors<'code'>();
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    resetErrors();
    setCode(initialCode ? formatInviteCode(initialCode.toUpperCase().replace(/[^A-Z0-9]/g, '')) : '');
    setSaving(false);
  }, [visible, initialCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!validate({ code: clean.length !== 8 ? 'Codes have 8 letters and numbers, like K7M2-Q9XA.' : false })) return;
    setSaving(true);
    try {
      const joined = await SharedFundService.acceptCode(clean, myName);
      onJoined(joined.fundId);
    } catch (error) {
      setError('code', fundErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet visible={visible} onClose={onClose} accessibilityLabel="Join a fund">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-slate-900 dark:text-white text-lg font-bold">Join with a code</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 items-center justify-center">
          <FontAwesome name="times" size={14} color="#64748b" />
        </TouchableOpacity>
      </View>
      <Text className="text-slate-500 dark:text-slate-400 text-xs mb-4">
        The owner sees only what you record for this fund. Your own accounts and spending stay private.
      </Text>
      <FormField
        label="Invite code"
        value={code}
        onChangeText={value => { setCode(value.toUpperCase()); clearError('code'); }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="XXXX-XXXX"
        maxLength={12}
        error={errors.code}
      />
      <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={join} className={`rounded-2xl py-4 items-center ${saving ? 'bg-teal-400' : 'bg-teal-600'}`}>
        <Text className="text-white font-bold">{saving ? 'Joining…' : 'Join fund'}</Text>
      </TouchableOpacity>
    </FormSheet>
  );
}
