# HisabTrack SMS coverage matrix

Coverage means that a redacted regression fixture verifies the listed fields. A sender or bank name alone is not treated as format support. Unknown wording may use the conservative generic amount grammar, but remains a reviewable draft.

| Source | Verified formats | Verified fields | Fixture location |
|---|---|---|---|
| Commercial Bank of Ethiopia (CBE) | account transfer, incoming credit, cash withdrawal, reversal/refund wording | principal, gross debit, balance, recipient, masked account suffix, reference, service charge, VAT, disaster-recovery charge, receipt URL | `tests/audit-regressions.cjs`, `tests/phase2-regressions.cjs` |
| Telebirr | person transfer, merchant payment, package payment, cash-in/credit, cash-out/withdrawal, loan disbursement/repayment, bank-wallet transfer | principal, balance, recipient, phone/account hint, reference, fee, receipt URL, direction | `tests/audit-regressions.cjs`, `tests/phase2-regressions.cjs` |
| Bank of Abyssinia | debit, credit, transfer | principal, balance, recipient, masked account suffix, URL reference and receipt | `tests/audit-regressions.cjs`, `tests/phase2-regressions.cjs` |
| Awash Bank | credit, withdrawal, own/other-bank transfer | principal, balance, recipient, account suffix, reference, fee, VAT, receipt | `tests/audit-regressions.cjs`, `tests/phase2-regressions.cjs` |
| Dashen Bank | debit, credit, transfer | principal, balance, account suffix, reference, fee and VAT when present | `tests/phase2-regressions.cjs` |
| Other senders | conservative generic credit, debit, withdrawal, transfer and reversal wording | principal, direction, common balance/reference/fee fields when explicit | `tests/phase2-regressions.cjs` |

## Routing safeguards

- A parsed account suffix with at least four visible digits must match the configured owned account.
- A shared sender cannot claim an SMS for one account when another configured account has the matching suffix.
- Paired bank-to-wallet SMS records remain separate evidence until the user confirms a transfer.
- SMS IDs, references and receipt URLs prevent importing the same evidence twice. Similar debits remain visible and are only suggested for review.

## Known limits

- An absent SMS does not prove that a payment failed.
- Ambiguous names do not become one recipient until the user confirms a merge.
- A generic parse is always a draft; it is not a claim that every format from that institution is supported.
- Dates or balances omitted by the sender cannot be reconstructed from the message.
