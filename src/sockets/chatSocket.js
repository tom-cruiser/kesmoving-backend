const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const logger = require('../utils/logger');
const { resolveConversationAndPrepareAi } = require('../services/supportResolutionService');

/**
 * Real-time chat via Socket.io
 * Clients and agents communicate in conversation rooms
 */
function registerChatSocket(io) {
  const chatNamespace = io.of('/chat');

  const normalizeMessage = (chatId, message) => ({
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
  });

  chatNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user || !user.isActive) return next(new Error('Invalid user'));

      socket.user = user;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  chatNamespace.on('connection', (socket) => {
    const { user } = socket;
    logger.debug(`Chat socket connected: ${user.email} (${user.role})`);

    // Personal room can be used for targeted notifications if needed.
    socket.join(`user:${user._id}`);

    // Staff agents join an agents room for escalation notifications
    if (user.role !== 'Client') {
      socket.join('agents');
    }

    // Join a specific conversation room
    socket.on('join:conversation', async ({ conversationId }) => {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        socket.emit('error', { message: 'Conversation not found' });
        return;
      }
      // Authorize: client can only join own conversation
      if (user.role === 'Client' && conversation.client.toString() !== user._id.toString()) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }
      // Join by raw chatId to simplify targeted broadcasting.
      socket.join(conversationId);
      socket.join(`conversation:${conversationId}`);
      socket.emit('conversation:joined', { conversationId });
    });

    socket.on('leave:conversation', ({ conversationId }) => {
      socket.leave(conversationId);
      socket.leave(`conversation:${conversationId}`);
    });

    // New message in a conversation (real-time relay)
    socket.on('chat:message', async ({ conversationId, content }) => {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return;

      if (user.role === 'Client' && conversation.client.toString() !== user._id.toString()) return;

      conversation.messages.push({
        sender: user._id,
        senderType: user.role === 'Client' ? 'Client' : (user.role === 'Admin' ? 'Admin' : 'Agent'),
        clientTempId: null,
        content: content?.trim(),
        timestamp: new Date(),
        is_escalated: !!conversation.is_escalated,
        assigned_admin_id: conversation.assigned_admin_id || null,
      });

      await conversation.save();
      const saved = conversation.messages[conversation.messages.length - 1];
      const payload = normalizeMessage(conversationId, saved);

      // Double-sided realtime flow.
      chatNamespace.to(conversationId).emit('message_received', payload);
      chatNamespace.to('agents').emit('conversation_updated', {
        chatId: conversationId,
        lastMessageAt: payload.timestamp,
        senderType: payload.senderType,
      });
    });

    socket.on('request_escalation', async ({ conversationId, reason }) => {
      const conversation = await Conversation.findById(conversationId)
        .populate('client', 'firstName lastName email');
      if (!conversation) return;
      if (user.role === 'Client' && conversation.client._id.toString() !== user._id.toString()) return;

      conversation.isEscalated = true;
      conversation.is_escalated = true;
      conversation.status = conversation.assigned_admin_id ? 'AgentHandling' : 'WaitingForAgent';
      conversation.escalatedAt = conversation.escalatedAt || new Date();
      conversation.escalationReason = reason || conversation.escalationReason || 'User requested human support';
      await conversation.save();

      const payload = {
        conversationId: conversation._id.toString(),
        reason: conversation.escalationReason,
        escalatedAt: conversation.escalatedAt,
        source: user.role === 'Client' ? 'user_request' : 'staff_request',
      };

      chatNamespace.to('agents').emit('escalation_triggered', payload);
      chatNamespace.to(conversationId).emit('escalation_triggered', payload);
    });

    socket.on('admin_response', async ({ conversationId, content, clientTempId }) => {
      if (user.role === 'Client' || !content?.trim() || !conversationId) return;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return;

      const message = {
        sender: user._id,
        senderType: 'Admin',
        clientTempId: clientTempId || null,
        content: content.trim(),
        timestamp: new Date(),
        is_escalated: true,
        assigned_admin_id: user._id,
      };

      conversation.isEscalated = true;
      conversation.is_escalated = true;
      conversation.assignedAgent = user._id;
      conversation.assigned_admin_id = user._id;
      conversation.status = 'AgentHandling';
      conversation.messages.push(message);
      await conversation.save();

      const saved = conversation.messages[conversation.messages.length - 1];
      const payload = normalizeMessage(conversationId, saved);

      // Required targeted room broadcast for admin -> client sync.
      chatNamespace.to(conversationId).emit('message_received', payload);
      chatNamespace.to(conversationId).emit('admin_response', payload);
      chatNamespace.to('agents').emit('conversation_updated', {
        chatId: conversationId,
        lastMessageAt: payload.timestamp,
        senderType: payload.senderType,
      });
    });

    socket.on('chat_resolved', async ({ conversationId }) => {
      if (!conversationId || user.role === 'Client') return;

      const resolved = await resolveConversationAndPrepareAi({
        conversationId,
        resolvedByUser: user,
        io,
      });

      if (!resolved) return;
      socket.emit('chat_resolved_ack', {
        conversationId,
        ok: true,
      });
    });

    // Typing indicator
    socket.on('typing', ({ chatId, isTyping }) => {
      if (!chatId) return;
      socket.to(chatId).emit('typing', {
        userId: user._id,
        name: `${user.firstName} ${user.lastName}`,
        isTyping,
      });
    });

    socket.on('message_seen', async ({ chatId, messageIds }) => {
      if (!chatId || !Array.isArray(messageIds) || messageIds.length === 0) return;
      const conversation = await Conversation.findById(chatId);
      if (!conversation) return;

      const seenAt = new Date();
      for (const msg of conversation.messages) {
        if (messageIds.includes(String(msg._id))) {
          msg.isRead = true;
          msg.seenAt = seenAt;
        }
      }
      await conversation.save();

      chatNamespace.to(chatId).emit('seen_update', {
        chatId,
        messageIds,
        seenAt: seenAt.toISOString(),
      });
    });

    // Brief heartbeat for connectivity visibility and reconnection handling.
    socket.on('heartbeat', ({ ts }) => {
      socket.emit('heartbeat_ack', {
        ts,
        serverTs: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      logger.debug(`Chat socket disconnected: ${user?.email}`);
    });
  });
}

module.exports = { registerChatSocket };
