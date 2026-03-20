const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  senderType: { type: String, enum: ['Client', 'Agent', 'Admin', 'Bot'], required: true },
  clientTempId: { type: String, default: null, index: true },
  content: { type: String, required: true, maxlength: 5000 },
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
  seenAt: { type: Date, default: null },
  is_escalated: { type: Boolean, default: false },
  assigned_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  metadata: {
    aiConfidence: Number,
    intent: String,
    escalatedAt: Date,
  },
}, { _id: true });

const conversationSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['Open', 'BotHandling', 'WaitingForAgent', 'AgentHandling', 'Resolved', 'Closed'],
      default: 'Open',
      index: true,
    },
    messages: [messageSchema],
    is_escalated: { type: Boolean, default: false, index: true },
    assigned_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isEscalated: { type: Boolean, default: false },
    escalatedAt: { type: Date },
    escalationReason: { type: String },
    aiContextSummary: { type: String, default: '' },
    aiContextUpdatedAt: { type: Date, default: null },
    resolvedAt: { type: Date },
    tags: [String],
    subject: { type: String, maxlength: 200 },
  },
  { timestamps: true }
);

conversationSchema.index({ client: 1, status: 1 });
conversationSchema.index({ assignedAgent: 1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
