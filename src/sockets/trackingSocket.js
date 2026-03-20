const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Truck = require('../models/Truck');
const logger = require('../utils/logger');
const { emitTruckTrackingUpdate } = require('../utils/trackingEvents');

/**
 * Real-time truck tracking via Socket.io
 * Drivers emit their GPS location, clients subscribe to a truck room
 */
function registerTrackingSocket(io) {
  const trackingNamespace = io.of('/tracking');

  // Authenticate socket connections
  trackingNamespace.use(async (socket, next) => {
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

  trackingNamespace.on('connection', (socket) => {
    logger.debug(`Tracking socket connected: ${socket.user.email} (${socket.user.role})`);

    // Drivers subscribe to broadcast their location
    socket.on('driver:subscribe', ({ truckId }) => {
      if (!['Driver'].includes(socket.user.role)) {
        socket.emit('error', { message: 'Not authorized as driver' });
        return;
      }
      socket.truckId = truckId;
      socket.join(`truck:${truckId}`);
      logger.debug(`Driver ${socket.user.email} subscribed to truck ${truckId}`);
    });

    // Driver sends GPS update
    socket.on('driver:location', async ({ truckId, lat, lng, address }) => {
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      try {
        const truck = await Truck.findByIdAndUpdate(truckId, {
          currentLocation: { lat, lng, address, updatedAt: new Date() },
        }, {
          new: true,
        }).select('_id status activeBooking currentLocation');

        emitTruckTrackingUpdate(trackingNamespace, truck, truck?.currentLocation);
      } catch (err) {
        logger.error(`Tracking update failed: ${err.message}`);
      }
    });

    // Clients / staff subscribe to watch a truck
    socket.on('client:watch', ({ truckId, bookingId }) => {
      if (truckId) {
        socket.join(`truck:${truckId}`);
        logger.debug(`${socket.user.email} watching truck ${truckId}`);
      }

      if (bookingId) {
        socket.join(`booking:${bookingId}`);
        logger.debug(`${socket.user.email} watching booking ${bookingId}`);
      }
    });

    socket.on('client:unwatch', ({ truckId, bookingId }) => {
      if (truckId) {
        socket.leave(`truck:${truckId}`);
      }

      if (bookingId) {
        socket.leave(`booking:${bookingId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Tracking socket disconnected: ${socket.user?.email}`);
    });
  });
}

module.exports = { registerTrackingSocket };
