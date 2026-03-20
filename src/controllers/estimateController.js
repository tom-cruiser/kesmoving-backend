const path = require('path');
const aiService = require('../services/aiService');
const Booking = require('../models/Booking');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

/**
 * @route   POST /api/estimate
 * @access  Private/Client (or staff)
 * Expects bookingId and that photos are already on the booking
 */
const generateEstimate = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  const booking = await Booking.findById(bookingId).populate('client', 'firstName lastName email phone notificationPreferences');
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  // Authorization: client can only request estimate for own booking
  if (req.user.role === 'Client' && booking.client._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (!booking.itemPhotos || booking.itemPhotos.length === 0) {
    return res.status(400).json({ success: false, message: 'Please upload item photos before requesting an estimate' });
  }

  const photoUrls = booking.itemPhotos.map((p) => p.url);
  const estimate = await aiService.analyzeItems(photoUrls);

  // Flag for manual review if confidence is below threshold
  const CONFIDENCE_THRESHOLD = parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || '0.70');
  estimate.needsManualReview = estimate.aiConfidence < CONFIDENCE_THRESHOLD;

  booking.aiEstimate = estimate;

  if (estimate.needsManualReview) {
    booking.status = 'Pending'; // Keep pending for sales review
    await notificationService.notifySalesTeamForReview(booking);
    logger.warn(`Booking ${booking.bookingNumber}: Low AI confidence (${estimate.aiConfidence}) — sent for manual review`);
  } else {
    booking.status = 'Confirmed';
    booking.timeline.push({ status: 'Confirmed', changedBy: req.user._id, note: 'AI estimate generated' });
    await notificationService.sendBookingStatusNotification(booking, 'Confirmed', req.user);
  }

  await booking.save();

  res.json({
    success: true,
    data: { estimate: booking.aiEstimate, needsManualReview: estimate.needsManualReview, booking },
  });
});

/**
 * @route   PUT /api/estimate/:bookingId/review
 * @access  Private/Sales, Admin
 */
const reviewEstimate = asyncHandler(async (req, res) => {
  const { estimatedPrice, estimatedVolume, loadingTime, recommendedTruck, reviewNotes, notes, confirm } = req.body;
  const noteText = reviewNotes || notes;

  const booking = await Booking.findById(req.params.bookingId).populate('client', 'firstName lastName email phone notificationPreferences');
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  // If no aiEstimate yet, create an empty shell so the admin override can still proceed
  if (!booking.aiEstimate) {
    booking.aiEstimate = {};
  }

  booking.aiEstimate.reviewedBy = req.user._id;
  booking.aiEstimate.reviewedAt = new Date();
  booking.aiEstimate.reviewNotes = noteText;
  booking.aiEstimate.needsManualReview = false;

  if (estimatedPrice != null) booking.aiEstimate.estimatedPrice = estimatedPrice;
  if (estimatedVolume != null) booking.aiEstimate.estimatedVolume = estimatedVolume;
  if (loadingTime != null) booking.aiEstimate.loadingTime = loadingTime;
  if (recommendedTruck) booking.aiEstimate.recommendedTruck = recommendedTruck;

  if (confirm) {
    booking.status = 'Confirmed';
    booking.timeline.push({ status: 'Confirmed', changedBy: req.user._id, note: 'Manual review approved' });
    await notificationService.sendBookingStatusNotification(booking, 'Confirmed', req.user);
  }

  await booking.save();
  res.json({ success: true, data: booking });
});

/**
 * @route   POST /api/estimate/analyze
 * @access  Private
 * Accepts uploaded photos (multipart) and returns an AI estimate without
 * requiring a saved booking — used by the new-booking wizard for instant previews.
 */
const analyzePhotos = asyncHandler(async (req, res) => {
  let photoUrls = [];

  if (req.files && req.files.length > 0) {
    // Files uploaded via multer — build server-accessible paths
    photoUrls = req.files.map((f) => `uploads/items/${f.filename}`);
  } else if (Array.isArray(req.body.photoUrls) && req.body.photoUrls.length > 0) {
    photoUrls = req.body.photoUrls;
  }

  if (photoUrls.length === 0) {
    return res.status(400).json({ success: false, message: 'Provide at least one photo' });
  }

  const estimate = await aiService.analyzeItems(photoUrls);
  res.json({ success: true, data: { ...estimate, photoUrls } });
});

module.exports = { generateEstimate, reviewEstimate, analyzePhotos };
