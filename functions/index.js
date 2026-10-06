const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');
const { logger } = require('firebase-functions');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

admin.initializeApp();

const db = admin.firestore();
const expo = new Expo();

const DEVICES_COLLECTION = 'devices';
const PUSH_JOBS_COLLECTION = 'push_jobs';
const PUSH_RECEIPTS_COLLECTION = 'push_receipts';
const LOAN_REMINDER_WINDOW_MS = 15 * 60 * 1000;
const RECEIPT_BATCH_LIMIT = 200;

function buildNotificationData(job, userId, jobId) {
  return {
    ...(job.data || {}),
    actionType: job.actionType || (job.data && job.data.actionType) || 'view_reports',
    userId,
    jobId,
  };
}

function calculateLoanReminderAt(loan) {
  // Persisted by the client as an absolute instant in the user's local timezone.
  const instant = Number(loan.reminder_at);
  return Number.isFinite(instant) && instant > 0 ? instant : null;
}

/**
 * An Expo push token identifies exactly one install, so if two accounts claim
 * the same token one of them planted it to aim notifications at someone else's
 * device. Firestore rules cannot verify token ownership (the token is not tied
 * to a Firebase identity), so the check belongs here: a contested token is
 * never delivered to.
 */
async function tokenIsExclusivelyOwned(userId, expoPushToken) {
  const claims = await db
    .collectionGroup(DEVICES_COLLECTION)
    .where('expoPushToken', '==', expoPushToken)
    .get();

  const owners = new Set(
    claims.docs
      .map((claim) => claim.ref.parent.parent && claim.ref.parent.parent.id)
      .filter(Boolean)
  );
  if (owners.size <= 1) return true;

  logger.warn('Refusing a push token claimed by more than one account.', {
    userId,
    owners: [...owners],
  });
  return false;
}

async function getActiveDeviceTargets(userId) {
  const snapshot = await db.collection(`users/${userId}/${DEVICES_COLLECTION}`).get();

  const candidates = snapshot.docs
    .map((docSnapshot) => ({
      deviceId: docSnapshot.id,
      ...docSnapshot.data(),
    }))
    .filter((device) => {
      return (
        !!device.isActive
        && !!device.notificationsEnabled
        && typeof device.expoPushToken === 'string'
        && Expo.isExpoPushToken(device.expoPushToken)
      );
    });

  const ownership = await Promise.all(
    candidates.map((device) => tokenIsExclusivelyOwned(userId, device.expoPushToken))
  );
  return candidates.filter((_, index) => ownership[index]);
}

async function disableInvalidDevice(userId, deviceId, error) {
  await db.doc(`users/${userId}/${DEVICES_COLLECTION}/${deviceId}`).set({
    expoPushToken: null,
    notificationsEnabled: false,
    isActive: false,
    lastError: error || 'DeviceNotRegistered',
    updatedAt: Date.now(),
  }, { merge: true });
}

async function persistReceiptTickets(userId, jobId, sentTickets) {
  const writes = [];

  for (const ticket of sentTickets) {
    if (!ticket.ticketId) continue;

    const receiptRef = db.doc(`users/${userId}/${PUSH_RECEIPTS_COLLECTION}/${ticket.ticketId}`);
    writes.push(receiptRef.set({
      jobId,
      deviceId: ticket.deviceId,
      expoPushToken: ticket.expoPushToken,
      status: 'pending',
      createdAt: Date.now(),
    }, { merge: true }));
  }

  await Promise.all(writes);
}

exports.sendQueuedPushNotification = onDocumentCreated(
  {
    document: `users/{userId}/${PUSH_JOBS_COLLECTION}/{jobId}`,
    region: 'us-central1',
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const { userId, jobId } = event.params;
    const jobRef = snapshot.ref;
    const job = await db.runTransaction(async transaction => {
      const current = await transaction.get(jobRef);
      const data = current.data();
      if (!data || (data.status && data.status !== 'queued')) return null;
      transaction.update(jobRef, { status: 'processing', claimedAt: Date.now() });
      return data;
    });
    if (!job) return;

    if (job.status && job.status !== 'queued') {
      logger.info('Push job already processed, skipping.', { userId, jobId, status: job.status });
      return;
    }

    try {
    const targets = await getActiveDeviceTargets(userId);
    if (targets.length === 0) {
      await jobRef.set({
        status: 'no_devices',
        processedAt: Date.now(),
        targetedDeviceCount: 0,
      }, { merge: true });
      return;
    }

    const messages = targets.map((target) => ({
      to: target.expoPushToken,
      title: job.title || 'HisabTrack',
      body: job.body || '',
      data: buildNotificationData(job, userId, jobId),
      sound: typeof job.sound === 'string' ? job.sound : 'default',
      priority: job.priority || 'high',
      ttl: typeof job.ttl === 'number' ? job.ttl : 3600,
      subtitle: job.subtitle || undefined,
      channelId: job.channelId || undefined,
    }));

    const sentTickets = [];
    const sendErrors = [];

      const chunks = expo.chunkPushNotifications(messages);
      let offset = 0;

      for (const chunk of chunks) {
        const receipts = await expo.sendPushNotificationsAsync(chunk);

        receipts.forEach((ticket, index) => {
          const target = targets[offset + index];
          const record = {
            deviceId: target.deviceId,
            expoPushToken: target.expoPushToken,
            ticketId: ticket.id || null,
            status: ticket.status,
            message: ticket.message || null,
            details: ticket.details || null,
          };
          sentTickets.push(record);

          if (ticket.status === 'error') {
            sendErrors.push(record);
          }
        });

        offset += chunk.length;
      }

      await persistReceiptTickets(userId, jobId, sentTickets);

      await Promise.all(
        sendErrors.filter(error => error.details?.error === 'DeviceNotRegistered').map((error) => disableInvalidDevice(userId, error.deviceId, error.details && error.details.error))
      );

      await jobRef.set({
        status: sendErrors.length > 0 ? 'partial_failure' : 'sent',
        processedAt: Date.now(),
        targetedDeviceCount: targets.length,
        ticketCount: sentTickets.filter((ticket) => !!ticket.ticketId).length,
        immediateErrors: sendErrors.map((error) => ({
          deviceId: error.deviceId,
          error: error.details && error.details.error ? error.details.error : error.message,
        })),
      }, { merge: true });
    } catch (error) {
      logger.error('Failed to send queued Expo push notification.', { userId, jobId, error });
      await jobRef.set({
        status: 'failed',
        processedAt: Date.now(),
        errorMessage: error && error.message ? error.message : 'Unknown Expo send error',
      }, { merge: true });
    }
  }
);

exports.processPushReceipts = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'us-central1',
  },
  async () => {
    const snapshot = await db
      .collectionGroup(PUSH_RECEIPTS_COLLECTION)
      .where('status', '==', 'pending')
      .orderBy('createdAt')
      .limit(RECEIPT_BATCH_LIMIT)
      .get();

    if (snapshot.empty) {
      logger.info('No pending Expo push receipts to process.');
      return;
    }

    const receiptDocs = snapshot.docs.map((docSnapshot) => ({
      path: docSnapshot.ref.path,
      receiptId: docSnapshot.id,
      ...docSnapshot.data(),
    }));

    const receiptIds = receiptDocs.map((doc) => doc.receiptId);
    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    for (const chunk of receiptIdChunks) {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

      await Promise.all(chunk.map(async (receiptId) => {
        const receiptDoc = receiptDocs.find((doc) => doc.receiptId === receiptId);
        if (!receiptDoc) return;

        const receipt = receipts[receiptId];
        if (!receipt) {
          if (Date.now() - Number(receiptDoc.createdAt || 0) > 24 * 60 * 60 * 1000) await db.doc(receiptDoc.path).set({ status: 'expired', checkedAt: Date.now() }, { merge: true });
          return;
        }

        const receiptRef = db.doc(receiptDoc.path);
        if (receipt.status === 'ok') {
          await receiptRef.set({
            status: 'delivered',
            checkedAt: Date.now(),
          }, { merge: true });
          return;
        }

        await receiptRef.set({
          status: 'error',
          checkedAt: Date.now(),
          error: receipt.message || receipt.details?.error || 'Unknown receipt error',
          details: receipt.details || null,
        }, { merge: true });

        if (receipt.details && receipt.details.error === 'DeviceNotRegistered') {
          const userId = receiptRef.parent.parent.id;
          await disableInvalidDevice(userId, receiptDoc.deviceId, receipt.details.error);
        }
      }));
    }
  }
);

exports.scheduleLoanReminderPushes = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'us-central1',
  },
  async () => {
    const now = Date.now();
    const windowStart = now - LOAN_REMINDER_WINDOW_MS;
    const windowEnd = now + LOAN_REMINDER_WINDOW_MS;

    // The reminder window is part of the query, not a post-filter. Reading every
    // active loan in the project every 15 minutes grows without bound and bills
    // a document read per loan; this touches only the loans actually due.
    // Needs the composite index declared in firestore.indexes.json.
    const snapshot = await db
      .collectionGroup('loans')
      .where('status', '==', 'ACTIVE')
      .where('reminderEnabled', '==', true)
      .where('reminder_at', '>=', windowStart)
      .where('reminder_at', '<=', windowEnd)
      .orderBy('reminder_at')
      .limit(500)
      .get();

    if (snapshot.empty) {
      logger.info('No active loans with reminders enabled.');
      return;
    }

    let queuedCount = 0;

    for (const loanSnapshot of snapshot.docs) {
      const loan = loanSnapshot.data();
      const parentUserRef = loanSnapshot.ref.parent.parent;
      if (!parentUserRef) continue;

      const reminderAt = calculateLoanReminderAt(loan);
      if (!reminderAt || reminderAt < windowStart || reminderAt > windowEnd) {
        continue;
      }

      const userId = parentUserRef.id;
      const dueDate = new Date(Number(loan.due_date || Date.now()));
      const amount = Number(loan.remaining_balance || 0).toFixed(2);
      const isLent = loan.type === 'LENT';
      const slotKey = Math.floor(reminderAt / LOAN_REMINDER_WINDOW_MS);
      const jobRef = db.doc(`users/${userId}/${PUSH_JOBS_COLLECTION}/loan-${loan.id}-${slotKey}`);

      try {
        await jobRef.create({
          title: `${isLent ? 'Loan Collection' : 'Debt Repayment'} Reminder`,
          body: `${loan.lender_borrower_name}: ${isLent ? 'Collect' : 'Pay'} ${loan.currency || 'ETB'} ${amount} due on ${dueDate.toLocaleDateString('en-US')}.`,
          actionType: 'view_loans',
          data: {
            actionType: 'view_loans',
            loanId: loan.id,
            reminderType: 'loan_due',
          },
          priority: 'high',
          sound: 'default',
          channelId: 'reminders',
          source: 'loan_schedule',
          status: 'queued',
          requestedAt: now,
          scheduledFor: reminderAt,
        });
        queuedCount += 1;
      } catch (error) {
        // Ignore "already exists" writes for deterministic job ids.
        logger.debug('Loan reminder push job already exists or could not be created.', {
          userId,
          loanId: loan.id,
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    logger.info('Scheduled loan reminder push jobs.', { queuedCount });
  }
);

// Recent authentication is required because this removes the sign-in identity.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
exports.deleteMyAccount = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (Date.now() / 1000 - Number(request.auth.token.auth_time || 0) > 300) throw new HttpsError('failed-precondition', 'Sign out and sign in again, then retry within five minutes.');
  const uid = request.auth.uid;
  await db.doc(`deletedAccounts/${uid}`).set({ deletedAt: admin.firestore.FieldValue.serverTimestamp() });
  const phones = await db.collection('phoneIndex').where('uid', '==', uid).get();
  await Promise.all(phones.docs.map(item => item.ref.delete()));
  for (const role of ['borrower', 'lender']) {
    const loans = await db.collection('sharedLoans').where(`${role}Uid`, '==', uid).get();
    for (const loan of loans.docs) {
      for (const [collectionName, actorField] of [['chat', 'senderUid'], ['changelog', 'actorUid'], ['repayments', 'recordedByUid']]) {
        const records = await loan.ref.collection(collectionName).get();
        for (const record of records.docs) {
          const value = record.data();
          if (value[actorField] !== uid) continue;
          if (collectionName === 'chat') await record.ref.update({ senderUid: 'deleted-account', senderName: 'Deleted account', text: '[Message removed on account deletion]', readBy: [] });
          else if (collectionName === 'changelog') await record.ref.update({ actorUid: 'deleted-account', actorName: 'Deleted account', before: {}, after: {}, action: 'Entry anonymized on account deletion' });
          else await record.ref.update({ recordedByUid: 'deleted-account' });
        }
      }
      await loan.ref.update({ [`${role}Uid`]: 'deleted-account', [`${role}Name`]: 'Deleted account', [`${role}Phone`]: '', linkStatus: 'REJECTED', description: 'Loan retained after participant deletion', ...(loan.data().initiatorUid === uid ? { initiatorUid: 'deleted-account' } : {}) });
    }
  }
  await db.doc(`lookupLimits/${uid}`).delete();
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await admin.auth().deleteUser(uid);
  return { deleted: true };
});

// Aggregate validation runs on the server so concurrent clients cannot overpay.
exports.mutateLinkedRepayment = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  const { sharedLoanId, repaymentId, action, amount, date } = request.data || {};
  if (![sharedLoanId, repaymentId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)) || !['record', 'confirm', 'reject'].includes(action)) throw new HttpsError('invalid-argument', 'Invalid repayment request.');
  const loanRef = db.doc(`sharedLoans/${sharedLoanId}`), paymentRef = loanRef.collection('repayments').doc(repaymentId);
  await db.runTransaction(async tx => {
    const [deleted, loanSnapshot, paymentSnapshot, payments] = await Promise.all([
      tx.get(db.doc(`deletedAccounts/${uid}`)), tx.get(loanRef), tx.get(paymentRef), tx.get(loanRef.collection('repayments')),
    ]);
    const loan = loanSnapshot.data(), payment = paymentSnapshot.data();
    if (deleted.exists || !loan || ![loan.borrowerUid, loan.lenderUid].includes(uid) || loan.linkStatus !== 'ACCEPTED') throw new HttpsError('permission-denied', 'Accepted participants only.');
    const start = new Date(loan.startDate), due = new Date(loan.dueDate);
    const months = Math.max(1, (due.getUTCFullYear() - start.getUTCFullYear()) * 12 + due.getUTCMonth() - start.getUTCMonth() - (due.getUTCDate() < start.getUTCDate() ? 1 : 0));
    const principal = Math.round(loan.amount * 100), interest = Math.round(loan.amount * loan.interestRate / 100 * months / 12 * 100);
    if (action === 'record') {
      if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e11 || !Number.isFinite(date) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) throw new HttpsError('invalid-argument', 'Invalid payment amount or date.');
      if (payment) {
        if (payment.recordedByUid !== uid || payment.amount !== amount) throw new HttpsError('already-exists', 'This operation has different payment details.');
        return;
      }
      const reserved = payments.docs.filter(doc => ['CONFIRMED', 'PENDING_CONFIRMATION'].includes(doc.data().status)).reduce((sum, doc) => sum + Math.round(doc.data().amount * 100), 0);
      if (!Number.isSafeInteger(principal + interest) || Math.round(amount * 100) > principal + interest - reserved) throw new HttpsError('failed-precondition', 'Payment exceeds the balance after confirmed and pending payments.');
      tx.create(paymentRef, { amount, date, recordedByUid: uid, recordedBy: uid === loan.borrowerUid ? 'BORROWER' : 'LENDER', status: 'PENDING_CONFIRMATION' });
    } else {
      if (!payment || payment.recordedByUid === uid) throw new HttpsError('permission-denied', 'Only the other participant can review a payment.');
      const status = action === 'confirm' ? 'CONFIRMED' : 'REJECTED';
      if (payment.status === status) return;
      if (payment.status !== 'PENDING_CONFIRMATION') throw new HttpsError('failed-precondition', 'Only pending payments can be reviewed.');
      const confirmed = payments.docs.filter(doc => doc.data().status === 'CONFIRMED').reduce((sum, doc) => sum + Math.round(doc.data().amount * 100), 0);
      const interestAmount = action === 'confirm' ? Math.min(Math.round(payment.amount * 100), Math.max(0, interest - confirmed)) / 100 : 0;
      tx.update(paymentRef, { status, interestAmount, [action === 'confirm' ? 'confirmedAt' : 'rejectedAt']: Date.now() });
    }
    tx.update(loanRef, { repaymentVersion: Number(loan.repaymentVersion || 0) + 1 });
    tx.create(loanRef.collection('changelog').doc(`${repaymentId}-${action}`), {
      actorUid: uid, actorName: uid === loan.borrowerUid ? loan.borrowerName || 'Borrower' : loan.lenderName || 'Lender', timestamp: Date.now(), action: `Repayment ${action}`, repaymentId,
    });
  });
  return { saved: true };
});

exports.lookupLinkedUser = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const phone = request.data?.phone, uid = request.auth.uid;
  if (typeof phone !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new HttpsError('invalid-argument', 'Use an international phone number.');
  const limitRef = db.doc(`lookupLimits/${uid}`), now = Date.now();
  await db.runTransaction(async tx => {
    const [deleted, previous] = await Promise.all([tx.get(db.doc(`deletedAccounts/${uid}`)), tx.get(limitRef)]);
    if (deleted.exists) throw new HttpsError('permission-denied', 'Account is deleted.');
    const prior = previous.data() || {}, reset = now - Number(prior.start || 0) >= 3600000;
    const count = reset ? 0 : Number(prior.count || 0);
    if (count >= 20) throw new HttpsError('resource-exhausted', 'Phone lookup limit reached. Try again later.');
    tx.set(limitRef, { count: count + 1, start: reset ? now : prior.start });
  });
  const index = await db.doc(`phoneIndex/${phone}`).get();
  if (!index.exists || typeof index.data().uid !== 'string') return null;
  let user;
  try { user = await admin.auth().getUser(index.data().uid); }
  catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
  if (user.disabled || user.phoneNumber !== phone || (await db.doc(`deletedAccounts/${user.uid}`).get()).exists) return null;
  return { uid: user.uid, displayName: user.displayName || 'Verified account' };
});

// Notification content is generated here, never accepted from the client: the
// job document is handed verbatim to Expo, so a client-supplied title/body
// combined with a planted device token would deliver arbitrary text to another
// person's device. Firestore rules deny client writes to push_jobs.
exports.sendTestPush = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid;
  if ((await db.doc(`deletedAccounts/${uid}`).get()).exists) throw new HttpsError('permission-denied', 'Account is deleted.');

  // One test push per minute is plenty and stops the endpoint being a relay.
  const limitRef = db.doc(`testPushLimits/${uid}`);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const previous = (await tx.get(limitRef)).data() || {};
    if (now - Number(previous.lastAt || 0) < 60000) {
      throw new HttpsError('resource-exhausted', 'Wait a minute before sending another test notification.');
    }
    tx.set(limitRef, { lastAt: now });
  });

  const jobRef = db.doc(`users/${uid}/${PUSH_JOBS_COLLECTION}/test-${now}`);
  await jobRef.create({
    title: 'HisabTrack test push',
    body: 'Remote push is configured. This notification was sent by your backend pipeline.',
    actionType: 'view_reports',
    data: { actionType: 'view_reports', route: '/reports', source: 'remote_test' },
    priority: 'high',
    sound: 'default',
    channelId: 'finance_alerts',
    source: 'test_callable',
    status: 'queued',
    requestedAt: now,
  });
  return { jobId: jobRef.id };
});
