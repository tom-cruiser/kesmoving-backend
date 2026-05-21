const express = require('express');
const { body, query, param } = require('express-validator');
const {
  createBooking, getBookings, getBookingById, updateBookingStatus,
  assignCrew, uploadPhotos, updatePaymentStatus,
  cancelBooking, updateBooking, deleteBooking,
} = require('../controllers/bookingController');
const { protect, authorize, staffOnly } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { BOOKING_STATUSES, PAYMENT_STATUSES } = require('../models/Booking');

const router = express.Router();

// Public booking endpoint (anonymous) — rate limited to prevent abuse
const rateLimit = require('express-rate-limit');
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests from this IP, please try again later.' } });

router.post(
  '/public',
  publicLimiter,
  [
    body('pickupAddress').isObject().withMessage('Pickup address required'),
    body('pickupAddress.city').notEmpty().withMessage('Pickup city required'),
    body('pickupAddress.province').notEmpty().withMessage('Pickup province required'),
    body('destinationAddress').isObject().withMessage('Destination address required'),
    body('destinationAddress.city').notEmpty().withMessage('Destination city required'),
    body('destinationAddress.province').notEmpty().withMessage('Destination province required'),
    body('moveDate').optional().isISO8601().withMessage('Move date must be a valid date'),
  ],
  validate,
  require('../controllers/bookingController').publicCreateBooking,
);

router.use(protect);

router.post(
  '/',
  authorize('Client'),
  [
    body('pickupAddress').isObject().withMessage('Pickup address required'),
    body('pickupAddress.street').notEmpty(),
    body('pickupAddress.city').notEmpty(),
    body('pickupAddress.province').notEmpty(),
    body('pickupAddress.postalCode').notEmpty(),
    body('destinationAddress').isObject().withMessage('Destination address required'),
    body('destinationAddress.street').notEmpty(),
    body('destinationAddress.city').notEmpty(),
    body('destinationAddress.province').notEmpty(),
    body('destinationAddress.postalCode').notEmpty(),
    body('moveDate').isISO8601().withMessage('Valid move date required'),
    body('moveType').optional().isIn(['Residential', 'Commercial', 'Storage', 'LongDistance']),
  ],
  validate,
  createBooking
);

router.get('/', getBookings);
router.get('/:id', [param('id').isMongoId()], validate, getBookingById);

router.put(
  '/:id/status',
  staffOnly,
  [
    param('id').isMongoId(),
    body('status').isIn(BOOKING_STATUSES).withMessage('Invalid status'),
  ],
  validate,
  updateBookingStatus
);

router.put(
  '/:id/assign',
  authorize('Admin', 'OperationsManager'),
  [
    param('id').isMongoId(),
    body('driverId').isMongoId().withMessage('Valid driver ID required'),
    body('truckId').isMongoId().withMessage('Valid truck ID required'),
  ],
  validate,
  assignCrew
);

router.post(
  '/:id/photos',
  [param('id').isMongoId()],
  validate,
  uploadPhotos
);

router.put(
  '/:id/payment',
  authorize('Admin', 'OperationsManager', 'Sales'),
  [
    param('id').isMongoId(),
    body('status').isIn(PAYMENT_STATUSES).withMessage('Invalid payment status'),
    body('amount').optional().isNumeric(),
  ],
  validate,
  updatePaymentStatus
);

// Cancel a booking (client: own Pending/Confirmed; staff: any)
router.put(
  '/:id/cancel',
  [
    param('id').isMongoId(),
    body('cancellationReason').optional().isString().trim(),
  ],
  validate,
  cancelBooking
);

// Update booking details (client: own Pending; staff: non-Completed/Cancelled)
router.put(
  '/:id',
  [
    param('id').isMongoId(),
    body('moveDate').optional().isISO8601().withMessage('Valid move date required'),
    body('moveType').optional().isIn(['Residential', 'Commercial', 'Storage', 'LongDistance']),
  ],
  validate,
  updateBooking
);

// Delete a booking (client: own Pending; Admin/OperationsManager: any)
router.delete(
  '/:id',
  [param('id').isMongoId()],
  validate,
  deleteBooking
);

module.exports = router;
