const Conversation = require('../models/Conversation');
const chatbotService = require('./chatbotService');

function toRoleLabel(senderType) {
  if (senderType === 'Client') return 'Client';
  if (senderType === 'Admin' || senderType === 'Agent') return 'Support Agent';
  if (senderType === 'Bot') return 'AI Assistant';
  return 'Participant';
}

function buildInterventionTranscript(conversation) {
  if (!conversation?.messages?.length) return 'No intervention transcript available.';

  return conversation.messages
    .map((msg) => `${toRoleLabel(msg.senderType)}: ${msg.content}`)
    .join('\n');
}

async function resolveConversationAndPrepareAi({ conversationId, resolvedByUser, io }) {
  const conversation = await Conversation.findById(conversationId)
    .populate('client', 'firstName lastName email')
    .populate('assigned_admin_id', 'firstName lastName email');

  if (!conversation) {
    return null;
  }

  const transcript = buildInterventionTranscript(conversation);
  const handoffSummary = await chatbotService.generateHandoffSummary(transcript, conversation);

  conversation.is_escalated = false;
  conversation.isEscalated = false;
  conversation.status = 'Resolved';
  conversation.assigned_admin_id = null;
  conversation.assignedAgent = null;
  conversation.resolvedAt = new Date();
  conversation.aiContextSummary = handoffSummary;
  conversation.aiContextUpdatedAt = new Date();

  await conversation.save();

  const payload = {
    conversationId: conversation._id.toString(),
    status: 'resolved',
    isEscalated: false,
    systemMessage: 'This session has been resolved. Our AI assistant is back online to help you.',
    handoffSummary,
    resolvedAt: conversation.resolvedAt,
    resolvedBy: resolvedByUser
      ? {
          _id: resolvedByUser._id,
          name: `${resolvedByUser.firstName || ''} ${resolvedByUser.lastName || ''}`.trim() || 'Support Agent',
          role: resolvedByUser.role,
        }
      : null,
  };

  if (io) {
    const chatNs = io.of('/chat');
    const chatId = conversation._id.toString();
    chatNs.to(chatId).emit('chat_resolved', payload);
    chatNs.to('agents').emit('conversation_updated', {
      chatId,
      lastMessageAt: new Date().toISOString(),
      senderType: 'System',
    });
  }

  return { conversation, payload };
}

module.exports = {
  resolveConversationAndPrepareAi,
};
