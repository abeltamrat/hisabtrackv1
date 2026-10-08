# HisabTrack smart features TODO

Updated: 2026-10-08 (Africa/Nairobi)

Status: Phases 1 and 2 complete in code and automated validation; later phases remain planned. This document merges the smart-feature proposals with the existing project capabilities. Priority is based on user value, correctness, dependencies, and implementation effort.

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
- [x] Include confirmed upcoming income; show inferred salary dates separately with confidence and a tolerance window.
- [x] Send one actionable warning per account/crossing, with cooldowns and withdrawal of obsolete warnings.
- [x] Open the forecast from the warning and explain the scheduled outflows causing the risk.
- [x] Verify transfers with fees, locked balances, missing accounts, overdue obligations, and unreliable salary history.

Done when: a scheduled obligation crossing a reserve triggers a deduplicated warning and the displayed account/date agrees with the ledger forecast. Example: "CBE may fall below ETB 500 on the 24th based on your planned payments."

### 2. Budget pace and suggested budgets — high value, medium effort

- [x] Amend existing pace warnings to use each budget's actual date range and effective rollover limit, rather than assuming the current calendar month.
- [x] Include split expenses and descendants in parent categories without overlapping totals.
- [x] Estimate the exhaustion date with elapsed-day and minimum-history safeguards.
- [x] Suggest category limits from the median of the last three complete periods; distinguish zero-spend periods from incomplete tracking.
- [x] Let users review proposed limits before saving; parent allocations must reconcile with children.
- [x] Verify weekly/monthly periods, period boundaries, zero limits, refunds, splits, and rollover.

Done when: "At this pace, Groceries may run out on the 19th" links to the exact period and spending used in the calculation; budget suggestions require confirmation.

### 3. Context-aware tags — high value, low/medium effort

- [x] Rank saved tags by chosen category/subcategory, recipient, recency, and usage frequency; use time of day only when it has enough evidence.
- [x] Include tags attached to individual splits when learning each category's associations.
- [x] Preserve search and manually entered tags; suggestions never apply tags automatically.
- [x] Use deterministic tie-breaking and an alphabetical fallback for new users.
- [x] Verify that ranking never uses another user's history or treats repeated split rows as repeated transactions.

Done when: selecting Transport can rank a frequently associated #work tag first in both manual entry and SMS split confirmation.

### 4. Smart reconciliation and balance-gap suggestions — high value, medium/high effort

- [x] Compare consecutive authoritative SMS balances with transactions in the intervening account/date window.
- [x] Fix discrepancy calculations to use gross debits, transfer destination credits, fees, and chronology rather than applying an old SMS to today's balance.
- [x] Offer possible explanations: an unrecorded draft, duplicate, omitted fee, opening-balance issue, or unexplained adjustment.
- [x] Show supporting SMS/transactions and exact gap; never infer cash withdrawal, recipient, or category as fact from a balance alone.
- [x] Prefer recording/linking an existing draft over creating a new transaction; allow an explicit balance adjustment as a separate choice.
- [x] Confirm once, preserve the source evidence, and support Undo without creating duplicate cash movements.
- [x] Verify historical imports, out-of-order SMS, paired transfers, reversals, equal-value payments, and repeated confirmation.

Done when: each proposed fix explains the gap, changes the balance only after confirmation, and reconciles to the bank balance at that historical point.

### 5. Safe-to-spend estimate — high value, medium effort; depends on 1 and 4

- [x] Show money available through a chosen payday/date after locked amounts, reserve, and planned commitments.
- [x] Avoid counting the same money twice when a loan payment, recurring rule, budget allocation, or savings commitment overlap.
- [x] Show a deduction breakdown, uncertain income separately, and unresolved balance gaps as a confidence limitation.
- [x] Verify that account totals, reserve deductions, and internal transfers reconcile.

Done when: users can inspect every deduction behind the estimate and edit the horizon or reserve.

## Phase 2 — SMS intelligence

### 6. Unusual charges and likely double debits — high value, medium effort

- [x] Build per-bank/transaction-kind charge baselines, separating service charge, VAT, disaster-recovery charge, and transfer size bands.
- [x] Flag fee changes and recipient payments outside a robust historical range only with sufficient samples.
- [x] Suggest possible duplicate debits using amount, normalized recipient, time, account, and reference evidence.
- [x] Distinguish repeated notifications for one payment from two real payments; never delete a transaction automatically.
- [x] Offer "Expected"/dismiss feedback and link the supporting records.
- [x] Verify refunds, reversals, fees that scale with amount, and legitimate repeated payments.

Done when: a flagged charge shows its baseline and why it differs, with no silent ledger mutation.

### 7. Missing or changed recurring payments — high value, medium effort

- [x] Match observed SMS/transactions to expected recurring occurrences with identity, account, amount tolerance, and date grace windows.
- [x] Warn about changed amounts and overdue expected income or bills.
- [x] Distinguish "not recorded yet" from "not received"; an absent SMS cannot prove a missing payment.
- [x] Let users confirm a new amount, skip one occurrence, pause a rule, or move its expected date.
- [x] Keep expected events distinct from bank-confirmed cash postings; reconcile scheduled/manual/SMS occurrences without posting twice.
- [x] Verify variable bills, late salary, missed imports, weekends, and overdue rules.

Done when: "Salary has not been recorded; it usually arrives by the 5th" and "Rent changed from ETB 8,000 to ETB 9,500" are supported by evidence and do not fabricate postings.

### 8. Recipient identities and aliases — medium value, medium effort

- [x] Create user-scoped recipient profiles with explicit aliases and verified phone/account hints.
- [x] Suggest merging "ABEBE K", "Abebe Kebede", and a matching identifier; require confirmation and allow unmerge.
- [x] Keep owned-account aliases separate from payee identities and handle shared names or phone numbers.
- [x] Link a unified recipient history and learned category/tag defaults without rewriting raw SMS evidence.
- [x] Verify ambiguous identities and same-day identical transfers; use stronger identity evidence to improve transfer suggestions.

Done when: confirmed aliases share history and suggestions, while ambiguous names remain separate until reviewed.

### 9. Bank/mobile-money coverage expansion — medium value, ongoing effort

- [x] Inventory existing parser coverage, including Telebirr, CBE, and other configured banks.
- [x] Collect redacted fixtures for missing formats: cash-in/out, merchant payment, reversal, bank-wallet transfer, charges, and masked accounts.
- [x] Add missing parsers and sender identification without routing an SMS to an unrelated owned account.
- [x] Verify principal, gross amount, balance, recipient, reference, charges, receipt, and duplicate handling for each supported format.

Done when: a documented coverage matrix identifies supported formats and their regression fixtures; no claim of support is based only on a bank name.

## Phase 3 — Easier input and grounded assistance

### 10. Plain-language quick add — high value, medium effort

- [x] Add a local parser for amount, account, category, recipient, date, description, tags, and multiple parts.
- [x] Support "lunch 250 cash" and "450 lunch and 150 taxi from cash" as reviewable drafts.
- [x] Reuse saved accounts, category hierarchy, and learned defaults; ask for unresolved fields and flag ambiguous amounts.
- [x] Verify locale number formats and prevent duplicate submission.

Done when: supported phrases prefill the existing editor; the user reviews the resulting transaction before saving.

### 11. Receipt photos into split drafts — medium value, high effort

- [x] Verify the existing image-picker permissions/capability and choose local or explicitly consented OCR.
- [x] Extract merchant, date, line items, discounts, subtotal, tax, fees, and total with confidence.
- [x] Match a receipt to a recorded payment or SMS draft using amount/date/recipient evidence.
- [x] Prefill category splits with individual descriptions/tags and reconcile discounts/taxes to the total.
- [x] Allow line-by-line corrections, retain attachments only by choice, and avoid recording an existing payment twice.
- [x] Verify unreadable receipts, multiple taxes, discounts, and OCR amount errors.

Done when: a reviewed receipt can enrich an existing payment or prepare a new draft, and its splits reconcile to the ledger amount.

### 12. Assistant search and confirmed actions — high value, high effort

- [x] Add structured, user-scoped read tools for transactions, recipients, categories, budgets, goals, and recurring rules.
- [x] Answer questions such as "Why did transport spending increase?" with deterministic calculations and links to supporting records.
- [x] Prepare validated actions for "cap eating-out at ETB 3,000 this month", goal creation, and recurring setup.
- [x] Display a confirmation preview before every write; route writes through the existing ledger/services and support retries and Undo.
- [x] Treat SMS/receipt text as untrusted data; it cannot authorize assistant actions.
- [x] Verify permission boundaries, hallucinated account IDs, ambiguous categories, and disabled external-AI sharing.

Done when: the assistant can search real records and propose useful actions that execute only after user confirmation.

### 13. Weekly/monthly money digest — medium value, medium effort

- [x] Combine existing daily insights into an optional period summary: category changes, fees, upcoming commitments, unresolved drafts, and discrepancies.
- [x] Compare like-for-like periods and provide enough historical context; explain changes using actual records.
- [x] Generate a local deterministic summary first; make optional AI wording subject to sharing consent.
- [x] Support quiet hours, balance masking, localized text, and one digest per completed period.

Done when: users receive an accurate, actionable period review without duplicate reminders or unexplained totals.

### 14. Savings-goal forecasts — medium value, medium effort; depends on 5

- [x] Forecast completion from actual saving history and planned contributions, with a range when income is variable.
- [x] Avoid treating internal account transfers or Equb payouts as newly earned income.
- [x] Show how upcoming obligations change the estimate; let users test a hypothetical contribution without modifying records.

Done when: a goal estimate explains its data and assumptions and hypothetical scenarios never change the ledger.

Phase 3 delivery record (2026-10-08): implementation commit `d18adb4`; 161 regression tests, TypeScript, Expo Doctor 18/18, and the production Android export passed. Preview OTA runtime `1.0.4`: update group `2c2c17ff-2b9c-453f-a8cb-81809c2124fc` ([Expo dashboard](https://expo.dev/accounts/andriondsystems/projects/hisabtrackv1/updates/2c2c17ff-2b9c-453f-a8cb-81809c2124fc)). Physical-device checks remain recorded separately because they require an installed device build and OS permission/background conditions.

## Phase 4 — Ethiopian financial workflows

### 15. Equb and Iddir — high local value, high effort

- [x] Model group, contribution schedule, member/turn information, payout date, contributions, and outstanding obligations.
- [x] Define accounting before implementing UI: Equb contributions can move cash into a tracked claim/savings asset; Iddir contributions generally represent an expense unless recoverability is explicitly recorded.
- [x] Reconcile Equb payout against the claim and remaining contributions; do not count the entire payout as income or assume it is fully earned savings.
- [x] Add contribution reminders, payout-turn tracking, partial payments, missed contributions, and early-payout remaining obligations.
- [x] Match contribution/payout SMS with reviewable links; preserve audit history, backup, and correction/Undo behavior.
- [x] Verify payout before/after all contributions, group default, fees, and reconciliation across account balances and claims.

Done when: the full group cycle reconciles cash, claims, and obligations, with clear distinction between Equb savings and Iddir spending.

### 16. Ethiopian calendar — medium/high local value, high effort

- [x] Add an optional Ethiopian display and budget calendar alongside Gregorian dates.
- [x] Keep canonical timestamps and existing ledger records intact; convert at presentation/period boundaries.
- [x] Support all 13 months, Pagume, leap years, date pickers, recurrence anchors, and exports identifying the selected calendar.
- [x] Verify conversions, timezone boundaries, short months, and budget/recurring periods with explicit calendar rules.

Done when: dates and budgets work in the chosen calendar without shifting transaction timestamps or breaking existing schedules.

## Delivery checklist for each phase

- [x] Finish the phase's ledger/behavior regression cases and TypeScript checks.
- [x] Verify new screens and notifications in light/dark themes and every supported language.
- [x] Verify isolation, backup/restore, and legacy records for added data fields.
- [x] Validate the production Android bundle and determine whether changes require OTA, a native APK, or backend deployment.
- [x] Commit/push and record the release/update ID after the feature is implemented and validated.
- [ ] Run physical Android checks for background delivery, permission denial, offline operation, and notification actions; record actual results rather than marking these complete from code inspection.

Phase 4 delivery record (2026-10-08): implementation commit `8c8fc46`; 170 regression tests, TypeScript, Expo Doctor 18/18, and the production Android export passed. Preview OTA runtime `1.0.4`: update group `3881fe39-6573-4f8f-b53c-84af3e9b0096`, Android update `01a11bbc-5f18-7be2-ba4f-743f40c40860`, iOS update `01a11bbc-5f18-788c-8032-32da523eb5be` ([Expo dashboard](https://expo.dev/accounts/andriondsystems/projects/hisabtrackv1/updates/3881fe39-6573-4f8f-b53c-84af3e9b0096)). This phase is OTA-compatible because it changes JavaScript and user-scoped stored data without changing the native runtime. Physical-device checks remain open because they require an installed build and real OS permission/background conditions.

Recommended starting sequence: 4 (reconciliation correctness), 1 (low-balance warnings), 2 (budget pace), 3 (tag ranking), then 5 (safe-to-spend). These establish trustworthy data and useful daily feedback before richer AI or group accounting.
