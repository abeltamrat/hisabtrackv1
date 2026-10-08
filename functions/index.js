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
  // Fund records belong to both people, so they are anonymised rather than deleted.
  const funds = await db.collection('sharedFunds').where('members', 'array-contains', uid).get();
  for (const item of funds.docs) {
    const fund = item.data();
    for (const [collectionName, actorField] of [['entries', 'recordedByUid'], ['changelog', 'actorUid']]) {
      const records = await item.ref.collection(collectionName).get();
      for (const record of records.docs) {
        if (record.data()[actorField] !== uid) continue;
        await record.ref.update(collectionName === 'entries' ? { recordedByUid: 'deleted-account' } : { actorUid: 'deleted-account', actorName: 'Deleted account' });
      }
    }
    const members = (fund.members || []).filter(member => member !== uid);
    if (fund.ownerUid === uid) await item.ref.update({ ownerUid: 'deleted-account', ownerName: 'Deleted account', members, invitedUid: null, inviteCode: null, status: 'CLOSED', closedAt: Date.now() });
    else if (fund.custodianUid === uid) await item.ref.update({ custodianUid: null, custodianName: 'Deleted account', formerCustodianUid: 'deleted-account', members, linkStatus: 'REJECTED', status: 'CLOSED', closedAt: Date.now() });
    else await item.ref.update({ invitedUid: null, inviteCode: null, members, linkStatus: fund.linkStatus === 'PENDING' ? 'REJECTED' : fund.linkStatus });
  }
  await db.doc(`fundLimits/${uid}`).delete();
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

// ── Shared funds ─────────────────────────────────────────────────────────────
// A fund is money a custodian holds on the owner's behalf: petty cash, a
// revolving float, or a third party paying the owner through the custodian.
// Clients only read sharedFunds; every write goes through this callable so the
// balance, role rules and audit log cannot be bypassed.
const crypto = require('crypto');
const FUND_ID = /^[A-Za-z0-9_-]{1,160}$/;
const FUND_TYPES = ['PETTY_CASH', 'REVOLVING', 'HELD_FOR_ME'];
const FUND_KINDS = ['DEPOSIT', 'SPEND', 'RETURN'];
const DEPOSIT_SOURCES = ['OWNER', 'THIRD_PARTY', 'OWNER_UNRECORDED'];
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_TTL_MS = 7 * 24 * 3600000;
const FUND_DATE_MIN = Date.UTC(2000, 0, 1);

const fundCents = value => Math.round(Number(value || 0) * 100);
const fundAmount = centsValue => centsValue / 100;
const isFundMoney = value => Number.isFinite(value) && value > 0 && value < 1e11 && Math.abs(value * 100 - Math.round(value * 100)) <= 0.0001;
const fundText = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const fundBad = message => new HttpsError('invalid-argument', message);
const fundCompact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function fundTags(tags) {
  if (tags === undefined || tags === null) return undefined;
  if (!Array.isArray(tags) || tags.length > 12) throw fundBad('Use at most 12 tags.');
  const seen = new Set(), out = [];
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40) throw fundBad('Tags must be 1-40 characters.');
    const value = fundText(tag, 40);
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out.length ? out : undefined;
}

function fundSplits(splits, amount) {
  if (splits === undefined || splits === null) return undefined;
  if (!Array.isArray(splits) || splits.length < 2 || splits.length > 20) throw fundBad('A split needs 2 to 20 parts.');
  const out = splits.map(split => {
    if (!split || typeof split.id !== 'string' || !FUND_ID.test(split.id) || !isFundMoney(split.amount) || !fundText(split.category, 80)) throw fundBad('Each split part needs an amount and a category.');
    return fundCompact({ id: split.id, amount: split.amount, category: fundText(split.category, 80), description: fundText(split.description, 200) || undefined, tags: fundTags(split.tags) });
  });
  if (out.reduce((sum, split) => sum + fundCents(split.amount), 0) !== fundCents(amount)) throw fundBad('Split amounts must equal the total.');
  return out;
}

function fundReceipt(url) {
  if (url === undefined || url === null || url === '') return undefined;
  if (typeof url !== 'string' || url.length > 2000 || !/^https:\/\/\S+$/i.test(url.trim())) throw fundBad('Receipt links must start with https://');
  return url.trim();
}

function fundCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.slice(0, 400).map(category => fundCompact({
    name: fundText(category && category.name, 80),
    parentName: fundText(category && category.parentName, 80) || undefined,
    icon: fundText(category && category.icon, 60) || 'folder',
    color: /^#[0-9A-Fa-f]{6}$/.test(category && category.color) ? category.color : '#64748b',
    type: category && category.type === 'income' ? 'income' : 'expense',
  })).filter(category => category.name);
}

function fundEmailHint(email) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

function inviteCandidates() {
  return Array.from({ length: 4 }, () => Array.from({ length: 8 }, () => INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)]).join(''));
}

async function consumeFundLimit(uid, kind, max) {
  const ref = db.doc(`fundLimits/${uid}`), now = Date.now();
  await db.runTransaction(async tx => {
    const [deleted, previous] = await Promise.all([tx.get(db.doc(`deletedAccounts/${uid}`)), tx.get(ref)]);
    if (deleted.exists) throw new HttpsError('permission-denied', 'Account is deleted.');
    const prior = previous.data() || {}, reset = now - Number(prior[`${kind}Start`] || 0) >= 3600000;
    const count = reset ? 0 : Number(prior[`${kind}Count`] || 0);
    if (count >= max) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again in an hour.');
    tx.set(ref, { ...prior, [`${kind}Count`]: count + 1, [`${kind}Start`]: reset ? now : prior[`${kind}Start`] });
  });
}

// Only an account whose email is proven (verified, or a Google sign-in) can be
// found, so nobody can claim an owner's invite by registering their address.
async function resolveFundInvitee(rawEmail, ownerUid) {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw fundBad('Enter a valid email address.');
  await consumeFundLimit(ownerUid, 'lookup', 20);
  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch (error) { if (error.code === 'auth/user-not-found') return { email, user: null }; throw error; }
  if (user.uid === ownerUid) throw fundBad('You cannot invite yourself.');
  const proven = user.emailVerified || (user.providerData || []).some(provider => provider.providerId === 'google.com');
  if (user.disabled || !proven || (await db.doc(`deletedAccounts/${user.uid}`).get()).exists) return { email, user: null };
  return { email, user: { uid: user.uid, displayName: user.displayName || 'HisabTrack user' } };
}

// Moves one entry's amount in (direction 1) or out (direction -1) of the totals
// for the given status bucket. Pending deposits only ever touch pendingIn.
function fundTotals(fund, entry, direction, status = entry.status) {
  const amount = fundCents(entry.amount) * direction;
  const next = {
    balance: fundCents(fund.balance), totalIn: fundCents(fund.totalIn), totalSpent: fundCents(fund.totalSpent),
    totalReturned: fundCents(fund.totalReturned), pendingIn: fundCents(fund.pendingIn),
  };
  if (status === 'PENDING') next.pendingIn += amount;
  else if (entry.kind === 'DEPOSIT') { next.totalIn += amount; next.balance += amount; }
  else if (entry.kind === 'SPEND') { next.totalSpent += amount; next.balance -= amount; }
  else { next.totalReturned += amount; next.balance -= amount; }
  return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, fundAmount(value)]));
}

function fundLog(tx, fundRef, uid, fund, action, entryId) {
  const now = Date.now();
  const actorName = uid === fund.ownerUid ? fund.ownerName || 'Owner' : fund.custodianName || 'Custodian';
  // The random suffix keeps two changes in the same millisecond from colliding.
  const logId = `${now}-${action.replace(/[^A-Za-z]/g, '').slice(0, 24)}-${entryId || 'fund'}-${crypto.randomBytes(4).toString('hex')}`;
  tx.create(fundRef.collection('changelog').doc(logId), fundCompact({ actorUid: uid, actorName, timestamp: now, action, entryId }));
}

function readEntryInput(data, role) {
  const kind = data.kind, amount = data.amount, date = data.date;
  if (!FUND_KINDS.includes(kind)) throw fundBad('Unknown entry type.');
  if (!isFundMoney(amount)) throw fundBad('Enter a valid amount.');
  if (!Number.isFinite(date) || date < FUND_DATE_MIN || date > Date.now() + 86400000) throw fundBad('Enter a valid date.');
  const source = kind === 'DEPOSIT' ? data.source : undefined;
  if (kind === 'DEPOSIT' && !DEPOSIT_SOURCES.includes(source)) throw fundBad('Say who the deposit came from.');
  if (kind === 'SPEND' && role !== 'CUSTODIAN') throw new HttpsError('permission-denied', 'Only the person holding the fund records payments from it.');
  if (kind === 'DEPOSIT' && source === 'OWNER' && role !== 'OWNER') throw new HttpsError('permission-denied', 'Only the owner records money they sent.');
  if (kind === 'DEPOSIT' && source !== 'OWNER' && role !== 'CUSTODIAN') throw new HttpsError('permission-denied', 'Use "Expect a deposit" for money someone else will send.');
  const ownerAccountId = data.ownerAccountId === undefined || data.ownerAccountId === null ? undefined : data.ownerAccountId;
  if (ownerAccountId !== undefined && (role !== 'OWNER' || typeof ownerAccountId !== 'string' || !FUND_ID.test(ownerAccountId))) throw fundBad('Invalid account.');
  const payerName = fundText(data.payerName, 120) || undefined;
  if (kind === 'DEPOSIT' && source === 'THIRD_PARTY' && !payerName) throw fundBad('Enter who sent the money.');
  return fundCompact({
    kind, source, amount, date,
    description: fundText(data.description, 200) || (kind === 'SPEND' ? 'Fund payment' : kind === 'RETURN' ? 'Returned to owner' : 'Fund deposit'),
    note: fundText(data.note, 500) || undefined,
    payerName,
    recipient: fundText(data.recipient, 120) || undefined,
    reference_number: fundText(data.reference_number, 80) || undefined,
    receipt_url: fundReceipt(data.receipt_url),
    sms_linked: data.sms_linked === true,
    category: kind === 'SPEND' ? fundText(data.category, 80) || 'Uncategorized' : undefined,
    splits: kind === 'SPEND' ? fundSplits(data.splits, amount) : undefined,
    tags: fundTags(data.tags),
    ownerAccountId,
  });
}

async function createSharedFund(uid, data, myName, now) {
  const fundId = data.fundId;
  if (typeof fundId !== 'string' || !FUND_ID.test(fundId)) throw fundBad('Invalid fund.');
  const name = fundText(data.name, 80);
  if (!name) throw fundBad('Give the fund a name.');
  const fundType = FUND_TYPES.includes(data.fundType) ? data.fundType : 'PETTY_CASH';
  if (typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) throw fundBad('Invalid currency.');
  const floatTarget = data.floatTarget === undefined || data.floatTarget === null ? null : data.floatTarget;
  if (floatTarget !== null && !isFundMoney(floatTarget)) throw fundBad('Enter a valid float amount.');
  const invitee = await resolveFundInvitee(data.email, uid);
  const fundRef = db.doc(`sharedFunds/${fundId}`), candidates = inviteCandidates();
  return db.runTransaction(async tx => {
    const [deleted, existing, ...codes] = await Promise.all([
      tx.get(db.doc(`deletedAccounts/${uid}`)), tx.get(fundRef), ...candidates.map(code => tx.get(db.doc(`fundInvites/${code}`))),
    ]);
    if (deleted.exists) throw new HttpsError('permission-denied', 'Account is deleted.');
    if (existing.exists) {
      const fund = existing.data();
      if (fund.ownerUid !== uid) throw new HttpsError('already-exists', 'This fund id is taken.');
      return { fundId, code: fund.inviteCode || null, found: !!fund.invitedUid, displayName: null, emailHint: fund.inviteEmailHint || null };
    }
    const free = candidates.find((_, index) => !codes[index].exists);
    if (!free) throw new HttpsError('aborted', 'Try again.');
    const invitedUid = invitee && invitee.user ? invitee.user.uid : null;
    const fund = {
      ownerUid: uid, ownerName: myName, custodianUid: null, custodianName: null,
      members: invitedUid ? [uid, invitedUid] : [uid], invitedUid,
      inviteEmailHint: invitee ? fundEmailHint(invitee.email) : null,
      inviteCode: free, inviteExpiresAt: now + INVITE_TTL_MS,
      name, fundType, currency: data.currency, floatTarget,
      lowBalancePct: Number.isInteger(data.lowBalancePct) && data.lowBalancePct >= 1 && data.lowBalancePct <= 90 ? data.lowBalancePct : 20,
      linkStatus: 'PENDING', status: 'ACTIVE',
      balance: 0, totalIn: 0, totalSpent: 0, totalReturned: 0, pendingIn: 0, entryVersion: 0,
      categories: fundCategories(data.categories), createdAt: now, updatedAt: now,
    };
    tx.create(fundRef, fund);
    tx.create(db.doc(`fundInvites/${free}`), { fundId, ownerUid: uid, expiresAt: now + INVITE_TTL_MS });
    fundLog(tx, fundRef, uid, fund, 'Fund created');
    return { fundId, code: free, found: !!invitedUid, displayName: invitee && invitee.user ? invitee.user.displayName : null, emailHint: fund.inviteEmailHint };
  });
}

async function acceptFundCode(uid, rawCode, myName, now) {
  const code = String(rawCode).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{8}$/.test(code)) throw fundBad('Invite codes have 8 letters and numbers.');
  await consumeFundLimit(uid, 'code', 10);
  const inviteRef = db.doc(`fundInvites/${code}`);
  const invite = (await inviteRef.get()).data();
  if (!invite || typeof invite.fundId !== 'string' || !FUND_ID.test(invite.fundId)) throw new HttpsError('not-found', 'That invite code is not valid.');
  const fundRef = db.doc(`sharedFunds/${invite.fundId}`);
  return db.runTransaction(async tx => {
    const [deleted, inviteSnapshot, fundSnapshot] = await Promise.all([tx.get(db.doc(`deletedAccounts/${uid}`)), tx.get(inviteRef), tx.get(fundRef)]);
    const current = inviteSnapshot.data(), fund = fundSnapshot.data();
    if (deleted.exists) throw new HttpsError('permission-denied', 'Account is deleted.');
    if (fund && fund.custodianUid === uid && fund.linkStatus === 'ACCEPTED') return { fundId: invite.fundId };
    if (!fund || !current || current.usedBy || current.expiresAt < now || fund.linkStatus !== 'PENDING' || fund.inviteCode !== code) {
      throw new HttpsError('failed-precondition', 'That invite has expired or was already used. Ask for a new code.');
    }
    if (fund.ownerUid === uid) throw new HttpsError('permission-denied', 'You cannot join your own fund.');
    tx.update(fundRef, { custodianUid: uid, custodianName: myName, members: [fund.ownerUid, uid], invitedUid: null, inviteCode: null, linkStatus: 'ACCEPTED', acceptedAt: now, updatedAt: now });
    tx.update(inviteRef, { usedBy: uid, usedAt: now });
    fundLog(tx, fundRef, uid, { ...fund, custodianName: myName }, 'Joined the fund');
    return { fundId: invite.fundId };
  });
}

const ENTRY_ACTIONS = ['record', 'announce', 'ack', 'unack', 'reject', 'classify', 'void', 'flag', 'reply', 'resolve'];

exports.mutateSharedFund = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = request.auth.uid, data = request.data || {}, action = data.action, now = Date.now();
  const myName = fundText(data.myName, 60) || fundText(request.auth.token && request.auth.token.name, 60) || 'HisabTrack user';

  if (action === 'create') return createSharedFund(uid, data, myName, now);
  if (action === 'accept' && data.code !== undefined) return acceptFundCode(uid, data.code, myName, now);

  const fundId = data.fundId, entryId = data.entryId;
  if (typeof fundId !== 'string' || !FUND_ID.test(fundId)) throw fundBad('Invalid fund.');
  const needsEntry = ENTRY_ACTIONS.includes(action);
  if (needsEntry && (typeof entryId !== 'string' || !FUND_ID.test(entryId))) throw fundBad('Invalid entry.');
  const fundRef = db.doc(`sharedFunds/${fundId}`);
  const entryRef = needsEntry ? fundRef.collection('entries').doc(entryId) : null;
  // Reads that cannot run inside the transaction (auth lookups) happen first.
  const invitee = action === 'reinvite' ? await resolveFundInvitee(data.email, uid) : null;
  const candidates = action === 'reinvite' ? inviteCandidates() : [];

  return db.runTransaction(async tx => {
    const [deleted, fundSnapshot, entrySnapshot, ...codes] = await Promise.all([
      tx.get(db.doc(`deletedAccounts/${uid}`)), tx.get(fundRef), entryRef ? tx.get(entryRef) : Promise.resolve(null),
      ...candidates.map(code => tx.get(db.doc(`fundInvites/${code}`))),
    ]);
    const fund = fundSnapshot.data();
    if (deleted.exists || !fund || !(fund.members || []).includes(uid)) throw new HttpsError('permission-denied', 'Only people in this fund can change it.');
    const role = uid === fund.ownerUid ? 'OWNER' : uid === fund.custodianUid ? 'CUSTODIAN' : 'INVITEE';
    const ownerOnly = () => { if (role !== 'OWNER') throw new HttpsError('permission-denied', 'Only the owner can do that.'); };
    const custodianOnly = () => { if (role !== 'CUSTODIAN') throw new HttpsError('permission-denied', 'Only the person holding the fund can do that.'); };
    const requireActive = () => { if (fund.linkStatus !== 'ACCEPTED' || fund.status !== 'ACTIVE') throw new HttpsError('failed-precondition', 'This fund is not active.'); };
    const entry = entrySnapshot && entrySnapshot.exists ? entrySnapshot.data() : null;
    const touch = (extra = {}) => tx.update(fundRef, { ...extra, entryVersion: Number(fund.entryVersion || 0) + 1, updatedAt: now });

    switch (action) {
      case 'accept': {
        if (role === 'CUSTODIAN' && fund.linkStatus === 'ACCEPTED') return { fundId };
        if (role !== 'INVITEE' || fund.invitedUid !== uid || fund.linkStatus !== 'PENDING') throw new HttpsError('failed-precondition', 'This invite is no longer open.');
        tx.update(fundRef, { custodianUid: uid, custodianName: myName, members: [fund.ownerUid, uid], invitedUid: null, inviteCode: null, linkStatus: 'ACCEPTED', acceptedAt: now, updatedAt: now });
        if (fund.inviteCode) tx.update(db.doc(`fundInvites/${fund.inviteCode}`), { usedBy: uid, usedAt: now });
        fundLog(tx, fundRef, uid, { ...fund, custodianUid: uid, custodianName: myName }, 'Joined the fund');
        return { fundId };
      }
      case 'decline':
      case 'cancel': {
        if (action === 'decline' && (role !== 'INVITEE' || fund.linkStatus !== 'PENDING')) throw new HttpsError('failed-precondition', 'This invite is no longer open.');
        if (action === 'cancel') {
          ownerOnly();
          if (fund.linkStatus !== 'PENDING') throw new HttpsError('failed-precondition', 'Only a pending invite can be cancelled.');
        }
        tx.update(fundRef, { members: [fund.ownerUid], invitedUid: null, inviteCode: null, linkStatus: action === 'decline' ? 'REJECTED' : 'CANCELLED', updatedAt: now });
        fundLog(tx, fundRef, uid, fund, action === 'decline' ? 'Invite declined' : 'Invite cancelled');
        return { saved: true };
      }
      case 'reinvite': {
        ownerOnly();
        if (fund.custodianUid) throw new HttpsError('failed-precondition', 'Someone already holds this fund.');
        const free = candidates.find((_, index) => !codes[index].exists);
        if (!free) throw new HttpsError('aborted', 'Try again.');
        const invitedUid = invitee && invitee.user ? invitee.user.uid : null;
        const emailHint = invitee ? fundEmailHint(invitee.email) : null;
        tx.update(fundRef, { members: invitedUid ? [uid, invitedUid] : [uid], invitedUid, inviteEmailHint: emailHint, inviteCode: free, inviteExpiresAt: now + INVITE_TTL_MS, linkStatus: 'PENDING', status: 'ACTIVE', updatedAt: now });
        tx.create(db.doc(`fundInvites/${free}`), { fundId, ownerUid: uid, expiresAt: now + INVITE_TTL_MS });
        fundLog(tx, fundRef, uid, fund, 'New invite issued');
        return { fundId, code: free, found: !!invitedUid, displayName: invitee && invitee.user ? invitee.user.displayName : null, emailHint };
      }
      case 'leave': {
        custodianOnly();
        tx.update(fundRef, { members: [fund.ownerUid], custodianUid: null, formerCustodianUid: uid, linkStatus: 'REJECTED', status: 'CLOSED', closedAt: now, updatedAt: now });
        fundLog(tx, fundRef, uid, fund, `Left the fund holding ${fundAmount(fundCents(fund.balance)).toFixed(2)}`);
        return { saved: true };
      }
      case 'update': {
        ownerOnly();
        const patch = {};
        if (data.name !== undefined) {
          const name = fundText(data.name, 80);
          if (!name) throw fundBad('Give the fund a name.');
          patch.name = name;
        }
        if (data.fundType !== undefined) {
          if (!FUND_TYPES.includes(data.fundType)) throw fundBad('Unknown fund type.');
          patch.fundType = data.fundType;
        }
        if (data.floatTarget !== undefined) {
          if (data.floatTarget !== null && !isFundMoney(data.floatTarget)) throw fundBad('Enter a valid float amount.');
          patch.floatTarget = data.floatTarget;
        }
        if (data.lowBalancePct !== undefined) {
          if (!Number.isInteger(data.lowBalancePct) || data.lowBalancePct < 1 || data.lowBalancePct > 90) throw fundBad('Alert level must be 1-90%.');
          patch.lowBalancePct = data.lowBalancePct;
        }
        if (data.categories !== undefined) patch.categories = fundCategories(data.categories);
        tx.update(fundRef, { ...patch, updatedAt: now });
        if (Object.keys(patch).some(key => key !== 'categories')) fundLog(tx, fundRef, uid, fund, 'Fund settings changed');
        return { saved: true };
      }
      case 'close':
      case 'reopen': {
        ownerOnly();
        if (action === 'reopen' && fund.linkStatus !== 'ACCEPTED') throw new HttpsError('failed-precondition', 'Invite someone to hold this fund first.');
        tx.update(fundRef, { status: action === 'close' ? 'CLOSED' : 'ACTIVE', ...(action === 'close' ? { closedAt: now } : {}), updatedAt: now });
        fundLog(tx, fundRef, uid, fund, action === 'close' ? 'Fund closed' : 'Fund reopened');
        return { saved: true };
      }
      case 'record':
      case 'announce': {
        requireActive();
        if (role === 'INVITEE') throw new HttpsError('permission-denied', 'Join the fund first.');
        if (action === 'announce') ownerOnly();
        // An expected deposit is validated as the custodian would receive it.
        const input = action === 'announce'
          ? readEntryInput({ ...data, kind: 'DEPOSIT', source: 'THIRD_PARTY', ownerAccountId: undefined }, 'CUSTODIAN')
          : readEntryInput(data, role);
        if (entry) {
          if (entry.recordedByUid !== uid || entry.kind !== input.kind || fundCents(entry.amount) !== fundCents(input.amount) || entry.source !== input.source) {
            throw new HttpsError('already-exists', 'This entry was already recorded with different details.');
          }
          return { saved: true, existing: true };
        }
        const value = { ...input, status: action === 'announce' ? 'PENDING' : 'ACTIVE', recordedByUid: uid, recordedByRole: role, createdAt: now };
        tx.create(entryRef, value);
        touch(fundTotals(fund, value, 1));
        const verb = action === 'announce' ? `Expecting ${input.amount.toFixed(2)} from ${input.payerName}`
          : `${input.kind === 'SPEND' ? 'Paid' : input.kind === 'RETURN' ? 'Returned' : 'Received'} ${input.amount.toFixed(2)}`;
        fundLog(tx, fundRef, uid, fund, verb, entryId);
        return { saved: true };
      }
      case 'ack': {
        custodianOnly();
        if (!entry || entry.kind !== 'DEPOSIT' || entry.status === 'VOIDED') throw new HttpsError('failed-precondition', 'Only an open deposit can be confirmed.');
        if (entry.ackAt) return { saved: true, existing: true };
        const evidence = fundCompact({
          reference_number: entry.reference_number || fundText(data.reference_number, 80) || undefined,
          receipt_url: entry.receipt_url || fundReceipt(data.receipt_url),
          sms_linked: entry.sms_linked === true || data.sms_linked === true,
        });
        tx.update(entryRef, { ...evidence, status: 'ACTIVE', ackByUid: uid, ackAt: now });
        if (entry.status === 'PENDING') {
          const withoutPending = { ...fund, ...fundTotals(fund, entry, -1) };
          touch(fundTotals(withoutPending, entry, 1, 'ACTIVE'));
        } else touch();
        fundLog(tx, fundRef, uid, fund, `Confirmed receiving ${Number(entry.amount).toFixed(2)}`, entryId);
        return { saved: true };
      }
      case 'unack': {
        // Undo of a confirmation: an expected deposit goes back to expected.
        custodianOnly();
        if (!entry || entry.kind !== 'DEPOSIT' || !entry.ackAt || entry.ackByUid !== uid || entry.status === 'VOIDED') return { saved: true, existing: true };
        const wasExpected = entry.recordedByRole === 'OWNER' && entry.source === 'THIRD_PARTY';
        tx.update(entryRef, { ackAt: null, ackByUid: null, ...(wasExpected ? { status: 'PENDING' } : {}) });
        if (wasExpected) {
          const withoutActive = { ...fund, ...fundTotals(fund, entry, -1, 'ACTIVE') };
          touch(fundTotals(withoutActive, entry, 1, 'PENDING'));
        } else touch();
        fundLog(tx, fundRef, uid, fund, `Undid confirming ${Number(entry.amount).toFixed(2)}`, entryId);
        return { saved: true };
      }
      case 'reject':
      case 'void': {
        if (!entry) throw new HttpsError('not-found', 'Entry not found.');
        if (entry.status === 'VOIDED') return { saved: true, existing: true };
        if (action === 'reject') {
          custodianOnly();
          if (entry.status !== 'PENDING') throw new HttpsError('failed-precondition', 'Only an expected deposit can be marked as not received.');
        } else if (entry.recordedByUid !== uid && role !== 'OWNER') {
          throw new HttpsError('permission-denied', 'Only whoever recorded it, or the owner, can void an entry.');
        }
        const reason = fundText(data.reason, 200) || (action === 'reject' ? 'Not received' : 'Voided');
        tx.update(entryRef, { status: 'VOIDED', voidReason: reason, voidedAt: now, voidedByUid: uid });
        touch(fundTotals(fund, entry, -1));
        fundLog(tx, fundRef, uid, fund, `${action === 'reject' ? 'Marked not received' : 'Voided'} ${Number(entry.amount).toFixed(2)}: ${reason}`, entryId);
        return { saved: true };
      }
      case 'classify': {
        ownerOnly();
        if (!entry || entry.status === 'VOIDED') throw new HttpsError('failed-precondition', 'Only an open entry can be classified.');
        const patch = { classifiedAt: now };
        if (data.ownerCategory !== undefined) patch.ownerCategory = data.ownerCategory === null ? null : fundText(data.ownerCategory, 80) || null;
        if (data.ownerPurpose !== undefined) {
          if (data.ownerPurpose !== null && !['OPERATING', 'FINANCING'].includes(data.ownerPurpose)) throw fundBad('Unknown treatment.');
          patch.ownerPurpose = data.ownerPurpose;
        }
        if (data.ownerSplits !== undefined) patch.ownerSplits = data.ownerSplits === null ? null : fundSplits(data.ownerSplits, entry.amount);
        if (data.ownerAccountId !== undefined) {
          if (data.ownerAccountId !== null && (typeof data.ownerAccountId !== 'string' || !FUND_ID.test(data.ownerAccountId))) throw fundBad('Invalid account.');
          patch.ownerAccountId = data.ownerAccountId;
        }
        tx.update(entryRef, patch);
        touch();
        return { saved: true };
      }
      case 'flag':
      case 'reply':
      case 'resolve': {
        if (!entry || entry.status === 'VOIDED') throw new HttpsError('failed-precondition', 'This entry is voided.');
        if (action === 'flag') {
          ownerOnly();
          const note = fundText(data.note, 500);
          if (!note) throw fundBad('Say what looks wrong.');
          tx.update(entryRef, { flag: { byUid: uid, note, at: now, resolved: false } });
        } else if (action === 'reply') {
          custodianOnly();
          const reply = fundText(data.reply, 500);
          if (!reply) throw fundBad('Write a reply.');
          if (!entry.flag || entry.flag.resolved) throw new HttpsError('failed-precondition', 'There is no open question on this entry.');
          tx.update(entryRef, { flag: { ...entry.flag, reply, repliedAt: now } });
        } else {
          ownerOnly();
          if (!entry.flag) throw new HttpsError('failed-precondition', 'There is no question on this entry.');
          tx.update(entryRef, { flag: { ...entry.flag, resolved: true, resolvedAt: now } });
        }
        touch();
        fundLog(tx, fundRef, uid, fund, action === 'flag' ? 'Asked about an entry' : action === 'reply' ? 'Answered a question' : 'Marked a question resolved', entryId);
        return { saved: true };
      }
      default:
        throw fundBad('Unknown action.');
    }
  });
});
