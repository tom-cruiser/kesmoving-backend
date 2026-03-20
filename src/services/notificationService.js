const nodemailer = require('nodemailer');
const Notification = require('../models/Notification');
const User = require('../models/User');
const logger = require('../utils/logger');

// Initialize email transporter
let transporter;
if (process.env.SMTP_HOST && process.env.SMTP_PASS !== 'your_sendgrid_api_key') {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// SMS via Twilio (optional)
let twilioClient;
try {
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_ACCOUNT_SID !== 'your_twilio_account_sid'
  ) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch {
  logger.warn('Twilio not configured');
}

/**
 * Create an in-app notification and optionally send email/SMS
 */
async function createNotification(recipientId, type, title, message, data = {}, channels = {}) {
  try {
    const notification = await Notification.create({
      recipient: recipientId,
      type,
      title,
      message,
      data,
      channels: { inApp: true, email: channels.email || false, sms: channels.sms || false },
      booking: data.bookingId || null,
    });

    // Send email if opted in and transporter available
    if (channels.email && transporter) {
      await sendEmail(channels.emailAddress, title, message, data).catch((e) =>
        logger.error(`Email failed to ${channels.emailAddress}: ${e.message}`)
      );
    }

    // Send SMS if opted in and Twilio available
    if (channels.sms && twilioClient && channels.phone) {
      await twilioClient.messages
        .create({ body: `Kesmoving: ${message}`, from: process.env.TWILIO_PHONE_NUMBER, to: channels.phone })
        .catch((e) => logger.error(`SMS failed to ${channels.phone}: ${e.message}`));
    }

    return notification;
  } catch (err) {
    logger.error(`Notification creation failed: ${err.message}`);
  }
}

async function sendEmail(to, subject, text, data = {}) {
  if (!transporter) return;
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Kesmoving'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    text,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#2563eb">Kesmoving</h2>
      <p>${text}</p>
      ${data.bookingNumber ? `<p><strong>Booking:</strong> ${data.bookingNumber}</p>` : ''}
      <hr/><p style="font-size:12px;color:#6b7280">Kesmoving Inc. — Canadian Moving Company</p>
    </div>`,
  });
}

function getChannels(user) {
  const prefs = user.notificationPreferences || {};
  return {
    email: prefs.email !== false,
    sms: prefs.sms !== false,
    emailAddress: user.email,
    phone: user.phone,
  };
}

async function sendBookingStatusNotification(booking, status, changedBy) {
  const client = booking.client;
  if (!client) return;

  const messages = {
    Confirmed: `Your booking ${booking.bookingNumber} has been confirmed! We'll assign a crew soon.`,
    Scheduled: `Your move on ${new Date(booking.moveDate).toLocaleDateString('en-CA')} has been scheduled. A crew has been assigned.`,
    InProgress: `Your move is now in progress! Track your truck in real-time from the app.`,
    Completed: `Your move has been completed! We'd love your feedback — please leave a review.`,
    Cancelled: `Your booking ${booking.bookingNumber} has been cancelled.`,
  };

  const titles = {
    Confirmed: 'Booking Confirmed',
    Scheduled: 'Move Scheduled',
    InProgress: 'Move Started',
    Completed: 'Move Completed',
    Cancelled: 'Booking Cancelled',
  };

  const typeMap = {
    Confirmed: 'BookingConfirmed',
    Scheduled: 'CrewAssigned',
    InProgress: 'TruckOnTheWay',
    Completed: 'MoveCompleted',
    Cancelled: 'BookingCancelled',
  };

  if (messages[status]) {
    await createNotification(
      client._id,
      typeMap[status] || 'SystemAlert',
      titles[status] || `Booking Update`,
      messages[status],
      { bookingId: booking._id, bookingNumber: booking.bookingNumber },
      getChannels(client)
    );
  }
}

async function sendCrewAssignedNotification(booking) {
  const client = booking.client;
  if (!client) return;
  await createNotification(
    client._id,
    'CrewAssigned',
    'Crew Assigned to Your Move',
    `Great news! A driver and movers have been assigned to your booking ${booking.bookingNumber}.`,
    { bookingId: booking._id, bookingNumber: booking.bookingNumber },
    getChannels(client)
  );
}

async function notifySalesTeamForReview(booking) {
  const salesUsers = await User.find({ role: 'Sales', isActive: true }).select('_id');
  await Promise.all(
    salesUsers.map((u) =>
      createNotification(
        u._id,
        'EstimateNeedsReview',
        'AI Estimate Needs Manual Review',
        `Booking ${booking.bookingNumber} has a low-confidence AI estimate (${Math.round((booking.aiEstimate?.aiConfidence || 0) * 100)}%). Manual review required.`,
        { bookingId: booking._id, bookingNumber: booking.bookingNumber }
      )
    )
  );
}

async function sendPaymentNotification(booking) {
  const client = booking.client;
  if (!client) return;
  const statusLabels = { Charged: 'has been charged', Paid: 'is marked as paid' };
  const msg = statusLabels[booking.payment?.status];
  if (!msg) return;
  await createNotification(
    client._id,
    'PaymentUpdated',
    'Payment Status Updated',
    `Your payment for booking ${booking.bookingNumber} ${msg}.`,
    { bookingId: booking._id, bookingNumber: booking.bookingNumber },
    getChannels(client)
  );
}

async function sendFeedbackRequest(booking) {
  const client = booking.client;
  if (!client) return;
  await createNotification(
    client._id,
    'FeedbackRequested',
    'How was your move?',
    `Thank you for choosing Kesmoving! Please take a moment to review your experience.`,
    { bookingId: booking._id, bookingNumber: booking.bookingNumber },
    getChannels(client)
  );
}

module.exports = {
  createNotification,
  sendBookingStatusNotification,
  sendCrewAssignedNotification,
  notifySalesTeamForReview,
  sendPaymentNotification,
  sendFeedbackRequest,
};
