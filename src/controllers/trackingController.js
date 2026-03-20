const Truck = require('../models/Truck');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @route   GET /api/tracking/:truckId
 * @access  Private
 */
const getTruckLocation = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.truckId)
    .select('truckId name licensePlate currentLocation status activeBooking driver')
    .populate('driver', 'firstName lastName phone')
    .populate('activeBooking', 'bookingNumber moveDate status client');

  if (!truck) return res.status(404).json({ success: false, message: 'Truck not found' });

  res.json({ success: true, data: truck });
});

/**
 * @route   GET /api/tracking/booking/:bookingId
 * @access  Private
 */
const getBookingTracking = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');
  const booking = await Booking.findById(req.params.bookingId)
    .populate({
      path: 'crewAssignment.truck',
      select: 'truckId name licensePlate currentLocation status',
    })
    .populate('crewAssignment.driver', 'firstName lastName phone')
    .select('bookingNumber status moveDate crewAssignment pickupAddress destinationAddress');

  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  // Client can only track own booking
  if (req.user.role === 'Client' && booking.client?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  res.json({ success: true, data: booking });
});

module.exports = { getTruckLocation, getBookingTracking };
