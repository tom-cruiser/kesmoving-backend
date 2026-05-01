const Truck = require('../models/Truck');
const Booking = require('../models/Booking');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { emitTruckTrackingUpdate } = require('../utils/trackingEvents');
const logActivity = require('../utils/activity');

/**
 * @route   GET /api/fleet
 * @access  Private/Staff
 */
const getFleet = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const query = {};
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { licensePlate: { $regex: search, $options: 'i' } },
      { truckId: { $regex: search, $options: 'i' } },
    ];
  }

  const trucks = await Truck.find(query)
    .populate('driver', 'firstName lastName phone')
    .populate('activeBooking', 'bookingNumber moveDate status')
    .sort({ truckId: 1 });

  res.json({ success: true, data: trucks });
});

/**
 * @route   POST /api/fleet
 * @access  Private/Admin, OperationsManager
 */
const createTruck = asyncHandler(async (req, res) => {
  const truck = await Truck.create(req.body);
  logger.info(`Truck created: ${truck.truckId} by ${req.user.email}`);
  logActivity(req, 'fleet.truck_created', 'Truck', truck._id, truck.licensePlate || truck.truckId);
  res.status(201).json({ success: true, data: truck });
});

/**
 * @route   GET /api/fleet/:id
 * @access  Private/Staff
 */
const getTruckById = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.id)
    .populate('driver', 'firstName lastName phone email')
    .populate('activeBooking', 'bookingNumber moveDate status client pickupAddress destinationAddress');

  if (!truck) return res.status(404).json({ success: false, message: 'Truck not found' });
  res.json({ success: true, data: truck });
});

/**
 * @route   PUT /api/fleet/:id
 * @access  Private/Admin, OperationsManager
 */
const updateTruck = asyncHandler(async (req, res) => {
  const truck = await Truck.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!truck) return res.status(404).json({ success: false, message: 'Truck not found' });
  logActivity(req, 'fleet.truck_updated', 'Truck', truck._id, truck.licensePlate || truck.truckId);
  res.json({ success: true, data: truck });
});

/**
 * @route   PUT /api/fleet/:id/location
 * @access  Private/Driver
 */
const updateTruckLocation = asyncHandler(async (req, res) => {
  const { lat, lng, address } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ success: false, message: 'lat and lng must be numeric values' });
  }

  const truck = await Truck.findByIdAndUpdate(
    req.params.id,
    { currentLocation: { lat, lng, address, updatedAt: new Date() } },
    { new: true }
  );

  if (!truck) return res.status(404).json({ success: false, message: 'Truck not found' });

  // Emit socket event for real-time tracking
  const io = req.app.get('io');
  if (io) {
    emitTruckTrackingUpdate(io.of('/tracking'), truck, truck.currentLocation);
  }

  res.json({ success: true, data: { truckId: truck._id, location: truck.currentLocation } });
});

/**
 * @route   DELETE /api/fleet/:id
 * @access  Private/Admin
 */
const deleteTruck = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.id);
  if (!truck) return res.status(404).json({ success: false, message: 'Truck not found' });

  if (truck.status === 'InUse') {
    return res.status(400).json({ success: false, message: 'Cannot delete a truck currently in use' });
  }

  await truck.deleteOne();
  logger.info(`Truck deleted: ${truck.truckId} by ${req.user.email}`);
  logActivity(req, 'fleet.truck_deleted', 'Truck', truck._id, truck.licensePlate || truck.truckId);
  res.json({ success: true, message: 'Truck removed from fleet' });
});

module.exports = { getFleet, createTruck, getTruckById, updateTruck, updateTruckLocation, deleteTruck };
