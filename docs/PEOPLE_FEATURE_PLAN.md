# People and financial relationships

Status: proposed implementation plan, based on the current repository.
Requested: 2026-10-10.

## Product goal

Save the people and organizations involved in transactions once, identify them consistently throughout the app, and answer questions such as:

- How much did I send to Mr X this month?
- How much of that was Salary, Family Support, or a specific child category?
- Which payments were tagged October salary or School fees?
- What have I received from this person, and what loans remain outstanding?
- Which employees have been paid fully, partly, or not yet for a particular salary period?

A person is a separate dimension from an account, category, and tag. A transaction can be from CBE, paid to Abel, categorized as Salary, and tagged October or Project A. Groups such as Employee, Family, and Friend describe relationships; they do not replace categories or tags.

## Existing foundation and gaps

- `RecipientIdentityService` already stores user-scoped profiles with stable IDs, names, aliases, and verified hints. Reuse and migrate these profiles rather than create a second contact directory.
- Recipient profiles already participate in auxiliary Firebase sync and file backup/restore.
- Manual transactions, SMS drafts, and receipts already carry `sender_receiver`, but saved transactions do not retain the profile ID.
- Current unified history looks up aliases; a renamed or ambiguous name can therefore affect which transactions appear.
- Current name normalization strips non-Latin letters. Amharic/Ethiopic names must remain intact, and empty normalized names must never match.
- Current identity hints can include the account owner's details from an SMS. Match only verified counterparty evidence with the proper sender/receiver role. Masked account suffixes are supporting evidence, not unique identifiers.
- Identity merges currently replace profiles without durable transaction redirects. Introduce redirects and a reviewed merge/split workflow before attaching stable IDs system-wide.

## Identity and groups

- [ ] Extend existing recipient profiles into People records, preserving every existing profile ID and alias.
- [ ] Support person or organization, display name, optional phone/email, bank/mobile-money identifiers, aliases, notes, timestamps, and active/archive status.
- [ ] Support multiple identifiers per person, including provider/bank and whether the identifier was verified by the user.
- [ ] Create reusable groups: Employee, Family, Friend, Customer, Supplier, and custom groups. Permit membership in multiple groups.
- [ ] Keep organization affiliation/job title optional; an Employee membership alone does not imply a salary amount or employment contract.
- [ ] Store group membership dates so reports can distinguish current membership from membership at payment time.
- [ ] Keep private contacts independent of linked Hisab Track users. Linking an online user requires a separate explicit invitation; saving a name does not notify them.
- [ ] Archive people with financial history; preserve historical links when names or group memberships change.
- [ ] Review duplicate candidates. Preserve aliases and redirect merged IDs to the retained ID; support correcting wrongly linked transactions and undoing a merge.

## Durable transaction links

- [ ] Add optional `person_id` and `person_name_snapshot` to transactions and drafts, while retaining `sender_receiver` as the observed/raw name.
- [ ] Preserve link source: manual selection, confirmed SMS match, or reviewed historical backfill. Retain the evidence/alias used.
- [ ] Add the same optional person reference to recurring rules, loan counterparties, Equb/Iddir members/beneficiaries, and relevant fund entries.
- [ ] Ensure links survive SQLite and IndexedDB writes, ledger operations, Redux updates, sync, import, export, receipt attachment, edit, undo, and restore.
- [ ] Add person lookup indexes where measured list/report workloads need them. Audit adapter construction paths that explicitly enumerate transaction fields.
- [ ] Treat linking/relinking as metadata changes. Never debit/credit an account or create a second transaction to attach a person.
- [ ] Add a metadata-link operation for workflow-owned loan, fund, and community ledger rows without bypassing their monetary edit protections.
- [ ] Read older backups with missing person fields and resolve missing/archived references safely without losing the transaction.

## Shared transaction experience

- [ ] Add one searchable People picker used by manual New/Edit Transaction, SMS confirmation, Smart Input, receipts, recurring items, loans, fund entries, and community payment/payout forms.
- [ ] Show a selected person chip, their group badges, and a clear Change/Remove action.
- [ ] Suggest recent/frequent people and permit selecting archived people only intentionally.
- [ ] Offer inline Create person with the observed SMS name prefilled and an optional group/identifier confirmation.
- [ ] Show the person's prior category/tag defaults as suggestions that users can edit.
- [ ] Distinguish Sender for money received and Recipient for money sent. Transfers between the user's own accounts do not create an external person payment.
- [ ] Preserve selected person references when changing categories, tags, split allocations, or transaction date.

## SMS identification and save prompts

1. Parse the external counterparty name and role-specific identity evidence without replacing the original SMS text.
2. Exclude owned account names, self-transfers, bank headers, empty names, and generic labels such as Unknown.
3. If exactly one active profile has the normalized name or confirmed alias and evidence is consistent, preselect it and show the match on the confirmation form.
4. A unique full, verified counterparty identifier can identify an existing person even if spelling changes. Explain the evidence and keep the selection editable.
5. If names collide, evidence conflicts, or only fuzzy spelling/initials/masked suffixes match, ask the user to choose. Never silently merge or attach one of several candidates.
6. If no saved profile matches, offer Save this person, Link an existing person, or Continue without saving. Choosing Save collects a name and optional groups; choosing Link can offer to save the observed alias after confirmation.
7. On recording, persist the confirmed person ID with the transaction and draft record. Profile-save failures must not duplicate a financial posting; retry the contact step independently.
8. Background SMS ingestion may propose a link; it must not open UI, save a new person, or silently record an uncertain match.
9. Bulk recording asks once per distinct unknown recipient, supports a review queue, and keeps skipped identities reviewable later.

- [ ] Implement Unicode-aware English/Amharic normalization with explicit user-confirmed transliteration aliases; do not assume similar names identify the same person.
- [ ] Add matching tests for Ethiopian phone formats, identical names, initials, truncation, owned account hints, masked suffix collisions, empty names, and archived profiles.

## People workspace and statements

- [ ] Add People to navigation, with search and group filters, create/edit/archive, and a pending identity-review count.
- [ ] Person detail: sent, received, net cash flow, last interaction, transaction count, category/tag breakdowns, and dated history.
- [ ] Combine date range, person, group, direction, account, category including descendants, and tag filters with AND semantics. Make multiple-tag ANY/ALL selection explicit.
- [ ] Separate actual counterparty amount from total account debit and bank fees. Example: 1,000 sent plus 20 bank charges means 1,000 paid to the person and 1,020 cash out.
- [ ] Allocate split-category totals using the split amounts; inherit parent tags only when a split has no tags. Never count the full parent amount once per split.
- [ ] Show payment count by unique transaction ID and category-allocation count separately.
- [ ] Show refunds/reversals distinctly and allow gross versus net payment views where reversal links are confirmed.
- [ ] Separate operating payments, salary, loan principal/interest, reimbursements, and community flows. Net sent-minus-received does not establish an amount owed; only recorded obligations and loan balances do.
- [ ] Group detail: totals once per transaction, member summaries, and payment histories. When one person belongs to several groups, disclose overlap across group summaries.
- [ ] Show person chips and person filters in transaction lists/detail, reports, search, and exports.
- [ ] Respect balance masking; generate selected-person CSV/PDF statements with category, tag, period, and account filters.
- [ ] Add local assistant queries such as "How much did I pay Abel for salary tagged October?" using the same report calculation. Ambiguous names require choosing a person.

## Employee salary and payment tracking

- [ ] Start with salary recordkeeping: employee person, salary schedule, pay period, expected amount, category/tags, account, and Gregorian/Ethiopian calendar selection.
- [ ] Store salary obligations separately from actual payments. Mark unpaid, partial, paid, overdue, and overpaid based on confirmed payment allocations.
- [ ] Link cash/SMS/recurring payments to an employee and salary period after review. Receiving an SMS or creating a recurring expectation alone does not mark a salary paid.
- [ ] Support salary, bonus, allowance, reimbursement, and advance as distinct payment purposes. Being in Employee must not classify every payment as salary.
- [ ] Preserve salary-rate changes by effective date so changing next month's salary does not rewrite previous periods.
- [ ] Allocate a payment across multiple salary periods or a period across several payments, with exact reconciliation and stable operation IDs.
- [ ] Record advances and approved deductions separately, with explicit allocations and audit history; do not infer legal deductions automatically.
- [ ] Show an employee payment calendar and monthly employee/group report, with overdue reminders and receipt/payslip export.
- [ ] Record existing external payments only. Sending bank payments or statutory tax/pension payroll calculation is a separate future feature with its own confirmed scope.

## Migration, sync, backup, and recovery

- [ ] Migrate recipient profiles into People without changing profile IDs. Add groups and optional fields with deterministic defaults.
- [ ] Preview historical unlinked-name candidates with transaction counts before applying reviewed metadata links. Do not rewrite raw names or silently auto-merge historical identities.
- [ ] Keep linked records available offline and scoped to the signed-in user.
- [ ] Extend cloud sync/backup validation to groups, person links/redirects, salary obligations, and payment allocations. Preserve cloud-sync preferences and owner-only access.
- [ ] Resolve edits to identity aliases, merges, archive status, and group membership without overwriting concurrent changes or reviving deleted profiles.
- [ ] Evaluate record-level sync for expanded People data; current recipient profiles use a single dataset document with a size limit.
- [ ] Verify reinstalls/new-device restores with per-dataset counts and relationship integrity; tolerate records arriving before their People documents.
- [ ] Export original names plus person IDs/snapshots for portable history; document contact deletion/anonymization behavior while preserving ledger entries.

## Delivery order and acceptance scenarios

1. Identity foundation: profile migration, groups, Unicode normalization, stable transaction IDs, reviewed merge redirects, persistence and backup round trips.
2. Daily use: People workspace, shared picker, manual entry and SMS confirmation, save-unknown prompt, historical linking review.
3. Visibility: statements, split-aware category/tag/group reporting, transaction/report filters, exports, local assistant lookup.
4. System-wide links: recurring payments, loans, Equb/Iddir, petty cash/revolving funds, receipts, and workflow-owned ledger metadata.
5. Employee tools: salary periods, allocations, partial/advance payments, reminders, and statements.

Required acceptance examples:

- Mr X has 1,000 Salary tagged October and 300 Family Support tagged School: Salary + October reports 1,000; the total sent is 1,300.
- A 1,000 split payment assigns 700 Salary and 300 Reimbursement: category filters show 700/300, total sent stays 1,000, and payment count is one.
- A 1,000 payment with 20 bank charges shows 1,000 to the person and 20 to the bank.
- Two people share a name: SMS confirmation requires identity choice; aliases and financial history remain separate.
- An Amharic name stays searchable and never turns into an empty-name match.
- Renaming or archiving a person keeps already linked history available.
- A verified alias links SMS to a saved employee; an unknown recipient offers save/link/skip once per recipient.
- An internal CBE-to-Telebirr transfer does not count as money sent to the account owner.
- A 10,000 salary obligation with 6,000 and 4,000 confirmed payments becomes fully paid; an advance remains separate until explicitly allocated.
- Retrying a save, changing an identity link, merging profiles, and restoring a backup do not change account balances or duplicate salary payments.
- Uninstall/reinstall restores People, groups, links, redirects, salary periods, and allocations with matching counts.

Recommended starting scope: stages 1 and 2, establishing reliable identities and manual/SMS transaction links before expanding reporting and salary tools. All expansion checkboxes remain pending.
