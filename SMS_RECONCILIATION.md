# SMS Transaction Reconciliation System

## Overview
The SMS Transaction Reconciliation system automatically reads bank SMS messages, parses transaction details, and helps users reconcile their accounts by identifying unrecorded transactions.

## Features

### 1. **Automatic SMS Parsing**
- Reads SMS from configured bank senders (e.g., "CBE", "Awash Bank")
- Extracts transaction details:
  - Amount (debit/credit)
  - Account number (last 3-4 digits)
  - Transaction fees
  - Taxes
  - Current balance
  - Reference number
  - Merchant/recipient name
  - Date and time

### 2. **Smart Account Matching**
- Matches SMS transactions to accounts using last 3-4 digits of account number
- Supports multiple accounts from the same bank
- Handles cases where account number is not in SMS

### 3. **Transaction Reconciliation**
- Compares SMS transactions with recorded transactions
- Identifies duplicates using:
  - Reference number
  - SMS ID
  - Amount + type + date matching (within 1 hour window)
- Marks transactions as recorded/unrecorded

### 4. **Draft Transactions**
- Stores unrecorded transactions as drafts
- Allows user review before recording
- Tracks status (recorded/unrecorded)
- Persists across app sessions

### 5. **User Workflow**
1. User configures SMS sender for account (e.g., "CBE")
2. App automatically syncs SMS when account is viewed
3. Unrecorded transactions appear as drafts
4. User reviews and approves transactions
5. Approved transactions are saved to the account

## Architecture

### Components

#### 1. **EnhancedSMSParser** (`utils/enhancedSMSParser.ts`)
- Parses SMS messages using regex patterns
- Supports multiple bank formats (CBE, generic)
- Extracts comprehensive transaction data
- Suggests transaction categories

#### 2. **DraftTransactionService** (`services/DraftTransactionService.ts`)
- Manages draft transactions
- CRUD operations for drafts
- Tracks recorded/unrecorded status
- Cleanup of old recorded drafts

#### 3. **SMSSyncService** (`services/SMSSyncService.ts`)
- Reads SMS messages (platform-specific)
- Syncs SMS for accounts
- Reconciles with existing transactions
- Returns sync results

#### 4. **useSMSSync Hook** (`hooks/useSMSSync.ts`)
- React hook for SMS sync functionality
- Manages sync state
- Provides helper functions

#### 5. **Draft Transactions Screen** (`app/draft-transactions.tsx`)
- UI for viewing draft transactions
- Filter by status (all/unrecorded/recorded)
- Record or delete drafts
- Shows transaction details, fees, taxes

## Configuration

### Account Setup
To enable SMS sync for an account:

```typescript
{
  id: "account_1",
  name: "CBE Savings",
  account_number: "1234567890", // Full account number
  sms_number: "CBE", // SMS sender to listen to
  // ... other fields
}
```

### SMS Patterns
The parser supports various SMS formats:

**Debit Example:**
```
CBE: Your account ending 1234 has been debited with Birr 500.00 on 21/12/2025. 
Fee: Birr 5.00. Available balance: Birr 15,234.50. Ref: TXN123456
```

**Credit Example:**
```
CBE: Birr 2,500.00 credited to your account ending 1234 on 21/12/2025. 
Available balance: Birr 17,734.50. Ref: TXN123457
```

## Usage

### 1. Sync SMS for an Account
```typescript
import { useSMSSync } from '@/hooks/useSMSSync';

const { syncAccount, syncing } = useSMSSync();

// Sync when account is viewed
const handleSync = async () => {
  const result = await syncAccount(account, transactions);
  if (result) {
    console.log(`Found ${result.newDrafts} new transactions`);
  }
};
```

### 2. View Draft Transactions
```typescript
// Navigate to draft transactions screen
router.push(`/draft-transactions?accountId=${account.id}`);
```

### 3. Check Unrecorded Count
```typescript
import { useAccountDrafts } from '@/hooks/useSMSSync';

const { unrecordedCount } = useAccountDrafts(accountId);

// Show badge if unrecorded transactions exist
{unrecordedCount > 0 && (
  <View className="bg-yellow-500 rounded-full px-2 py-1">
    <Text className="text-white text-xs">{unrecordedCount}</Text>
  </View>
)}
```

### 4. Record a Draft Transaction
```typescript
import { DraftTransactionService } from '@/services/DraftTransactionService';

// Create transaction from draft
const transaction = await dispatch(addTransaction({
  account_id: draft.account_id,
  type: draft.type,
  amount: draft.amount,
  category: draft.category,
  description: draft.description,
  date: draft.date,
  reference_number: draft.reference_number,
  sms_id: draft.sms_id,
}));

// Mark draft as recorded
await DraftTransactionService.markAsRecorded(draft.id, transaction.id);
```

## Platform Support

### Android
- Full SMS reading support
- Requires `READ_SMS` permission
- Use `react-native-get-sms-android` or similar library

### iOS
- **Limited support** - iOS doesn't allow SMS reading for security reasons
- Manual entry required

### Web
- **Mock data only** for testing
- Real SMS sync not available

## Permissions

### Android Permissions Required
```xml
<uses-permission android:name="android.permission.READ_SMS" />
```

### Request Permissions
```typescript
const { requestPermissions } = useSMSSync();

const granted = await requestPermissions();
if (granted) {
  // Proceed with SMS sync
}
```

## Data Flow

```
1. User views account
   ↓
2. App triggers SMS sync
   ↓
3. SMSSyncService reads SMS from sender
   ↓
4. EnhancedSMSParser parses each SMS
   ↓
5. Account matching by last 4 digits
   ↓
6. Check if transaction already recorded
   ↓
7. Create draft transaction
   ↓
8. User reviews drafts
   ↓
9. User records or deletes draft
   ↓
10. Update account balance
```

## Best Practices

1. **Sync on Account View**: Always sync when user views an account
2. **Show Indicators**: Display unrecorded count badges
3. **Notify Users**: Alert when new transactions are found
4. **Cleanup**: Periodically remove old recorded drafts
5. **Error Handling**: Gracefully handle SMS permission denials
6. **Testing**: Use mock data on web for development

## Future Enhancements

1. **Auto-recording**: Option to automatically record trusted transactions
2. **ML Category Prediction**: Improve category suggestions using ML
3. **Balance Reconciliation**: Auto-update account balance from SMS
4. **Multi-bank Support**: Add patterns for more banks
5. **Scheduled Sync**: Background sync at intervals
6. **Conflict Resolution**: Handle duplicate detection edge cases
7. **Export/Import**: Backup and restore draft transactions

## Troubleshooting

### SMS Not Being Read
- Check SMS permissions are granted
- Verify SMS sender matches configured value
- Check SMS format matches parser patterns

### Transactions Not Matching
- Verify account number last 4 digits match
- Check transaction date/time is within matching window
- Review reference number format

### Duplicates Created
- Check if SMS ID is unique
- Verify matching logic in `isTransactionRecorded`
- Review time window for matching

## API Reference

### EnhancedSMSParser
- `parseTransaction(message, sender, smsId, timestamp)`: Parse SMS
- `matchAccount(smsAccountNumber, accounts)`: Match account
- `suggestCategory(merchant, message)`: Suggest category

### DraftTransactionService
- `getAll()`: Get all drafts
- `getByAccount(accountId)`: Get drafts for account
- `getUnrecordedByAccount(accountId)`: Get unrecorded drafts
- `add(draft)`: Add new draft
- `markAsRecorded(draftId, transactionId)`: Mark as recorded
- `delete(draftId)`: Delete draft

### SMSSyncService
- `requestPermissions()`: Request SMS permissions
- `readSMSFromSender(sender, sinceTimestamp)`: Read SMS
- `syncAccountSMS(account, transactions)`: Sync account
- `syncAllAccounts(accounts, transactions)`: Sync all accounts

## License
Part of HisabTrack - Personal Finance Tracker
