const Conversation = require('../models/Conversation');
const asyncHandler = require('../utils/asyncHandler');
const { resolveConversationAndPrepareAi } = require('../services/supportResolutionService');

/**
 * @route   POST /api/support/escalate
 * @access  Private
 */
const escalateConversation = asyncHandler(async (req, res) => {
  const { conversationId, reason } = req.body;

  const conversation = await Conversation.findById(conversationId)
    .populate('client', 'firstName lastName email');

  if (!conversation) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  if (req.user.role === 'Client' && conversation.client._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (!conversation.is_escalated) {
    conversation.is_escalated = true;
    conversation.isEscalated = true;
    conversation.status = conversation.assigned_admin_id ? 'AgentHandling' : 'WaitingForAgent';
    conversation.escalatedAt = conversation.escalatedAt || new Date();
    conversation.escalationReason = reason || conversation.escalationReason || 'User requested human support';

    conversation.messages.push({
      sender: req.user._id,
      senderType: req.user.role === 'Client' ? 'Client' : 'Admin',
      content: req.user.role === 'Client'
        ? 'Requesting human support'
        : 'Escalation requested by staff',
      timestamp: new Date(),
      is_escalated: true,
      assigned_admin_id: conversation.assigned_admin_id || null,
      metadata: {
        escalatedAt: new Date(),
      },
    });
  }

  await conversation.save();

  const io = req.app.get('io');
  if (io) {
    io.of('/chat').to('agents').emit('escalation_triggered', {
      conversationId: conversation._id.toString(),
      reason: conversation.escalationReason,
      clientName: conversation.client
        ? `${conversation.client.firstName || ''} ${conversation.client.lastName || ''}`.trim()
        : 'Client',
      escalatedAt: conversation.escalatedAt,
      source: req.user.role === 'Client' ? 'user_request' : 'staff_request',
    });
  }

  res.json({ success: true, data: conversation });
});

/**
 * @route   POST /api/support/resolve
 * @access  Private/Staff
 */
const resolveEscalatedConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.body;

  const existing = await Conversation.findById(conversationId).select('client');
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  if (req.user.role === 'Client') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const resolved = await resolveConversationAndPrepareAi({
    conversationId,
    resolvedByUser: req.user,
    io: req.app.get('io'),
  });

  if (!resolved) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  res.json({ success: true, data: resolved.conversation, meta: { handoffSummary: resolved.payload.handoffSummary } });
});

module.exports = { escalateConversation, resolveEscalatedConversation };