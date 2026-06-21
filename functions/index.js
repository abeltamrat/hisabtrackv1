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
  const dueDate = Number(loan.due_date || 0);
  if (!dueDate) return null;

  const reminderDaysBefore = Number(loan.reminderDaysBefore || 0);
  const reminderAt = new Date(dueDate);
  reminderAt.setDate(reminderAt.getDate() - reminderDaysBefore);

  if (loan.reminderTime) {
    const reminderTime = new Date(Number(loan.reminderTime));
    reminderAt.setHours(reminderTime.getHours(), reminderTime.getMinutes(), 0, 0);
  } else {
    reminderAt.setHours(9, 0, 0, 0);
  }

  return reminderAt.getTime();
}

async function getActiveDeviceTargets(userId) {
  const snapshot = await db.collection(`users/${userId}/${DEVICES_COLLECTION}`).get();

  return snapshot.docs
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
    const job = snapshot.data() || {};

    if (job.status && job.status !== 'queued') {
      logger.info('Push job already processed, skipping.', { userId, jobId, status: job.status });
      return;
    }

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

    try {
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

          if (ticket.status === 'error' && ticket.details && ticket.details.error === 'DeviceNotRegistered') {
            sendErrors.push(record);
          }
        });

        offset += chunk.length;
      }

      await persistReceiptTickets(userId, jobId, sentTickets);

      await Promise.all(
        sendErrors.map((error) => disableInvalidDevice(userId, error.deviceId, error.details && error.details.error))
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
        if (!receipt) return;

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

    const snapshot = await db
      .collectionGroup('loans')
      .where('status', '==', 'ACTIVE')
      .where('reminderEnabled', '==', true)
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
          body: `${loan.lender_borrower_name}: ${isLent ? 'Collect' : 'Pay'} $${amount} due on ${dueDate.toLocaleDateString('en-US')}.`,
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
