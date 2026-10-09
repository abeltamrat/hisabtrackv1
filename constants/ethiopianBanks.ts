/**
 * Friendly-name lookup for Ethiopian bank SMS senders — not a scan target
 * list. The actual senders to scan always come from the device's own SMS
 * inbox (services/sms.getSmsWithPreview); this only turns a real sender
 * like "CBE" into a recognizable name and logo. An unmatched sender is
 * still scanned, just shown under its raw sender ID.
 *
 * Names match assets/bankLogos/et.ts's bundled logo names exactly, so a
 * match can look up a real logo; the list itself mirrors app/accounts.tsx's
 * popularBanks.ET, the app's one other curated Ethiopian bank list.
 */
export interface EthiopianBankDirectoryEntry {
  name: string;
  /** Matched case-insensitively as a substring of the real sender ID. */
  senderAliases: string[];
}

export const ETHIOPIAN_BANKS: EthiopianBankDirectoryEntry[] = [
  { name: 'Commercial Bank Of Ethiopia', senderAliases: ['cbe'] },
  { name: 'Awash Bank', senderAliases: ['awash'] },
  { name: 'Dashen Bank', senderAliases: ['dashen'] },
  { name: 'Bank Of Abyssinia', senderAliases: ['abyssinia', 'boa'] },
  { name: 'Nib International Bank', senderAliases: ['nib'] },
  { name: 'Cooperative Bank Of Oromia', senderAliases: ['oromia', 'coopbank', 'cbo'] },
  { name: 'Wegagen Bank', senderAliases: ['wegagen'] },
  { name: 'Berhan Bank', senderAliases: ['berhan'] },
  { name: 'Hibret Bank', senderAliases: ['hibret', 'unitedbank'] },
  { name: 'Zemen Bank', senderAliases: ['zemen'] },
  { name: 'telebirr', senderAliases: ['telebirr'] },
];

/** Longer aliases first, so e.g. "unitedbank" wins over a shorter false match. */
const SORTED_BANKS = [...ETHIOPIAN_BANKS].sort(
  (a, b) => Math.max(...b.senderAliases.map(s => s.length)) - Math.max(...a.senderAliases.map(s => s.length))
);

export function matchEthiopianBank(sender: string): EthiopianBankDirectoryEntry | null {
  const normalized = sender.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return null;
  return SORTED_BANKS.find(bank => bank.senderAliases.some(alias => normalized.includes(alias))) || null;
}
