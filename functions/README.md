# Remote Push Backend

This folder contains the Firebase Cloud Functions backend for server-delivered Expo push notifications.

## What It Does

- Stores Expo push tickets and processes receipts
- Sends queued push jobs from `users/{uid}/push_jobs/{jobId}`
- Creates server-side loan reminder push jobs every 15 minutes

## Collections Used

- `users/{uid}/devices/{installationId}`
  - Written by the app when a signed-in device registers its Expo push token
- `users/{uid}/push_jobs/{jobId}`
  - Created by the app for test pushes
  - Created by the backend for scheduled loan reminders
- `users/{uid}/push_receipts/{receiptId}`
  - Written by the backend after Expo returns push tickets

## Setup

1. Install the Firebase CLI and log in.
2. Select the correct Firebase project:
   - `firebase use <your-project-id>`
3. Install function dependencies:
   - `cd functions`
   - `npm install`
4. Deploy the functions:
   - `firebase deploy --only functions`

## Required Expo / EAS Setup

Remote push delivery requires native push credentials in your Expo project.

- Android:
  - Configure FCM for the Expo project
  - Upload the FCM credentials in EAS
- iOS:
  - Configure APNs for the app
  - Upload or generate the APNs key in EAS

After credentials are configured, create a new development build or production build. Expo Go is not enough for long-term remote push testing.

## How To Test

1. Sign in on a physical device build.
2. Open `Settings -> Remote Push`.
3. Tap `Register Device`.
4. Confirm the device doc and Expo push token preview appear.
5. Tap `Send Test Push`.
6. Check Firebase Functions logs and the device notification tray.

## Notes

- Loan reminder pushes are generated on the server every 15 minutes using Firestore loan records.
- SMS draft reminders remain local/background-driven because draft SMS data is not currently synced to Firestore.
