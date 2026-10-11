# Messaging and financial requests

## Product rule

A chat request records a proposal and the other person's response. Accepting a request never posts a transaction, changes a loan balance, or marks an Equb contribution as paid. The user must complete or record the real money movement in the relevant workflow.

## First release

- A message icon in the global header opens the inbox and shows the unread count.
- A conversation can start with any saved person linked to a verified HisabTrack account.
- Users can send text and six structured requests: payment, refund, loan, loan repayment, Equb payment, and Equb invitation.
- The recipient can accept or decline a pending request. The sender can cancel it.
- Amount, currency, due date, Equb name, message state, and response time remain in the audit trail.
- Firestore rules make conversations readable only by their two participants. All writes pass through a callable function that validates membership, request transitions, values, and idempotency.
- A new message creates a server-authored push job whose notification opens that conversation.

## Next releases

1. Turn an accepted request into a prefilled transaction, loan, repayment, or Equb contribution while requiring a final confirmation.
2. Connect Equb invitations to managed group membership, share allocation, and an administrator approval flow.
3. Add attachments and receipts with storage rules, size limits, malware scanning, and retention controls.
4. Add delivery/read receipts, mute, block, report, conversation archive, and abuse rate limits.
5. Add group conversations for Equb members and preserve membership history when someone leaves.
6. Add export and account-deletion handling for message records, followed by an end-to-end encryption design if cross-device key recovery can be made dependable.

## Scenarios to verify before APK release

- Offline reads use Firestore cache; sending clearly reports failure and can be retried without duplicating the message.
- Repeated taps cannot create duplicate messages or repeat a response.
- A sender cannot accept their own request, and a recipient cannot alter its amount or wording.
- Deleted, disabled, or unrelated accounts cannot open or write a conversation.
- Currency is stored with the request; later changes to the user's app currency do not rewrite the request.
- Accepting a request does not affect reports or balances until the corresponding financial record is confirmed.
