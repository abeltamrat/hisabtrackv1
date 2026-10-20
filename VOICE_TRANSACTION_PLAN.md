# Conversational transaction entry

Status: Phase 1 implementation underway. The typed conversation and evidence-review foundation is implemented; native recording remains reserved for a future APK.
Prepared: 2026-10-19.

Implemented in Phase 1: `Talk to Hisab` is available from Smart Input and as `Explain this SMS with Hisab` inside SMS confirmation. The SMS flow locks the parsed bank amount, date, fees, reference, raw message and source account while conversational answers update only the review form.

## Outcome

Let a user describe money movements naturally, answer short follow-up questions, and review transactions grounded in their accounts, People, categories, projects, and parsed SMS. The assistant helps record and classify activity; it does not initiate bank payments.

Recommended experience: a “Talk to Hisab” entry in Smart Input and Add Transaction, plus “Explain this payment” inside SMS confirmation. Use the existing Aurora appearance, an animated coin during processing, readable transcript, and a live transaction card. Show distinct Listening, Understanding, Checking SMS, Needs an answer, Ready to review, and Saved states. The listening animation must reflect actual microphone activity.

## Example conversations

1. User: “The 500 birr I sent Daniel today was for transport.” Assistant searches pending SMS and recorded transactions, finds the actual account, date, recipient and fees, and shows “Possible match: CBE, 500 birr to Daniel, today at 2:10.” User selects the match. Assistant prepares its transport classification with original bank evidence intact.
2. User: “Split that payment: 300 materials and 200 transport, both for the office project.” Assistant resolves the project, checks the split sum, and updates the proposal. User: “Actually, only materials belongs to that project.” Only that allocation changes.
3. User: “I moved 500 from CBE to Telebirr.” Matching debit and credit SMS form one transfer proposal, preserving each bank's reference and any source/destination fees. Existing recorded transfers are offered for review instead of creating another movement.
4. User: “Yesterday I spent 150 cash on lunch and 80 on a taxi.” Assistant asks whether these were separate payments if unclear, then prepares two expense cards or one split transaction accordingly.
5. User: “That 2,000 to Hana was a loan.” Assistant identifies the payment and person, then prepares a loan workflow. Reclassifying an existing movement must not debit the account a second time.
6. User: “Help me finish today's SMS.” Assistant works through pending drafts, accepts short explanations, skips uncertain entries, and shows a final batch review. Nothing is recorded just because the assistant read a message aloud.

## Repository foundation and gaps

Reuse:
- `app/smart-input.tsx`: Quick Add/receipt parsing, SMS matching, and review navigation.
- `services/InputDraftService.ts`: scoped drafts and existing input fingerprints.
- `services/FinancialAgent.ts`: tool-based ledger lookup and provider fallback.
- `services/AssistantActionService.ts`: proposal/confirmation approach; currently budgets, goals, and recurring items, not transaction execution.
- `services/DraftTransactionService.ts`: pending/recorded/rejected SMS, paired legs and recorded transaction links.
- Existing transaction, SMS, loan, community and fund validators, exact money arithmetic, People resolution and editor components.

Required additions:
- A structured, persistent conversation and transaction-proposal model.
- SMS search/matching tools; current financial-agent scope does not include SMS drafts.
- Input draft support for voice origin, person/project links, provenance and proposal versions.
- One confirmation service shared with the existing transaction/SMS flows; do not introduce a second ledger writer with different accounting rules.
- A speech provider adapter, native recording/playback capability, and explicit audio-sharing controls.

Existing unpublished SMS transfer changes must be reviewed and coordinated separately; this feature must not silently bundle another agent's work.

## Conversation behavior

- Start with tap-to-talk and short turns. Offer typing at every step and editable transcripts.
- Keep the current proposal visible while talking. Users can correct “500, not 5,000,” “use Telebirr,” “yesterday,” or “change just the second part.”
- Ask only for fields that are missing or ambiguous. Existing SMS evidence should supply bank, timestamp, reference, amounts and fees where available.
- Resolve real account, person, category-path and project IDs. Two people called Daniel or two CBE accounts require a choice, not a guessed link.
- Support contextual references such as “that payment” only when the active card makes the referent unambiguous.
- Show each field's source: user statement, SMS evidence, or suggestion. Explain discrepancies instead of silently overwriting financial evidence.
- Parse expenses, income, own-account transfers, splits, recipients, tags and deep category paths in the first release. Follow with itemized purchases, loans/repayments, recurring items, Equb/Iddir and funds.
- New categories or People are separate reviewable proposals. People creation follows the existing phone/email and duplicate rules.
- Interpret “tomorrow I will pay” as a planned item; do not record it as money already paid.
- Confirm ambiguous dates, Ethiopian/Gregorian dates, and Ethiopian/international time conventions. Use the user's timezone and display the resolved date/time.
- Keep ledger currency semantics: changing the identifier does not imply exchange-rate conversion.
- Use a visible final Save button for the first release. A later spoken “save” must refer to a specific displayed proposal version; ordinary conversational “yes” never authorizes a financial write.

## SMS-aware matching and duplicate handling

1. Obtain the latest local/cloud draft state. On the designated Android SMS device, request a safe checkpointed catch-up if needed; elsewhere use synced drafts and show their freshness. Do not claim a remote phone's inbox has been checked.
2. Search both pending SMS and recorded ledger entries using direction, account, amount, recipient, time range, reference and transfer links.
3. Build candidate rankings locally using deterministic evidence. Matching amounts alone are insufficient. AI may explain the candidates but cannot invent a match or independently supply trusted record IDs.
4. For one strong match, show its evidence and ask the user to select/use it. For several plausible matches, show a short selectable list. For none, prepare a new draft with a “No matching SMS found” explanation, not an assertion that no payment exists.
5. If a matching payment is recorded already, offer to view or enrich it. If rejected, require an explicit reopen action. Preserve original bank fields and unaffected edit fields.
6. Treat paired CBE/Telebirr messages as evidence for one movement. Reuse the transfer confirmation path, including principal, gross debit, net credit and fees.
7. Recheck evidence and duplicates immediately before saving. An SMS that arrives mid-conversation must trigger a possible-match review.
8. Use an operation ID for retries, and source-record revision checks across devices. If another phone records the SMS first, return the existing result or require a refreshed review. Do not promise offline cross-device exactly-once recording: queue unresolved source conflicts for reconciliation.

## Technical design

Flow: microphone or text -> transcript -> intent/proposed fields -> local evidence tools -> targeted follow-up -> validated proposal -> explicit confirmation -> existing domain service -> saved receipt/undo.

Proposed modules:
- `VoiceInputService`: record/stop/cancel, microphone permission, duration/size limits, interruption handling, temporary file lifecycle.
- `SpeechProvider`: transcription and optional spoken replies, with explicit provider/language capabilities. Do not assume a provider supporting chat supports audio.
- `TransactionConversationService`: dialogue state, corrections, cancellation and resumable drafts.
- `TransactionEvidenceService`: searches SMS/ledger, resolves entities, scores candidates and checks freshness.
- `TransactionProposalService`: field validation, totals, evidence revisions, operation IDs and confirmation handoff.
- `VoiceTransactionSheet`: transcript, coin activity indicator, candidate selection, follow-up chips, live preview and final review.

Candidate tools: search_sms_drafts, search_transactions, resolve_person, resolve_account, search_category_paths, search_projects, get_payment_evidence, prepare_transaction, revise_proposal, prepare_reclassification. These tools read data or prepare proposals; model output cannot call the ledger directly.

Conversation state should include session/user IDs, language, turn sequence, active proposal IDs, pending question and state. Each proposal needs operation ID, version, intent, resolved entity IDs, amounts/fees, dates, splits/items, evidence IDs/revisions and per-field provenance. Discard late provider responses from a cancelled or superseded turn. Recompute validation whenever a correction changes a dependency.

Persist structured drafts with the user's existing cloud scope, deletion and backup/restore rules. Keep audio and full conversational transcripts local/temporary by default; sync the minimal structured proposal needed to continue on another device. Lock/logout cancels recording and prevents stale responses from crossing users.

## Speech and AI choice

Start with short recorded turns -> transcription -> the existing text/tool agent -> text response. This gives a correctable transcript and lets us test transaction reasoning independently of speech quality. Spoken playback is optional. Consider full-duplex live conversation after matching and confirmation behavior are proven.

Evaluate Groq speech-to-text and Gemini audio understanding against a consented Ethiopian speech test set. The existing app has Groq/Gemini configuration, but audio capabilities, key permissions, quotas and backend routing need separate checks. Choose providers based on amount/name accuracy, latency and measured cost per successful entry, not advertised language coverage alone.

Priority languages: English, Amharic, and mixed Amharic/English with Ethiopian bank/person names. Afaan Oromo and Tigrinya should have explicit quality gates before being advertised. Readback voice availability may differ from transcription support; use text when a suitable voice is unavailable.

Keep runtime provider/model configuration replaceable. If using app-managed credentials, route through an authenticated backend with user scoping, rate limits and spending limits; never embed server credentials in the app. User-supplied keys must follow the established secure configuration policy. Never fail over financial/audio data to a provider the user has not enabled.

## Data and permission behavior

- Ask for microphone permission when the user taps the microphone. Explain audio transmission separately under AI-sharing consent.
- Record only during the visible voice session; stop on lock, logout, cancellation, backgrounding or interruption.
- Use private temporary files. No broad files/folders permission is needed for this design.
- Upload only the active utterance and minimal selected evidence. Do not send the whole inbox or address book.
- Delete temporary recordings on success/cancel and clean up abandoned files after crashes. Retaining a voice attachment would be a separate opt-in feature.
- Respect balance masking for spoken replies. Show text and offer a speak button if private amounts should not be read aloud.
- Treat SMS bodies, merchant names and transcripts as data, never as instructions that override confirmation or tool permissions.
- On network loss, preserve the draft, explain that AI is unavailable, and allow manual editing. Offline speech is conditional on the installed recognition engine and language support; it is not a baseline promise.

## Delivery checklist

### Phase 1: conversation and evidence foundation, compatible with 1.0.5 OTA
- [x] Add typed conversational entry with the same planned voice interface.
- [x] Allow the keyboard's existing dictation as an optional input method where available.
- [x] Add expense/income/transfer proposals and short follow-up questions.
- [x] Resolve saved People, accounts, category hierarchy, tags and Mela projects without inventing IDs.
- [x] Search pending/recorded SMS evidence and prevent duplicate confirmation.
- [x] Support field correction, restart, explicit review, save and safe transaction/loan undo behavior.
- [x] Route confirmed proposals through existing financial validation and saving.
- [ ] Add draft sync/revision handling and source freshness indication.

### Phase 2: native voice in a future APK
- [ ] Choose an Expo-SDK-compatible recorder and optional speech playback module; verify actual installed-binary capabilities.
- [ ] Add microphone permission, capability detection and typed fallback on older APKs.
- [ ] Implement tap-to-talk, transcript correction and spoken/text follow-ups.
- [ ] Benchmark English, Amharic and mixed speech with Ethiopian names/numbers.
- [ ] Test Android interruptions, permission denial, Bluetooth, tablets and lower-memory devices.

### Phase 3: richer conversations
- [ ] Batch-review pending SMS and prepare several independently reviewable transactions.
- [ ] Support per-split projects/tags and itemized purchases.
- [ ] Extend the implemented loan-disbursement handoff with repayment, recurring, fund and Equb/Iddir adapters.
- [ ] Learn accepted classification preferences without silently applying new financial actions.
- [ ] Evaluate low-latency continuous conversation and interruption of spoken replies.

## Acceptance scenarios

- Cash payment with no SMS; one pending SMS; multiple equal-value candidates; already recorded/rejected SMS.
- Paired transfer with different bank references and fees; only one leg present; counterpart arriving later.
- Same-name People, masked account numbers, old contact aliases, archived category/project, no configured account.
- One split payment versus several payments; incorrect split sum; correction after a follow-up; loan principal versus interest.
- “Fifteen” versus “fifty,” 500 versus 5,000, noisy audio, mixed languages, silence and interrupted recording.
- Save tapped twice; lost save response; app restarted; source edited/recorded/deleted on another device; delayed provider response after logout.
- Cloud drafts stale, SMS scan failed, phone not selected for parsing, offline/device lock/permission denial/provider quota failure.

Release gates: no silent financial writes; no duplicate posting in retry/concurrency tests; original SMS evidence preserved; accounting matches manual workflows; unresolved ambiguity shown to the user; measurable language accuracy before enabling each language. Track parsing success, corrections per transaction, matching false positives, completion latency and provider cost without logging raw audio/SMS.

## Sources checked for planning

- Expo Audio: https://docs.expo.dev/versions/latest/sdk/audio/ (recording/playback, native configuration and microphone permissions). The repository uses Expo SDK 54; select a compatible package during implementation rather than copying latest-version APIs.
- Groq speech-to-text: https://console.groq.com/docs/speech-to-text (transcription endpoint and supported audio workflows).
- Gemini audio understanding: https://ai.google.dev/gemini-api/docs/audio (audio-to-text analysis; live conversation is a separate API path).

The native voice phase requires a future APK. Phase 1 remains compatible with the installed 1.0.5 binary and can be released through the established commit, push, then clean-checkout preview OTA workflow.
