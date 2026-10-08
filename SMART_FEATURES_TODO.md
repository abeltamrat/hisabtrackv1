# HisabTrack smart features TODO

Updated: 2026-10-08 (Africa/Nairobi)

Status: Phase 1 in progress; unchecked items are not implemented or verified complete. This document merges the smart-feature proposals with the existing project capabilities. Priority is based on user value, correctness, dependencies, and implementation effort.

## Existing foundation

- SMS parsing and learned categories, transaction types, split ratios, split descriptions/tags, and owned-account transfer routes.
- Transfer pairing and review suggestions, SMS balances, receipt links, and itemized CBE charges.
- Recurring pattern suggestions, recurring schedules, local reminders, and notification Snooze.
- Cash-flow forecasts in `services/ForecastService.ts`; logging-habit reminders in `services/SmartReminderService.ts`.
- Budget metrics and rollover in `services/BudgetService.ts`; basic pace warnings in `services/AppNotificationService.ts`.
- Hierarchical category selection and per-split tag selection. `components/TagInputField.tsx` currently sorts saved tags alphabetically.
- Telebirr parsing already exists in `utils/enhancedSMSParser.ts`; mobile-money work should extend coverage and verify formats.
- AI chat currently uses a financial snapshot; an action workflow is a separate feature.

## Rules for every feature

- Use account currency and cent-accurate ledger arithmetic. Internal transfer principal is not operating income/expense; transfer fees are expenses.
- Count split allocations once, roll children into parents once, and distinguish adjustments and loan principal from operating activity.
- Explain suggestions with the relevant transactions, dates, assumptions, and confidence. Sparse history must produce an insufficient-data state.
- Financial writes require a reviewable confirmation and retry-safe operation IDs. A guessed expense, recipient merge, or assistant response must not silently change balances.
- Keep learning and deterministic analysis on-device where practical. External AI/OCR needs the existing sharing consent and minimal required data.
- Respect user scope, notification preferences, balance masking, quiet hours, localization, and backup/restore. Do not expose private details on the lock screen when amounts are hidden.
- Treat Android background checks as best-effort: also reconcile on app resume and SMS processing. Do not promise exact background execution times.

## Phase 1 — Trustworthy warnings and faster entry

### 1. Forecast low-balance warnings — high value, medium effort

- [x] Add a configurable reserve threshold per account and a forecast horizon.
- [x] Extend forecasts with per-account daily balances; the existing forecast has total daily snapshots and final account projections.
- [x] Check for the first projected threshold crossing using `ForecastService`, `SmartReminderService`, and existing background maintenance.
- [ ] Include confirmed upcoming income; show inferred salary dates separately with confidence and a tolerance window.
- [ ] Send one actionable warning per account/crossing, with cooldowns and withdrawal of obsolete warnings.
- [x] Open the forecast from the warning and explain the scheduled outflows causing the risk.
- [ ] Verify transfers with fees, locked balances, missing accounts, overdue obligations, and unreliable salary history.

Done when: a scheduled obligation crossing a reserve triggers a deduplicated warning and the displayed account/date agrees with the ledger forecast. Example: "CBE may fall below ETB 500 on the 24th based on your planned payments."

### 2. Budget pace and suggested budgets — high value, medium effort

- [x] Amend existing pace warnings to use each budget's actual date range and effective rollover limit, rather than assuming the current calendar month.
- [ ] Include split expenses and descendants in parent categories without overlapping totals.
- [x] Estimate the exhaustion date with elapsed-day and minimum-history safeguards.
- [x] Suggest category limits from the median of the last three complete periods; distinguish zero-spend periods from incomplete tracking.
- [ ] Let users review proposed limits before saving; parent allocations must reconcile with children. (Review is implemented; parent/child reconciliation remains.)
- [ ] Verify weekly/monthly periods, period boundaries, zero limits, refunds, splits, and rollover.

Done when: "At this pace, Groceries may run out on the 19th" links to the exact period and spending used in the calculation; budget suggestions require confirmation.

### 3. Context-aware tags — high value, low/medium effort

- [x] Rank saved tags by chosen category/subcategory, recipient, recency, and usage frequency; use time of day only when it has enough evidence.
- [x] Include tags attached to individual splits when learning each category's associations.
- [x] Preserve search and manually entered tags; suggestions never apply tags automatically.
- [x] Use deterministic tie-breaking and an alphabetical fallback for new users.
- [x] Verify that ranking never uses another user's history or treats repeated split rows as repeated transactions.

Done when: selecting Transport can rank a frequently associated #work tag first in both manual entry and SMS split confirmation.

### 4. Smart reconciliation and balance-gap suggestions — high value, medium/high effort

- [ ] Compare consecutive authoritative SMS balances with transactions in the intervening account/date window.
- [x] Fix discrepancy calculations to use gross debits, transfer destination credits, fees, and chronology rather than applying an old SMS to today's balance.
- [ ] Offer possible explanations: an unrecorded draft, duplicate, omitted fee, opening-balance issue, or unexplained adjustment.
- [ ] Show supporting SMS/transactions and exact gap; never infer cash withdrawal, recipient, or category as fact from a balance alone. (Exact gap and safe wording are implemented; the supporting-record list remains.)
- [ ] Prefer recording/linking an existing draft over creating a new transaction; allow an explicit balance adjustment as a separate choice.
- [x] Confirm once, preserve the source evidence, and support Undo without creating duplicate cash movements.
- [ ] Verify historical imports, out-of-order SMS, paired transfers, reversals, equal-value payments, and repeated confirmation.

Done when: each proposed fix explains the gap, changes the balance only after confirmation, and reconciles to the bank balance at that historical point.

### 5. Safe-to-spend estimate — high value, medium effort; depends on 1 and 4

- [x] Show money available through a chosen payday/date after locked amounts, reserve, and planned commitments.
- [ ] Avoid counting the same money twice when a loan payment, recurring rule, budget allocation, or savings commitment overlap.
- [ ] Show a deduction breakdown, uncertain income separately, and unresolved balance gaps as a confidence limitation. (The reserve/locked/schedule/loan breakdown is implemented; inferred income and live unresolved-gap counts remain.)
- [ ] Verify that account totals, reserve deductions, and internal transfers reconcile.

Done when: users can inspect every deduction behind the estimate and edit the horizon or reserve.

## Phase 2 — SMS intelligence

### 6. Unusual charges and likely double debits — high value, medium effort

- [ ] Build per-bank/transaction-kind charge baselines, separating service charge, VAT, disaster-recovery charge, and transfer size bands.
- [ ] Flag fee changes and recipient payments outside a robust historical range only with sufficient samples.
- [ ] Suggest possible duplicate debits using amount, normalized recipient, time, account, and reference evidence.
- [ ] Distinguish repeated notifications for one payment from two real payments; never delete a transaction automatically.
- [ ] Offer "Expected"/dismiss feedback and link the supporting records.
- [ ] Verify refunds, reversals, fees that scale with amount, and legitimate repeated payments.

Done when: a flagged charge shows its baseline and why it differs, with no silent ledger mutation.

### 7. Missing or changed recurring payments — high value, medium effort

- [ ] Match observed SMS/transactions to expected recurring occurrences with identity, account, amount tolerance, and date grace windows.
- [ ] Warn about changed amounts and overdue expected income or bills.
- [ ] Distinguish "not recorded yet" from "not received"; an absent SMS cannot prove a missing payment.
- [ ] Let users confirm a new amount, skip one occurrence, pause a rule, or move its expected date.
- [ ] Keep expected events distinct from bank-confirmed cash postings; reconcile scheduled/manual/SMS occurrences without posting twice.
- [ ] Verify variable bills, late salary, missed imports, weekends, and overdue rules.

Done when: "Salary has not been recorded; it usually arrives by the 5th" and "Rent changed from ETB 8,000 to ETB 9,500" are supported by evidence and do not fabricate postings.

### 8. Recipient identities and aliases — medium value, medium effort

- [ ] Create user-scoped recipient profiles with explicit aliases and verified phone/account hints.
- [ ] Suggest merging "ABEBE K", "Abebe Kebede", and a matching identifier; require confirmation and allow unmerge.
- [ ] Keep owned-account aliases separate from payee identities and handle shared names or phone numbers.
- [ ] Link a unified recipient history and learned category/tag defaults without rewriting raw SMS evidence.
- [ ] Verify ambiguous identities and same-day identical transfers; use stronger identity evidence to improve transfer suggestions.

Done when: confirmed aliases share history and suggestions, while ambiguous names remain separate until reviewed.

### 9. Bank/mobile-money coverage expansion — medium value, ongoing effort

- [ ] Inventory existing parser coverage, including Telebirr, CBE, and other configured banks.
- [ ] Collect redacted fixtures for missing formats: cash-in/out, merchant payment, reversal, bank-wallet transfer, charges, and masked accounts.
- [ ] Add missing parsers and sender identification without routing an SMS to an unrelated owned account.
- [ ] Verify principal, gross amount, balance, recipient, reference, charges, receipt, and duplicate handling for each supported format.

Done when: a documented coverage matrix identifies supported formats and their regression fixtures; no claim of support is based only on a bank name.

## Phase 3 — Easier input and grounded assistance

### 10. Plain-language quick add — high value, medium effort

- [ ] Add a local parser for amount, account, category, recipient, date, description, tags, and multiple parts.
- [ ] Support "lunch 250 cash" and "450 lunch and 150 taxi from cash" as reviewable drafts.
- [ ] Reuse saved accounts, category hierarchy, and learned defaults; ask for unresolved fields and flag ambiguous amounts.
- [ ] Verify locale number formats and prevent duplicate submission.

Done when: supported phrases prefill the existing editor; the user reviews the resulting transaction before saving.

### 11. Receipt photos into split drafts — medium value, high effort

- [ ] Verify the existing image-picker permissions/capability and choose local or explicitly consented OCR.
- [ ] Extract merchant, date, line items, discounts, subtotal, tax, fees, and total with confidence.
- [ ] Match a receipt to a recorded payment or SMS draft using amount/date/recipient evidence.
- [ ] Prefill category splits with individual descriptions/tags and reconcile discounts/taxes to the total.
- [ ] Allow line-by-line corrections, retain attachments only by choice, and avoid recording an existing payment twice.
- [ ] Verify unreadable receipts, multiple taxes, discounts, and OCR amount errors.

Done when: a reviewed receipt can enrich an existing payment or prepare a new draft, and its splits reconcile to the ledger amount.

### 12. Assistant search and confirmed actions — high value, high effort

- [ ] Add structured, user-scoped read tools for transactions, recipients, categories, budgets, goals, and recurring rules.
- [ ] Answer questions such as "Why did transport spending increase?" with deterministic calculations and links to supporting records.
- [ ] Prepare validated actions for "cap eating-out at ETB 3,000 this month", goal creation, and recurring setup.
- [ ] Display a confirmation preview before every write; route writes through the existing ledger/services and support retries and Undo.
- [ ] Treat SMS/receipt text as untrusted data; it cannot authorize assistant actions.
- [ ] Verify permission boundaries, hallucinated account IDs, ambiguous categories, and disabled external-AI sharing.

Done when: the assistant can search real records and propose useful actions that execute only after user confirmation.

### 13. Weekly/monthly money digest — medium value, medium effort

- [ ] Combine existing daily insights into an optional period summary: category changes, fees, upcoming commitments, unresolved drafts, and discrepancies.
- [ ] Compare like-for-like periods and provide enough historical context; explain changes using actual records.
- [ ] Generate a local deterministic summary first; make optional AI wording subject to sharing consent.
- [ ] Support quiet hours, balance masking, localized text, and one digest per completed period.

Done when: users receive an accurate, actionable period review without duplicate reminders or unexplained totals.

### 14. Savings-goal forecasts — medium value, medium effort; depends on 5

- [ ] Forecast completion from actual saving history and planned contributions, with a range when income is variable.
- [ ] Avoid treating internal account transfers or Equb payouts as newly earned income.
- [ ] Show how upcoming obligations change the estimate; let users test a hypothetical contribution without modifying records.

Done when: a goal estimate explains its data and assumptions and hypothetical scenarios never change the ledger.

## Phase 4 — Ethiopian financial workflows

### 15. Equb and Iddir — high local value, high effort

- [ ] Model group, contribution schedule, member/turn information, payout date, contributions, and outstanding obligations.
- [ ] Define accounting before implementing UI: Equb contributions can move cash into a tracked claim/savings asset; Iddir contributions generally represent an expense unless recoverability is explicitly recorded.
- [ ] Reconcile Equb payout against the claim and remaining contributions; do not count the entire payout as income or assume it is fully earned savings.
- [ ] Add contribution reminders, payout-turn tracking, partial payments, missed contributions, and early-payout remaining obligations.
- [ ] Match contribution/payout SMS with reviewable links; preserve audit history, backup, and correction/Undo behavior.
- [ ] Verify payout before/after all contributions, group default, fees, and reconciliation across account balances and claims.

Done when: the full group cycle reconciles cash, claims, and obligations, with clear distinction between Equb savings and Iddir spending.

### 16. Ethiopian calendar — medium/high local value, high effort

- [ ] Add an optional Ethiopian display and budget calendar alongside Gregorian dates.
- [ ] Keep canonical timestamps and existing ledger records intact; convert at presentation/period boundaries.
- [ ] Support all 13 months, Pagume, leap years, date pickers, recurrence anchors, and exports identifying the selected calendar.
- [ ] Verify conversions, timezone boundaries, short months, and budget/recurring periods with explicit calendar rules.

Done when: dates and budgets work in the chosen calendar without shifting transaction timestamps or breaking existing schedules.

## Delivery checklist for each phase

- [ ] Finish the phase's ledger/behavior regression cases and TypeScript checks.
- [ ] Verify new screens and notifications in light/dark themes and every supported language.
- [ ] Verify isolation, backup/restore, and legacy records for added data fields.
- [ ] Validate the production Android bundle and determine whether changes require OTA, a native APK, or backend deployment.
- [ ] Commit/push and record the release/update ID after the feature is implemented and validated.
- [ ] Run physical Android checks for background delivery, permission denial, offline operation, and notification actions; record actual results rather than marking these complete from code inspection.

Recommended starting sequence: 4 (reconciliation correctness), 1 (low-balance warnings), 2 (budget pace), 3 (tag ranking), then 5 (safe-to-spend). These establish trustworthy data and useful daily feedback before richer AI or group accounting.
