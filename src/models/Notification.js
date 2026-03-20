const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'BookingConfirmed',
        'CrewAssigned',
        'TruckOnTheWay',
        'MoveCompleted',
        'FeedbackRequested',
        'BookingCancelled',
        'PaymentUpdated',
        'EstimateReady',
        'EstimateNeedsReview',
        'NewChatMessage',
        'SystemAlert',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed },
    isRead: { type: Boolean, default: false, index: true },
    channels: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
    },
    sentVia: {
      email: { sent: Boolean, sentAt: Date },
      sms: { sent: Boolean, sentAt: Date },
    },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
