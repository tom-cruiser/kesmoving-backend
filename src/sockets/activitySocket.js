const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const ADMIN_ROLES = new Set(['Admin', 'OperationsManager']);

let activityNamespace = null;

function registerActivitySocket(io) {
  activityNamespace = io.of('/activity');

  activityNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user || !user.isActive) return next(new Error('Invalid user'));
      if (!ADMIN_ROLES.has(user.role)) return next(new Error('Not authorized'));

      socket.user = user;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  activityNamespace.on('connection', (socket) => {
    logger.debug(`Activity socket connected: ${socket.user.email}`);
    socket.join('admins');

    socket.on('disconnect', () => {
      logger.debug(`Activity socket disconnected: ${socket.user?.email}`);
    });
  });
}

function emitActivity(log) {
  if (!activityNamespace) return;
  try {
    activityNamespace.to('admins').emit('activity:new', log);
  } catch (err) {
    logger.error(`Activity socket emit failed: ${err.message}`);
  }
}

module.exports = { registerActivitySocket, emitActivity };
