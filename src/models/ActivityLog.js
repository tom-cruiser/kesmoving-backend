const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorName: { type: String, required: true },
    actorRole: { type: String, required: true },
    action: {
      type: String,
      required: true,
      enum: [
        'booking.created',
        'booking.status_changed',
        'booking.cancelled',
        'booking.deleted',
        'booking.crew_assigned',
        'booking.payment_updated',
        'estimate.reviewed',
        'user.login',
        'user.role_updated',
        'user.password_reset',
        'user.activated',
        'user.deactivated',
        'fleet.truck_created',
        'fleet.truck_updated',
        'fleet.truck_deleted',
      ],
      index: true,
    },
    resourceType: { type: String, enum: ['Booking', 'User', 'Truck', 'Estimate'], index: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId },
    resourceRef: { type: String },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actor: 1, createdAt: -1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
module.exports = ActivityLog;
