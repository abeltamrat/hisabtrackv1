# HisabTrack smart features TODO

Updated: 2026-10-08 (Africa/Nairobi)

Status: Phases 1 through 4 have a delivered baseline. Phase 5 expands Equb from a personal contribution tracker into a complete personal and group-management workflow. This document merges the smart-feature proposals with the existing project capabilities. Priority is based on user value, correctness, dependencies, and implementation effort.

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

## Phase 5 — Equb 2.0: personal tracking and group management

The delivered Phase 4 Equb is a personal tracker. This phase adds a full group ledger while keeping personal-only Equbs simple. The core rule is that people, shares, payout entitlements, rounds, and payments are separate records.

Example acceptance case: five people contribute ETB 10,000 per share each month. One person owns two shares, so the group has five members, six shares, a monthly pot of ETB 60,000, six payout entitlements, and normally six collection rounds. The double-share member owes ETB 20,000 per round and receives two ETB 60,000 entitlements, separately or together according to the group rules.

### 17. Product modes and legacy migration — required foundation

- [x] Add explicit `PERSONAL_TRACKER` and `GROUP_MANAGED` Equb modes.
- [ ] Keep the current simple flow for a user tracking an externally managed Equb.
- [ ] Add a guided full-group setup for organizers, chairpersons, secretaries, treasurers, and auditors.
- [x] Migrate existing `community_groups_v1` Equbs without losing schedules, payouts, SMS links, reminders, audit entries, or ledger transaction IDs.
- [ ] Show a review screen for legacy records whose member count, round count, or share meaning cannot be inferred safely.
- [ ] Keep Iddir behavior separate from the expanded Equb domain and avoid applying Equb payout/share rules to Iddir.

Done when: every existing Equb opens with the same financial position after migration, and new users can choose personal tracking or managed-group setup without seeing irrelevant controls.

### 18. Cycle, round, member, and share model — highest priority

- [x] Separate a permanent Equb group from its repeatable cycles.
- [x] Model collection rounds independently from members and payout events.
- [x] Give every member a stable record with name, phone, optional email, notes, status, join/leave dates, and external or linked-user identity.
- [x] Give every share a stable record with its owner, base contribution, payout entitlement, payout position, and status.
- [x] Store `memberCount`, `totalShares`, `myShares`, and base contribution per share as distinct values.
- [x] Allow one member to own multiple shares and allow share counts to vary by member.
- [x] Calculate each member's obligation as base contribution multiplied by active shares.
- [x] Calculate the expected pot from all active shares, never from the number of people alone.
- [x] Support separately paid and rule-approved combined payout entitlements without losing the underlying share-level history.
- [x] Validate that assigned member shares equal total shares and that every active share has exactly one payout entitlement per cycle.
- [x] Preserve Ethiopian and Gregorian start dates and deterministic weekly/monthly recurrence.
- [ ] Prepare recurrence for configurable intervals and explicitly defined short-month/Pagume behavior.

Done when: the five-person/six-share example produces ETB 60,000 per round, six collection rounds, ETB 20,000 due from the double-share member each round, two payout entitlements for that member, and a fully reconciling cycle.

### 19. Allocation, draw, need, and auction rules

- [ ] Support `FIXED_ORDER`, `LOTTERY`, `NEED_BASED`, `AUCTION`, and `HYBRID` allocation methods per cycle.
- [ ] Allow an unknown payout position at setup and allocate it later through a controlled event.
- [ ] Record draw candidates, exclusions, result, date, witnesses/approvers, and optional evidence.
- [ ] Support urgent-need priority with a reason and approval trail.
- [ ] Store auction bid/discount separately from gross and net payout values.
- [ ] Define how bid discounts are retained or distributed; never silently net them into unrelated values.
- [ ] Support rule-approved turn swaps, postponements, assignments, and share transfers.
- [ ] Keep the original and new entitlement owners in the audit history.
- [ ] Prevent a paid entitlement from being allocated or paid again.

Done when: every payout can be traced to a valid share entitlement and allocation decision, including draws, need-based decisions, auctions, swaps, and transfers.

### 20. Complete member contribution ledger

- [x] Generate a per-member, per-share obligation for every round.
- [x] Record full, partial, multiple-part, advance, late, third-party, and overpayments.
- [x] Allocate advance payments to explicit future obligations rather than silently consuming them.
- [x] Track unapplied credit and refunds.
- [ ] Record cash, bank, Telebirr, M-PESA, and other payment methods with references and optional receipt evidence. (Methods and references are implemented; receipt evidence remains.)
- [x] Add `ANNOUNCED`, `RECEIVED`, `VERIFIED`, `DISPUTED`, `REVERSED`, and `VOIDED` payment states.
- [ ] Distinguish a member's self-reported payment from treasurer-verified money.
- [x] Generate a unique receipt for every verified contribution.
- [ ] Show current-round due, paid, remaining, late amount, penalties, credit, and total cycle position per member. (Current-round due, paid, remaining, and status are implemented.)
- [x] Preserve original postings; corrections must use linked reversal or adjustment events.

Done when: the expected pot can be reconciled member by member and share by share, including partial payments, advances, duplicates, reversals, and overpayments.

### 21. Payout, pot reconciliation, and post-payout obligations

- [ ] Add a payout-day checklist showing expected pot, verified collections, shortage, credit used, organizer advance, expenses, discount, and payable amount. (The round-closing screen now covers the pot, collections, shortage resolution, expenses, discount, and payout method; explicit credit-use controls and a live payable total remain.)
- [x] Record gross entitlement, auction discount, fees, deductions, net payout, payment method, and reference separately. (Attachment evidence remains.)
- [ ] Support partial payouts, multiple payout transfers, combined entitlements, postponement, cancellation, and reassignment.
- [x] Require a valid allocation and recipient before payout posting.
- [x] Keep future contributions due after a member receives a payout.
- [x] Let the recipient acknowledge receipt or flag a discrepancy.
- [x] Close a round only when its collection and payout reconciliation balances or an approved shortage treatment is recorded.
- [ ] Lock closed rounds; reopen or correct them only through an authorized, audited workflow. (Closed-round locking is implemented; authorized reopening remains.)
- [ ] Support cycle completion, cancellation, and rollover into a new cycle without overwriting history. (Automatic completion is implemented; cancellation and rollover remain.)

Done when: expected pot = verified collections + approved advances/credits - refunds - approved costs - unresolved shortage, and the resulting payout is fully explained.

### 22. Arrears, penalties, guarantors, and defaults

- [x] Configure grace periods and fixed or percentage late penalties. (Repeating per-period penalties remain optional future work.)
- [x] Keep contribution principal and penalties separate.
- [x] Support documented waivers and reductions with a required reason. (Linked approver identity will be added with group roles.)
- [x] Distinguish late, missed, suspended, and defaulted states.
- [ ] Configure different consequences before and after the member has received a payout.
- [x] Add one or more guarantors to a member, including external contacts and linked users. (Payout-entitlement-specific guarantees remain.)
- [ ] Record guarantee amount/scope, acknowledgement, release, and enforcement events. (Amount and acknowledgement are implemented; release and enforcement actions remain.)
- [x] Support organizer or group advances that cover a missing member so the recipient receives the agreed pot.
- [x] Support reduced-pot acceptance when group rules allow it.
- [ ] Support exclusion from a draw, movement to a final position, replacement, share transfer, repayment plan, and settlement.
- [ ] Add a dispute record with comments, evidence, responsible officers, status, and resolution.
- [ ] Never let an automatic overdue check impose an irreversible consequence without the configured rule and required approval.

Done when: defaults before and after payout, guarantor responsibility, organizer advances, waivers, and settlements remain separately visible and reconcile to the ledger.

### 23. Linked members, invitations, and shared access

- [ ] Reuse the shared-fund email lookup, expiring one-time invite code, deep link, accept, decline, cancel, re-invite, and leave patterns.
- [ ] Allow external members with no Hisab Track account; linking later must attach to the existing member instead of creating a duplicate.
- [ ] Support many linked users in one Equb rather than the shared-fund owner/custodian pair.
- [ ] Add `MEMBER`, `TREASURER`, `SECRETARY`, `CHAIRPERSON`, `AUDITOR`, and organizer/admin permissions.
- [ ] Allow one person to hold multiple roles and make role changes auditable.
- [ ] Give ordinary members a private view of their shares, obligations, contributions, receipts, penalties, payout entitlements, and rules.
- [ ] Make group visibility configurable while protecting phone numbers, guarantor details, personal accounts, and other members' private financial data.
- [ ] Let members announce payments and let authorized officers verify them.
- [ ] Let officers record payments and let linked members acknowledge or dispute them.
- [ ] Mirror one confirmed Equb event into the group view and the member's personal ledger without creating unrelated duplicate transactions.
- [ ] Allow each linked member to select their own source or destination account without exposing their full account data to organizers.
- [ ] Handle invite expiry, replacement users, member departure, account deletion, lost devices, offline mutations, retries, and synchronization conflicts.

Done when: an organizer can invite all five members, the double-share member sees two shares and an ETB 20,000 obligation, and all parties see one consistent confirmed payment without gaining access to unrelated personal data.

### 24. Governance, rulebook, approvals, and audit

- [ ] Create a versioned rulebook covering contribution, shares, allocation, payout, penalties, grace, default, guarantors, transfers, expenses, privacy, and disputes.
- [ ] Record member acknowledgement of the applicable rulebook version.
- [ ] Preserve rule amendments and define whether they apply immediately or from a later round/cycle.
- [ ] Add configurable approval requirements for payout, allocation changes, large waivers, closed-round corrections, member removal, share transfer, and rule changes.
- [ ] Support two-person approval for high-impact operations.
- [ ] Store an append-only event log with actor, role, timestamp, before/after context, reason, related records, and operation ID.
- [ ] Make all financial and invitation mutations retry-safe and idempotent.
- [ ] Remove silent overdue-status mutation during reads; run explicit, repeatable due-status evaluation.
- [ ] Use void/reversal instead of hard deletion once a record has financial or governance history.

Done when: a reviewer can reconstruct who authorized every allocation, payout, exception, correction, and rule change without relying on mutable screen state.

### 25. Equb workspace and management screens

- [ ] Add an Equb dashboard with active cycles, current round, collection progress, next payout, arrears, approvals, and alerts.
- [ ] Add group tabs for Overview, Rounds, Members, Shares, Collections, Payouts, Rules, Ledger, Reports, and Audit.
- [x] Build a guided setup that previews member count, total shares, member obligations, pot per round, rounds, and full cycle value as inputs change.
- [ ] Add a roster editor with share allocation and validation.
- [x] Add a round collection board showing every member's due/paid/remaining state.
- [x] Add a payout allocation and closing workflow.
- [ ] Add member, share, guarantor, dispute, approval, and receipt detail screens. (Contribution receipt details are implemented.)
- [ ] Add clear personal-position cards for contributed, received, claim, remaining obligation, penalties, next due date, and payout positions.
- [ ] Keep financial amounts compatible with balance masking and avoid sensitive lock-screen content.
- [ ] Support Amharic and English terminology and messages, including customizable group wording.

Done when: organizers can run a round from collection through payout and closure, while members can understand their personal position without seeing management-only complexity.

### 26. Notifications, SMS matching, and automation

- [ ] Add reminders for upcoming contributions, grace-period expiry, arrears, draws, approvals, payouts, guarantor actions, rule changes, and cycle completion.
- [ ] Provide contribution receipt, partial-balance, penalty, payout, and statement messages.
- [ ] Match SMS to group, member, obligation, payment method, amount, date, reference, and direction with an explainable score.
- [ ] Detect duplicate SMS, duplicate payment attempts, reversals, fees, and amount/reference conflicts.
- [ ] Require review before linking ambiguous SMS or changing an obligation.
- [ ] Reconcile on app resume and SMS processing in addition to best-effort background work.
- [ ] Warn when verified collections cannot fund the expected payout.
- [ ] Add explainable collection-shortage forecasts only after enough history exists.
- [ ] Keep any member reliability indicator permission-restricted, evidence-based, and reviewable; do not expose a simplistic public score.
- [ ] Add an auditable digital-draw assistant only after allocation rules, permissions, and immutable results are complete.

Done when: automation reduces entry work without confirming money, penalizing a member, selecting a winner, or changing a payout without review and authority.

### 27. Statements, reports, exports, and backup

- [ ] Generate member statements showing obligations, payments, credits, penalties, payouts, and remaining balance.
- [ ] Generate round collection and payout reconciliation reports.
- [ ] Generate arrears, guarantor exposure, organizer advance, penalty, expense, and dispute reports.
- [ ] Generate cycle summaries with member/share allocation and final reconciliation.
- [ ] Export shareable PDF and CSV files with privacy-aware options.
- [ ] Provide printable receipts and payout confirmations with stable references.
- [ ] Include all Equb 2.0 records, evidence references, rules, and audit links in backup/restore.
- [ ] Verify restore into an empty install and migration from the Phase 4 format.

Done when: member statements and group reports agree with the same underlying events and a restored cycle retains its complete financial and audit history.

### 28. Accounting boundaries, security, and regulatory guardrails

- [ ] Keep personal Equb contributions and payouts out of ordinary expense/revenue unless an explicit fee, loss, or other operating component applies.
- [ ] Keep group cash, member receivables, payout payables, penalties, expenses, organizer advances, refunds, discounts, and corrections separately explainable.
- [ ] Enforce currency consistency and cent-accurate reconciliation across group and personal mirrors.
- [ ] Keep Hisab Track in a recordkeeping/reconciliation role for the initial release; route transfers through licensed providers rather than holding pooled funds.
- [ ] Require a separate legal and regulatory review before custody, stored balances, money transfer, payment-instrument, or automated fund-disbursement features.
- [ ] Add consent, purpose limitation, least-privilege access, secure storage, retention, export, correction, deletion, and account-removal behavior for member and guarantor data.
- [ ] Add server-enforced membership and role authorization; never rely on hidden UI controls.
- [ ] Test guessed IDs, removed members, stale invites, revoked roles, cross-group access, replayed operations, and malicious SMS/receipt content.

Done when: every financial position reconciles, every sensitive read/write is authorized on the server, and the released feature records external payments without taking custody of member funds.

### 29. Required scenario and regression matrix

- [ ] Five people with six shares, including one double-share member.
- [ ] Multiple double-share members and a member whose share count changes only between cycles.
- [ ] Separate and combined payouts for multiple entitlements.
- [ ] Fixed-order, lottery, need-based, auction, and hybrid allocation.
- [ ] Full, partial, advance, late, over-, duplicate, reversed, refunded, and third-party payments.
- [ ] Default before payout, default after payout, guarantor settlement, organizer advance, reduced pot, replacement, and share transfer.
- [ ] Member join, decline, invite expiry, leave, suspension, death/incapacity representation, and account deletion.
- [ ] Cash and SMS-linked bank/mobile-money contributions with mismatched amounts, fees, duplicate messages, and reversals.
- [ ] Payout before all contributions, remaining obligations after payout, partial payout, payout acknowledgement, and dispute.
- [ ] Ethiopian Pagume/leap boundaries, Gregorian short months, timezone boundaries, delayed background work, offline edits, and synchronization conflict.
- [ ] Rule amendment, two-person approval, unauthorized action, closed-round correction, reversal, repeated retry, backup, restore, and legacy migration.
- [ ] Invariant checks: active share allocation equals total shares; each active share has one entitlement; no entitlement is paid twice; member obligations sum to the expected pot; round reconciliation balances; group/personal mirrors reference the same event.

Done when: automated tests and physical-device checks cover the matrix, including multi-user synchronization and offline recovery, and the five-person/six-share example reconciles from setup through cycle completion.

### Phase 5 recommended implementation sequence

1. [x] Write the Equb 2.0 domain types, invariants, migration contract, and five-person/six-share tests.
2. [x] Implement group/cycle/round/member/share storage and migrate the personal tracker.
3. [ ] Implement per-member obligations, collections, receipts, payout entitlements, and reconciliation.
4. [ ] Implement allocation methods, multiple-share payouts, arrears, penalties, guarantors, and defaults.
5. [ ] Build the organizer workspace and member-facing personal view.
6. [ ] Generalize the existing shared-fund invitation foundation and add Equb roles, linked ledgers, synchronization, and approvals.
7. [ ] Add SMS matching, notifications, reports, exports, backup/restore, and smart assistance.
8. [ ] Complete the scenario matrix, security review, production build validation, staged preview OTA, and physical multi-device testing.

The earlier smart-feature starting sequence is complete. New Equb work starts with items 17 and 18 and follows the Phase 5 implementation sequence above.

## People and financial relationships — in progress

Detailed scope and implementation order: [People feature plan](docs/PEOPLE_FEATURE_PLAN.md).

- [ ] Extend recipient profiles into People with stable IDs, verified aliases/identifiers, archive/merge recovery, and reusable Employee/Family/Friend/custom groups.
- [x] Persist person references throughout transactions, SMS drafts, recurring rules, loans, community groups, and fund entries, including generated loan repayments and fund mirror rows.
- [x] Add a shared People picker to create/edit transactions, SMS confirmation, loans, recurring items, Equb members/payments, and shared-fund entries, with explicit review for ambiguous matches and Amharic-aware name matching.
- [ ] Add People/group screens, category-and-tag statements, split-aware totals, fee separation, exports, and assistant queries.
- [ ] Add salary periods, partial payments, advances, payment allocations, effective salary changes, and employee statements.
- [ ] Migrate existing profiles/history and verify cloud sync, offline behavior, backup/restore, and relationship integrity.

Initial delivery: identity/groups and manual/SMS linking, followed by person reporting, wider workflow integration, and salary tools.

Delivered baseline:

- [x] Extend the existing synced recipient profiles with person/organization metadata, reusable default/custom groups, editing, stable aliases, and archive-ready fields.
- [x] Add durable person IDs and name snapshots to transactions, SMS drafts, and recurring rules across Android and web persistence.
- [x] Add the shared keyboard-safe People picker to manual transactions and reviewed SMS confirmation, including inline person creation.
- [x] Preserve Ethiopic names during normalization, leave duplicate names ambiguous, and confirm suggested SMS links only when recording.
- [x] Add a People directory and split-aware relationship statements filtered by period, direction, parent/child category, and tag.
- [x] Prevent ambiguous legacy aliases from assigning one unlinked transaction to multiple same-name people.

## Cloud durability and disaster recovery

- [x] Synchronize every critical user-owned record. (Ledger records and categories use row-level sync; Equb/Iddir, recurring items, goals, drafts, SMS learning, and recipient profiles use versioned, hashed auxiliary datasets. The cloud-sync preference is stored separately in the online profile.)
- [x] Persist the cloud-sync choice in the authenticated user's online profile.
- [x] Pull an existing cloud ledger before seeding local changes on an empty reinstall.
- [x] Keep the app on a dedicated cloud-restore loading screen until the initial ledger restore finishes.
- [x] Show device-versus-cloud ledger counts and the last successful sync in Settings.
- [x] Add per-dataset restore counts, SHA-256 integrity checks, revisions, conflict preservation, retry behavior, and a user-visible restore report. (Dataset snapshots represent deletions explicitly through the next verified version.)
- [ ] Enable scheduled Firestore backups and point-in-time recovery, then document and test restoration into a separate database. (Idempotent daily/weekly configuration, automated checks, and a recovery runbook are complete; activation and a live isolated restore drill require Google Cloud CLI access and billing.)
- [ ] Build an authenticated, encrypted secondary-backup API for `nonstopplc.com`, with retention, monitoring, rate limits, audit logs, and restore drills.
- [ ] Store secondary backups outside the public web root and verify automatic rotation and recovery.
- [ ] Consider replacing Firebase only after the custom API passes authentication, authorization, migration, monitoring, offline-conflict, and disaster-recovery tests.

Done when: uninstalling the app, installing it on a new device, and signing into the same account restores every critical record with verified counts, while historical backups can recover from accidental deletion or corruption.
