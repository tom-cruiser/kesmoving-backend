const Conversation = require('../models/Conversation');
const asyncHandler = require('../utils/asyncHandler');
const chatbotService = require('../services/chatbotService');
const logger = require('../utils/logger');
const { resolveConversationAndPrepareAi } = require('../services/supportResolutionService');

function normalizeMessage(chatId, message) {
  if (!message) return null;
  return {
    _id: message._id,
    chatId,
    sender: message.sender,
    senderType: message.senderType,
    clientTempId: message.clientTempId || null,
    content: message.content,
    timestamp: message.timestamp,
    isRead: !!message.isRead,
    seenAt: message.seenAt || null,
    metadata: message.metadata,
  };
}

/**
 * @route   POST /api/chat/conversations
 * @access  Private/Client
 */
const startConversation = asyncHandler(async (req, res) => {
  const { subject, bookingId } = req.body;

  const conversation = await Conversation.create({
    client: req.user._id,
    booking: bookingId || null,
    subject,
    status: 'BotHandling',
    messages: [],
  });

  res.status(201).json({ success: true, data: conversation });
});

/**
 * @route   POST /api/chat/conversations/:id/message
 * @access  Private
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { content, clientTempId } = req.body;
  const conversation = await Conversation.findById(req.params.id);

  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });

  // Client can only message own conversations
  if (req.user.role === 'Client' && conversation.client.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const userMessage = {
    sender: req.user._id,
    senderType: req.user.role === 'Client' ? 'Client' : (req.user.role === 'Admin' ? 'Admin' : 'Agent'),
    clientTempId: clientTempId || null,
    content,
    timestamp: new Date(),
    is_escalated: !!conversation.is_escalated,
    assigned_admin_id: conversation.assigned_admin_id || null,
  };
  conversation.messages.push(userMessage);

  let botReply = null;

  // Bot responds when:
  //  • Conversation is in BotHandling (normal flow), OR
  //  • Conversation is WaitingForAgent but no agent is assigned yet —
  //    keep the client engaged rather than going silent.
  const botShouldRespond =
    req.user.role === 'Client' &&
    !conversation.is_escalated &&
    !conversation.isEscalated &&
    conversation.status !== 'Closed';

  if (botShouldRespond) {
    // Move resolved chats back into active bot mode once the user sends a new message.
    if (conversation.status === 'Resolved') {
      conversation.status = 'BotHandling';
    }

    const botResult = await chatbotService.processMessage(content, conversation);

    const botMessage = {
      senderType: 'Bot',
      clientTempId: null,
      content: botResult.reply,
      timestamp: new Date(),
      metadata: { aiConfidence: botResult.confidence, intent: botResult.intent },
    };
    conversation.messages.push(botMessage);
    botReply = botMessage;

    // Escalate if needed (only transition from BotHandling; already-escalated
    // conversations keep their original escalatedAt timestamp)
    if (botResult.shouldEscalate && conversation.status === 'BotHandling') {
      conversation.status = 'WaitingForAgent';
      conversation.isEscalated = true;
      conversation.is_escalated = true;
      conversation.escalatedAt = new Date();
      conversation.escalationReason = botResult.escalationReason;
      logger.info(`Conversation ${conversation._id} escalated to human agent`);

      // Notify agents via socket
      const io = req.app.get('io');
      if (io) {
        io.of('/chat').to('agents').emit('escalation_triggered', {
          conversationId: conversation._id.toString(),
          reason: conversation.escalationReason,
          escalatedAt: conversation.escalatedAt,
          source: 'ai_trigger',
        });
      }
    }
  }

  await conversation.save();

  const io = req.app.get('io');
  if (io) {
    const chatNs = io.of('/chat');
    const chatId = conversation._id.toString();
    const savedUserMessage = conversation.messages[conversation.messages.length - (botReply ? 2 : 1)];
    const savedBotMessage = botReply ? conversation.messages[conversation.messages.length - 1] : null;

    const userPayload = normalizeMessage(chatId, savedUserMessage);
    if (userPayload) {
      chatNs.to(chatId).emit('message_received', userPayload);
      chatNs.to('agents').emit('conversation_updated', {
        chatId,
        lastMessageAt: userPayload.timestamp,
        senderType: userPayload.senderType,
      });
    }

    if (savedBotMessage) {
      const botPayload = normalizeMessage(chatId, savedBotMessage);
      if (botPayload) {
        chatNs.to(chatId).emit('message_received', botPayload);
      }
    }
  }

  res.json({ success: true, data: { conversation, botReply } });
});

/**
 * @route   GET /api/chat/conversations
 * @access  Private
 */
const getConversations = asyncHandler(async (req, res) => {
  const query = {};

  if (req.user.role === 'Client') {
    query.client = req.user._id;
  } else if (['CustomerService'].includes(req.user.role)) {
    query.$or = [{ assignedAgent: req.user._id }, { status: 'WaitingForAgent' }];
  }

  const { status } = req.query;
  if (status) query.status = status;

  if (req.query.isEscalated === 'true') {
    query.$or = [
      ...(query.$or || []),
      { isEscalated: true },
      { is_escalated: true },
    ];
  }

  const conversations = await Conversation.find(query)
    .populate('client', 'firstName lastName email')
    .populate('assignedAgent', 'firstName lastName')
    .populate('booking', 'bookingNumber')
    .sort({ updatedAt: -1 })
    .limit(50);

  res.json({ success: true, data: conversations });
});

/**
 * @route   GET /api/chat/conversations/all
 * @access  Private/Staff
 */
const getAllConversations = asyncHandler(async (req, res) => {
  if (req.user.role === 'Client') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const query = {};
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) query.status = { $in: statuses };
  }
  if (req.query.isEscalated === 'true') {
    query.$or = [{ isEscalated: true }, { is_escalated: true }];
  }

  const conversations = await Conversation.find(query)
    .populate('client', 'firstName lastName email')
    .populate('assignedAgent', 'firstName lastName')
    .populate('assigned_admin_id', 'firstName lastName')
    .populate('booking', 'bookingNumber')
    .sort({ updatedAt: -1 })
    .limit(100);

  res.json({ success: true, data: conversations });
});

/**
 * @route   GET /api/chat/conversations/:id
 * @access  Private
 */
const getConversation = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id)
    .populate('client', 'firstName lastName email phone')
    .populate('assignedAgent', 'firstName lastName')
    .populate('assigned_admin_id', 'firstName lastName')
    .populate('booking', 'bookingNumber status moveDate');

  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });

  if (req.user.role === 'Client' && conversation.client._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  res.json({ success: true, data: conversation });
});

/**
 * @route   GET /api/chat/conversations/:id/messages
 * @access  Private
 */
const getConversationMessages = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findById(req.params.id)
    .select('client assignedAgent assigned_admin_id messages')
    .populate('messages.sender', 'firstName lastName role');

  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });
  if (req.user.role === 'Client' && conversation.client.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  res.json({ success: true, data: conversation.messages || [] });
});

/**
 * @route   PUT /api/chat/conversations/:id/assign
 * @access  Private/CustomerService, Admin
 */
const assignAgent = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findByIdAndUpdate(
    req.params.id,
    {
      assignedAgent: req.user._id,
      assigned_admin_id: req.user._id,
      isEscalated: true,
      is_escalated: true,
      status: 'AgentHandling',
    },
    { new: true }
  );
  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });

  const io = req.app.get('io');
  if (io) {
    const chatId = conversation._id.toString();
    io.of('/chat').to(chatId).emit('agentAssigned', {
      agentName: `${req.user.firstName} ${req.user.lastName}`,
    });
  }

  res.json({ success: true, data: conversation });
});

/**
 * @route   PUT /api/chat/conversations/:id/resolve
 * @access  Private/Staff
 */
const resolveConversation = asyncHandler(async (req, res) => {
  const resolved = await resolveConversationAndPrepareAi({
    conversationId: req.params.id,
    resolvedByUser: req.user,
    io: req.app.get('io'),
  });

  if (!resolved) return res.status(404).json({ success: false, message: 'Conversation not found' });
  res.json({ success: true, data: resolved.conversation, meta: { handoffSummary: resolved.payload.handoffSummary } });
});

module.exports = {
  startConversation,
  sendMessage,
  getConversations,
  getAllConversations,
  getConversation,
  getConversationMessages,
  assignAgent,
  resolveConversation,
};
