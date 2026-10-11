import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch } from 'react-redux';

import CategoryTreeSelect from '@/components/CategoryTreeSelect';
import FormField from '@/components/FormField';
import FormSheet from '@/components/FormSheet';
import TagInputField from '@/components/TagInputField';
import { mergeSplitTags, pushTagsIntoSplits } from '@/utils/tags';
import { commonSplitProject, pushProjectIntoSplits } from '@/utils/projectFinance';
import PersonLinkField from '@/components/PersonLinkField';
import TransactionSplitEditor from '@/components/TransactionSplitEditor';
import LineItemsEditor from '@/components/LineItemsEditor';
import { MelaCatalogContext, ProjectCostToggle, useSharedCatalog } from '@/components/ProjectPicker';
import SupplierField from '@/components/SupplierPicker';
import { useFormErrors } from '@/hooks/useFormErrors';
import FundPostingService, { custodianFundFields } from '@/services/FundPostingService';
import FundSyncService from '@/services/FundSyncService';
import { fundErrorMessage, SharedFundService, type FundEntryInput } from '@/services/SharedFundService';
import type { AppDispatch } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { addTransaction } from '@/store/slices/transactionsSlice';
import type { Account, ProjectLink, PurchaseLine, SharedFund, SupplierLink, Transaction, TransactionSplit } from '@/types/database';
import { money, sumMoney } from '@/utils/finance';
import { generateUUID } from '@/utils/uuid';
import type { RecipientProfile } from '@/services/RecipientIdentityService';
import { fundCategoryTree, setCustodianAccount } from './fundUi';

/**
 * custodian: pay (SPEND), received (DEPOSIT), custodianReturn (RETURN)
 * owner:     send (DEPOSIT from my account), expect (announce), ownerReturn (RETURN into my account)
 */
export type FundEntryMode = 'pay' | 'received' | 'custodianReturn' | 'send' | 'expect' | 'ownerReturn';

export interface FundEntryPrefill {
  amount?: number;
  recipient?: string;
  payerName?: string;
  description?: string;
  reference_number?: string;
  receipt_url?: string;
}

const TITLES: Record<FundEntryMode, { title: string; button: string; icon: string }> = {
  pay: { title: 'Record a payment', button: 'Save payment', icon: 'arrow-up' },
  received: { title: 'Money received for the fund', button: 'Save deposit', icon: 'arrow-down' },
  custodianReturn: { title: 'Return money', button: 'Save return', icon: 'reply' },
  send: { title: 'Send money to the fund', button: 'Record what I sent', icon: 'paper-plane' },
  expect: { title: 'Expect a deposit', button: 'Tell them to expect it', icon: 'clock-o' },
  ownerReturn: { title: 'Money returned to me', button: 'Record return', icon: 'reply' },
};

type Field = 'amount' | 'account' | 'payer' | 'receipt' | 'splits';
// Not shared yet: an empty catalog, so this fund never borrows the assistant's own Mela lists.
const EMPTY_CATALOG = { projects: [], items: [], suppliers: [] };

export default function FundEntrySheet({
  visible, mode, fund, myUid, accounts, defaultAccountId, tagSuggestions, fallbackCategories, prefill,
  formatCurrency, onClose, onSaved,
}: {
  visible: boolean;
  mode: FundEntryMode;
  fund: SharedFund;
  myUid: string;
  accounts: Account[];
  defaultAccountId?: string;
  tagSuggestions: string[];
  /** The custodian's own categories, used only if the owner shared none. */
  fallbackCategories: Array<{ id: string; name: string; parentId?: string; color?: string; icon?: string; type: string }>;
  prefill?: FundEntryPrefill;
  formatCurrency: (value: number) => string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const { errors, validate, clearError, setError, resetErrors } = useFormErrors<Field>();
  const ownerMode = mode === 'send' || mode === 'expect' || mode === 'ownerReturn';
  const holder = fund.custodianName || 'the custodian';

  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[] | undefined>();
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState('');
  const [fromSomeoneElse, setFromSomeoneElse] = useState(false);
  const [payerName, setPayerName] = useState('');
  const [payerPerson, setPayerPerson] = useState<RecipientProfile>();
  const [recipientPerson, setRecipientPerson] = useState<RecipientProfile>();
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splits, setSplits] = useState<TransactionSplit[]>([]);
  const [project, setProject] = useState<ProjectLink | undefined>();
  const [supplier, setSupplier] = useState<SupplierLink | undefined>();
  const [itemize, setItemize] = useState(false);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [saving, setSaving] = useState(false);
  // Projects, items, suppliers and Mela-item prices the owner chose to share with me.
  const sharedCatalog = useSharedCatalog(ownerMode ? undefined : fund.ownerUid);

  const categoryTree = useMemo(() => {
    const shared = fundCategoryTree(fund.categories, 'expense');
    if (shared.length) return shared;
    return fallbackCategories.filter(item => item.type === 'expense').map(item => ({ id: item.id, name: item.name, parentId: item.parentId, color: item.color, icon: item.icon }));
  }, [fallbackCategories, fund.categories]);

  // The fund's own cash account never pays or receives against itself.
  const pickable = useMemo(() => accounts.filter(account => account.fund_id !== fund.id || !ownerMode), [accounts, fund.id, ownerMode]);

  useEffect(() => {
    if (!visible) return;
    resetErrors();
    setProject(undefined); setSupplier(undefined); setItemize(false); setLines([]);
    setAmount(prefill?.amount ? String(prefill.amount) : mode === 'send' && fund.floatTarget && fund.balance < fund.floatTarget ? String(money(fund.floatTarget - fund.balance)) : '');
    setAccountId(defaultAccountId && pickable.some(account => account.id === defaultAccountId) ? defaultAccountId : pickable[0]?.id || '');
    setRecipient(prefill?.recipient || '');
    setDescription(prefill?.description || '');
    setCategory(categoryTree[0]?.name || '');
    setTags(undefined);
    setReference(prefill?.reference_number || '');
    setReceipt(prefill?.receipt_url || '');
    setFromSomeoneElse(!!prefill?.payerName);
    setPayerName(prefill?.payerName || '');
    setPayerPerson(undefined);
    setRecipientPerson(undefined);
    setSplitEnabled(false);
    setSplits([]);
    setSaving(false);
    // Reset only when the sheet opens; later prop changes must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode]);

  const needsAccount = mode !== 'expect';
  const needsPayer = mode === 'expect' || (mode === 'received' && fromSomeoneElse);

  const save = async () => {
    const value = Number(amount.replace(',', '.'));
    const receiptLink = receipt.trim();
    const ok = validate({
      amount: !(value > 0) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6 ? 'Enter an amount, like 250 or 99.50.' : false,
      account: needsAccount && !accountId ? (ownerMode ? 'Choose your account.' : 'Choose where this money is kept.') : false,
      payer: needsPayer && !payerName.trim() ? 'Who is sending the money?' : false,
      receipt: receiptLink && !/^https:\/\/\S+$/i.test(receiptLink) ? 'Receipt links must start with https://' : false,
      splits: mode === 'pay' && splitEnabled && (splits.length < 2 || sumMoney(splits.map(item => Number(item.amount) || 0)) !== money(value)) ? 'Split parts must add up to the amount.' : false,
    });
    const purchaseLines = mode === 'pay' && itemize ? lines.filter(line => line.item.name.trim() || line.amount > 0) : [];
    if (ok && (purchaseLines.some(line => !line.item.name.trim() || !(line.quantity > 0)) || sumMoney(purchaseLines.map(line => line.amount)) > money(value))) {
      setError('splits', 'Give every item a name and quantity, and keep items within the amount.');
      return;
    }
    if (!ok) return;

    setSaving(true);
    const entryId = generateUUID();
    const date = Date.now();
    try {
      if (ownerMode) {
        if (mode === 'expect') {
          await SharedFundService.announce(fund.id, entryId, { amount: value, date, payerName: payerName.trim(), payerPersonId: payerPerson?.id, note: description.trim() || undefined });
          onSaved(`${holder} will be asked to confirm when ${formatCurrency(value)} arrives.`);
        } else {
          await SharedFundService.record(fund.id, entryId, {
            kind: mode === 'send' ? 'DEPOSIT' : 'RETURN', source: mode === 'send' ? 'OWNER' : undefined,
            amount: value, date, description: description.trim() || undefined, ownerAccountId: accountId,
          });
          await FundSyncService.refresh(fund);
          onSaved(mode === 'send' ? `Recorded ${formatCurrency(value)} sent to ${holder}.` : `Recorded ${formatCurrency(value)} returned to you.`);
        }
        return;
      }

      // Custodian: write my own ledger row (works offline), then tell the fund.
      const splitActive = mode === 'pay' && splitEnabled;
      const entry: FundEntryInput = {
        kind: mode === 'pay' ? 'SPEND' : mode === 'received' ? 'DEPOSIT' : 'RETURN',
        source: mode === 'received' ? (fromSomeoneElse ? 'THIRD_PARTY' : 'OWNER_UNRECORDED') : undefined,
        amount: value, date,
        description: description.trim() || undefined,
        payerName: mode === 'received' && fromSomeoneElse ? payerName.trim() : undefined,
        payerPersonId: mode === 'received' && fromSomeoneElse ? payerPerson?.id : undefined,
        recipient: mode === 'pay' ? recipient.trim() || undefined : undefined,
        recipientPersonId: mode === 'pay' ? recipientPerson?.id : undefined,
        category: mode === 'pay' ? category || undefined : undefined,
        splits: splitActive ? pushProjectIntoSplits(project, pushTagsIntoSplits(tags, splits)) : undefined,
        lines: purchaseLines.length ? purchaseLines : undefined,
        project: mode === 'pay' && !splitActive ? project : undefined,
        supplier: mode === 'pay' ? supplier : undefined,
        tags: splitActive ? undefined : tags,
        reference_number: reference.trim() || undefined,
        receipt_url: receiptLink || undefined,
      };
      const local: Omit<Transaction, 'id'> = {
        type: mode === 'received' ? 'INCOME' : 'EXPENSE',
        account_id: accountId,
        amount: value,
        date,
        category: mode === 'pay' ? category || 'Fund payment' : mode === 'received' ? 'Fund deposit' : 'Fund return',
        description: description.trim() || (mode === 'pay' ? `${recipient.trim() || 'Payment'} for ${fund.ownerName}` : mode === 'received' ? `For ${fund.ownerName}${fromSomeoneElse ? ` from ${payerName.trim()}` : ''}` : `Returned to ${fund.ownerName}`),
        sender_receiver: mode === 'pay' ? recipient.trim() || undefined : mode === 'received' ? (fromSomeoneElse ? payerName.trim() : fund.ownerName) : fund.ownerName,
        person_id: mode === 'pay' ? recipientPerson?.id : mode === 'received' && fromSomeoneElse ? payerPerson?.id : undefined,
        person_name_snapshot: mode === 'pay' ? recipientPerson?.displayName : mode === 'received' && fromSomeoneElse ? payerPerson?.displayName : undefined,
        person_link_source: (mode === 'pay' && recipientPerson) || (mode === 'received' && fromSomeoneElse && payerPerson) ? 'MANUAL' : undefined,
        reference_number: reference.trim() || undefined,
        receipt_url: receiptLink || undefined,
        // The holder's own row has no parts, so it keeps every part's tags.
        tags: splitActive ? mergeSplitTags(pushTagsIntoSplits(tags, splits)) : tags,
        ...custodianFundFields(fund.id, entryId),
      } as Omit<Transaction, 'id'>;
      const result = await FundPostingService.submit(
        { id: entryId, uid: myUid, fundId: fund.id, fundName: fund.name, kind: 'record', entry },
        () => dispatch(addTransaction(local)).unwrap(),
      );
      void dispatch(fetchAccounts());
      void setCustodianAccount(fund.id, accountId);
      onSaved(result.synced ? 'Saved and shared with the owner.' : result.error ? `Saved on your phone, but the fund refused it: ${result.error}` : "Saved. It will be shared when you're back online.");
    } catch (error) {
      setError('amount', fundErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const heading = TITLES[mode];
  return (
    <FormSheet visible={visible} onClose={onClose} accessibilityLabel={heading.title} maxHeight="92%">
      <View className="flex-row items-center mb-5">
        <View className="w-10 h-10 rounded-2xl bg-teal-50 dark:bg-teal-900/30 items-center justify-center mr-3">
          <FontAwesome name={heading.icon as any} size={16} color="#0d9488" />
        </View>
        <View className="flex-1">
          <Text className="text-slate-900 dark:text-white text-lg font-bold">{heading.title}</Text>
          <Text className="text-slate-500 dark:text-slate-400 text-xs" numberOfLines={1}>{fund.name} · {ownerMode ? `held by ${holder}` : `for ${fund.ownerName}`}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 items-center justify-center">
          <FontAwesome name="times" size={14} color="#64748b" />
        </TouchableOpacity>
      </View>

      {mode === 'received' && (
        <View className="flex-row mb-4 gap-2">
          {[{ value: false, label: `${fund.ownerName} sent it` }, { value: true, label: 'Someone else sent it' }].map(option => (
            <TouchableOpacity
              key={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected: fromSomeoneElse === option.value }}
              onPress={() => { setFromSomeoneElse(option.value); clearError('payer'); }}
              className={`flex-1 py-3 rounded-xl border items-center ${fromSomeoneElse === option.value ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
            >
              <Text className={`text-xs font-bold ${fromSomeoneElse === option.value ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`} numberOfLines={1}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FormField
        label="Amount"
        required
        value={amount}
        onChangeText={value => { setAmount(value); clearError('amount'); }}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={errors.amount}
        hint={mode === 'send' && fund.floatTarget ? `Restores the ${formatCurrency(fund.floatTarget)} float` : undefined}
      />

      {needsPayer && (
        <><PersonLinkField label={mode === 'expect' ? 'Expected from saved person' : 'Sender'} person={payerPerson} suggestedName={payerName} onChange={person => { setPayerPerson(person); if (person) setPayerName(person.displayName); }} /><FormField
          label={mode === 'expect' ? 'Who will send it?' : 'Who sent it?'}
          required
          value={payerName}
          onChangeText={value => { setPayerName(value); clearError('payer'); }}
          placeholder="e.g. Mr X"
          error={errors.payer}
          hint={mode === 'expect' ? `${holder} confirms when it arrives. Until then it is not counted.` : undefined}
        /></>
      )}

      {needsAccount && (
        <View className="mb-4">
          <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">
            {mode === 'send' ? 'Sent from my account' : mode === 'ownerReturn' ? 'Returned into my account' : mode === 'received' ? 'Received into' : 'Paid from'}
          </Text>
          {pickable.length === 0 ? (
            <Text className="text-slate-500 dark:text-slate-400 text-xs">Add an account first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {pickable.map(account => (
                <TouchableOpacity
                  key={account.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: accountId === account.id }}
                  onPress={() => { setAccountId(account.id); clearError('account'); }}
                  className={`mr-2 px-3 py-2.5 rounded-xl border ${accountId === account.id ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                >
                  <Text className={`text-xs font-bold ${accountId === account.id ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`} numberOfLines={1}>{account.name}</Text>
                  <Text className={`text-[10px] mt-0.5 ${accountId === account.id ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>{formatCurrency(account.balance)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {errors.account ? <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-xs mt-1.5 font-semibold">{errors.account}</Text> : null}
        </View>
      )}

      {mode === 'pay' && (
        <>
          <PersonLinkField label="Paid to saved person" person={recipientPerson} suggestedName={recipient} onChange={person => { setRecipientPerson(person); if (person) setRecipient(person.displayName); }} />
          <FormField label="Paid to" value={recipient} onChangeText={setRecipient} placeholder="Shop, person or company" />
          <View className="mb-4">
            <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Category</Text>
            <CategoryTreeSelect categories={categoryTree} value={category} onChange={setCategory} accessibilityLabel="Payment category" />
            <Text className="text-slate-500 dark:text-slate-400 text-[11px] mt-1.5">{fund.ownerName} can re-categorise it in their own books.</Text>
          </View>
        </>
      )}

      <FormField
        label={mode === 'expect' ? 'Note for the custodian' : 'Description'}
        value={description}
        onChangeText={setDescription}
        placeholder={mode === 'pay' ? 'What was it for?' : mode === 'expect' ? 'e.g. Invoice 12' : 'Optional'}
      />

      {!ownerMode && (
        <>
          {!(mode === 'pay' && splitEnabled) && <View className="mb-4">
            <Text className="text-slate-700 dark:text-slate-300 text-sm font-bold mb-2">Tags</Text>
            <TagInputField tags={tags} suggestions={tagSuggestions} onChange={setTags} />
          </View>}
          <FormField label="Bank reference" value={reference} onChangeText={setReference} placeholder="e.g. FT26123ABC" autoCapitalize="characters" />
          <FormField
            label="Receipt link"
            value={receipt}
            onChangeText={value => { setReceipt(value); clearError('receipt'); }}
            placeholder="https://"
            autoCapitalize="none"
            keyboardType="url"
            error={errors.receipt}
          />
        </>
      )}

      {mode === 'pay' && (
        <View className="mb-4">
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: splitEnabled }}
            onPress={() => {
              const next = !splitEnabled;
              setSplitEnabled(next);
              clearError('splits');
              if (!next) { setTags(mergeSplitTags(splits)); setProject(commonSplitProject(splits)); return; }
              const value = Number(amount.replace(',', '.')) || 0;
              // Tags move onto the parts; the tag field hides while split.
              const parts = splits.length ? splits : [
                { id: `split-${Date.now()}-0`, amount: value, category: category || categoryTree[0]?.name || 'Uncategorized' },
                { id: `split-${Date.now()}-1`, amount: 0, category: categoryTree[1]?.name || categoryTree[0]?.name || 'Uncategorized' },
              ];
              setSplits(pushProjectIntoSplits(project, pushTagsIntoSplits(tags, parts)));
              setTags(undefined);
              setProject(undefined);
            }}
            className="flex-row items-center py-2"
          >
            <FontAwesome name={splitEnabled ? 'check-square' : 'square-o'} size={18} color={splitEnabled ? '#0d9488' : '#94a3b8'} />
            <Text className="text-slate-700 dark:text-slate-300 text-sm font-semibold ml-2">Split across categories</Text>
          </TouchableOpacity>
          {splitEnabled && (
            // Part project pickers read the owner's shared lists, like the fields below.
            <MelaCatalogContext.Provider value={sharedCatalog ?? EMPTY_CATALOG}>
              <TransactionSplitEditor total={Number(amount.replace(',', '.')) || 0} splits={splits} categories={categoryTree} onChange={setSplits} formatCurrency={formatCurrency} tagSuggestions={tagSuggestions} />
            </MelaCatalogContext.Provider>
          )}
          {errors.splits ? <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-xs mt-1.5 font-semibold">{errors.splits}</Text> : null}
        </View>
      )}

      {mode === 'pay' && (
        // Inside the provider, pickers read the owner's shared lists instead of this device's own.
        <MelaCatalogContext.Provider value={sharedCatalog ?? EMPTY_CATALOG}>
          <View className="mb-4 gap-3">
            {!splitEnabled && <ProjectCostToggle value={project} onChange={setProject} variant="row" />}
            <SupplierField value={supplier} onChange={setSupplier} />
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: itemize }} onPress={() => setItemize(!itemize)} className="flex-row items-center py-2">
              <FontAwesome name={itemize ? 'check-square' : 'square-o'} size={18} color={itemize ? '#0d9488' : '#94a3b8'} />
              <Text className="text-slate-700 dark:text-slate-300 text-sm font-semibold ml-2">Itemize purchase</Text>
            </TouchableOpacity>
            {itemize && <LineItemsEditor lines={lines} onChange={setLines} total={Number(amount.replace(',', '.')) || 0} formatCurrency={formatCurrency} />}
          </View>
        </MelaCatalogContext.Provider>
      )}

      {!ownerMode && (
        <Text className="text-slate-500 dark:text-slate-400 text-[11px] mb-4">
          This moves money in your own account, but it is {fund.ownerName}'s money, so it stays out of your personal reports and budgets.
        </Text>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        disabled={saving}
        onPress={save}
        className={`rounded-2xl py-4 items-center ${saving ? 'bg-teal-400' : 'bg-teal-600'}`}
      >
        <Text className="text-white font-bold">{saving ? 'Saving…' : heading.button}</Text>
      </TouchableOpacity>
    </FormSheet>
  );
}
