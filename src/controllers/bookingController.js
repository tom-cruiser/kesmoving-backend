const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');
const logActivity = require('../utils/activity');

/**
 * @route   POST /api/bookings
 * @access  Private/Client
 */
const createBooking = asyncHandler(async (req, res) => {
  const {
    pickupAddress, destinationAddress, moveDate, moveTime,
    specialInstructions, moveType, floorDetails,
    moveSize, numberOfBedrooms, specialItems, notes,
    aiEstimate, itemPhotos,
  } = req.body;

  const bookingData = {
    client: req.user._id,
    pickupAddress,
    destinationAddress,
    moveDate: new Date(moveDate),
    moveTime,
    specialInstructions: specialInstructions || (notes ? String(notes) : undefined),
    moveType,
    floorDetails,
    moveSize,
    numberOfBedrooms: Number(numberOfBedrooms) || 0,
    timeline: [{ status: 'Pending', changedBy: req.user._id }],
  };

  if (specialItems && Array.isArray(specialItems) && specialItems.length > 0) {
    bookingData.specialInstructions = [
      bookingData.specialInstructions,
      `Special items: ${specialItems.join(', ')}`,
    ].filter(Boolean).join('\n');
  }

  if (aiEstimate && typeof aiEstimate === 'object') {
    bookingData.aiEstimate = aiEstimate;
  }

  if (Array.isArray(itemPhotos) && itemPhotos.length > 0) {
    bookingData.itemPhotos = itemPhotos.map((url) =>
      typeof url === 'string' ? { url } : url
    );
  }

  const booking = await Booking.create(bookingData);

  logger.info(`Booking created: ${booking.bookingNumber} by ${req.user.email}`);
  logActivity(req, 'booking.created', 'Booking', booking._id, booking.bookingNumber);

  res.status(201).json({ success: true, data: booking });
});

/**
 * @route   GET /api/bookings
 * @access  Private
 */
const getBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20, startDate, endDate, search, needsManualReview } = req.query;

  const query = {};

  // Clients can only see their own bookings
  if (req.user.role === 'Client') {
    query.client = req.user._id;
  }

  if (status) query.status = status;
  if (needsManualReview === 'true') query['aiEstimate.needsManualReview'] = true;
  if (startDate || endDate) {
    query.moveDate = {};
    if (startDate) query.moveDate.$gte = new Date(startDate);
    if (endDate) query.moveDate.$lte = new Date(endDate);
  }
  if (search) {
    query.$or = [
      { bookingNumber: { $regex: search, $options: 'i' } },
      { 'pickupAddress.city': { $regex: search, $options: 'i' } },
      { 'destinationAddress.city': { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [bookings, total] = await Promise.all([
    Booking.find(query)
      .populate('client', 'firstName lastName email phone')
      .populate('crewAssignment.driver', 'firstName lastName phone')
      .populate('crewAssignment.movers', 'firstName lastName')
      .populate('crewAssignment.truck', 'name licensePlate capacity')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Booking.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: bookings,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  });
});

/**
 * @route   GET /api/bookings/:id
 * @access  Private
 */
const getBookingById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('client', 'firstName lastName email phone address')
    .populate('crewAssignment.driver', 'firstName lastName email phone')
    .populate('crewAssignment.movers', 'firstName lastName')
    .populate('crewAssignment.truck', 'name licensePlate capacity currentLocation')
    .populate('crewAssignment.assignedBy', 'firstName lastName')
    .populate('review')
    .populate('timeline.changedBy', 'firstName lastName role');

  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  // Clients can only view their own bookings
  if (req.user.role === 'Client' && booking.client._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized to view this booking' });
  }

  res.json({ success: true, data: booking });
});

/**
 * @route   PUT /api/bookings/:id/status
 * @access  Private/Staff
 */
const updateBookingStatus = asyncHandler(async (req, res) => {
  const { status, note, cancellationReason } = req.body;

  const booking = await Booking.findById(req.params.id).populate('client', 'firstName lastName email phone notificationPreferences');
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  booking.status = status;
  booking.timeline.push({ status, changedBy: req.user._id, note });

  if (status === 'Cancelled') {
    booking.cancellationReason = cancellationReason;
    booking.cancelledBy = req.user._id;
  }

  await booking.save();

  // Send notification
  await notificationService.sendBookingStatusNotification(booking, status, req.user);

  logger.info(`Booking ${booking.bookingNumber} status → ${status} by ${req.user.email}`);
  logActivity(req, 'booking.status_changed', 'Booking', booking._id, booking.bookingNumber, { newStatus: status });

  res.json({ success: true, data: booking });
});

/**
 * @route   PUT /api/bookings/:id/assign
 * @access  Private/OperationsManager, Admin
 */
const assignCrew = asyncHandler(async (req, res) => {
  const { driverId, moverIds, truckId } = req.body;

  const booking = await Booking.findById(req.params.id).populate('client', 'firstName lastName email phone notificationPreferences');
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  booking.crewAssignment = {
    driver: driverId,
    movers: moverIds || [],
    truck: truckId,
    assignedAt: new Date(),
    assignedBy: req.user._id,
  };

  if (booking.status === 'Confirmed') {
    booking.status = 'Scheduled';
    booking.timeline.push({ status: 'Scheduled', changedBy: req.user._id, note: 'Crew assigned' });
  }

  await booking.save();

  // Update truck status
  const Truck = require('../models/Truck');
  await Truck.findByIdAndUpdate(truckId, { status: 'InUse', activeBooking: booking._id, driver: driverId });

  await notificationService.sendCrewAssignedNotification(booking, req.user);
  logActivity(req, 'booking.crew_assigned', 'Booking', booking._id, booking.bookingNumber);

  res.json({ success: true, data: booking });
});

/**
 * @route   POST /api/bookings/:id/photos
 * @access  Private/Client (own booking)
 */
const uploadPhotos = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (req.user.role === 'Client' && booking.client.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const photoUrls = Array.isArray(req.body.photoUrls)
    ? req.body.photoUrls
    : Array.isArray(req.body.itemPhotos)
      ? req.body.itemPhotos
      : [];

  if (photoUrls.length === 0) {
    return res.status(400).json({ success: false, message: 'No photos uploaded' });
  }

  const photos = photoUrls.map((photo) =>
    typeof photo === 'string' ? { url: photo } : photo,
  );

  booking.itemPhotos.push(...photos);
  await booking.save();

  res.json({ success: true, data: booking, message: `${photos.length} photo(s) uploaded` });
});

/**
 * @route   PUT /api/bookings/:id/payment
 * @access  Private/Admin, Sales, OperationsManager
 */
const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { status, amount, notes } = req.body;

  const booking = await Booking.findById(req.params.id).populate('client', 'firstName lastName email phone notificationPreferences');
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  booking.payment = {
    status,
    amount: amount ?? booking.payment?.amount,
    notes,
    updatedBy: req.user._id,
    updatedAt: new Date(),
  };

  await booking.save();
  await notificationService.sendPaymentNotification(booking);
  logActivity(req, 'booking.payment_updated', 'Booking', booking._id, booking.bookingNumber, { status, amount });

  res.json({ success: true, data: booking });
});

/**
 * @route   PUT /api/bookings/:id/cancel
 * @access  Private (Client: own Pending/Confirmed; Staff: any)
 */
const cancelBooking = asyncHandler(async (req, res) => {
  const { cancellationReason } = req.body;

  const booking = await Booking.findById(req.params.id).populate(
    'client',
    'firstName lastName email phone notificationPreferences'
  );
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (req.user.role === 'Client') {
    if (booking.client._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (!['Pending', 'Confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel a booking with status: ${booking.status}` });
    }
  }

  booking.status = 'Cancelled';
  booking.cancellationReason = cancellationReason || '';
  booking.cancelledBy = req.user._id;
  booking.timeline.push({ status: 'Cancelled', changedBy: req.user._id, note: cancellationReason });

  await booking.save();
  await notificationService.sendBookingStatusNotification(booking, 'Cancelled', req.user);
  logger.info(`Booking ${booking.bookingNumber} cancelled by ${req.user.email}`);
  logActivity(req, 'booking.cancelled', 'Booking', booking._id, booking.bookingNumber, { reason: cancellationReason });

  res.json({ success: true, data: booking });
});

/**
 * @route   PUT /api/bookings/:id
 * @access  Private (Client: own Pending; Staff: any non-Completed/Cancelled)
 */
const updateBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (req.user.role === 'Client') {
    if (booking.client.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (booking.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'You can only edit Pending bookings' });
    }
  } else if (['Completed', 'Cancelled'].includes(booking.status)) {
    return res.status(400).json({ success: false, message: `Cannot edit a booking with status: ${booking.status}` });
  }

  const allowed = [
    'pickupAddress', 'destinationAddress', 'moveDate', 'moveTime',
    'specialInstructions', 'moveType', 'floorDetails', 'moveSize', 'numberOfBedrooms',
  ];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) booking[field] = req.body[field];
  });

  if (req.body.moveDate) booking.moveDate = new Date(req.body.moveDate);

  await booking.save();
  logger.info(`Booking ${booking.bookingNumber} updated by ${req.user.email}`);

  res.json({ success: true, data: booking });
});

/**
 * @route   DELETE /api/bookings/:id
 * @access  Private (Client: own Pending; Admin/OperationsManager: any)
 */
const deleteBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (req.user.role === 'Client') {
    if (booking.client.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (booking.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'You can only delete Pending bookings' });
    }
  } else if (!['Admin', 'OperationsManager'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const ref = booking.bookingNumber || booking._id.toString();
  await booking.deleteOne();
  logger.info(`Booking ${ref} deleted by ${req.user.email}`);
  logActivity(req, 'booking.deleted', 'Booking', booking._id, ref);

  res.json({ success: true, message: 'Booking deleted successfully' });
});

module.exports = {
  createBooking, getBookings, getBookingById, updateBookingStatus,
  assignCrew, uploadPhotos, updatePaymentStatus,
  cancelBooking, updateBooking, deleteBooking,
};
