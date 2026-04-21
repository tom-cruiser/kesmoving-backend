const path = require("path");
const aiService = require("../services/aiService");
const logisticsAgentService = require("../services/logisticsAgentService");
const Booking = require("../models/Booking");
const asyncHandler = require("../utils/asyncHandler");
const logger = require("../utils/logger");
const notificationService = require("../services/notificationService");

/**
 * @route   POST /api/estimate
 * @access  Private/Client (or staff)
 * Expects bookingId and that photos are already on the booking
 */
const generateEstimate = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  const booking = await Booking.findById(bookingId).populate(
    "client",
    "firstName lastName email phone notificationPreferences",
  );
  if (!booking)
    return res
      .status(404)
      .json({ success: false, message: "Booking not found" });

  // Authorization: client can only request estimate for own booking
  if (
    req.user.role === "Client" &&
    booking.client._id.toString() !== req.user._id.toString()
  ) {
    return res.status(403).json({ success: false, message: "Not authorized" });
  }

  if (!booking.itemPhotos || booking.itemPhotos.length === 0) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Please upload item photos before requesting an estimate",
      });
  }

  const photoUrls = booking.itemPhotos.map((p) => p.url);
  const bedrooms = Number(booking.numberOfBedrooms) || 1;

  // Step 1: vision only
  const vision = await aiService.analyzeItems(photoUrls, bedrooms);

  // Step 2: pricing only (trusted logistics engine)
  const pricing = await logisticsAgentService.generateEstimate({
    pickup: {
      address: `${booking.pickupAddress.street}, ${booking.pickupAddress.city}`,
      province: booking.pickupAddress.province,
      elevator: booking.floorDetails?.hasElevator,
    },
    destination: {
      address: `${booking.destinationAddress.street}, ${booking.destinationAddress.city}`,
      province: booking.destinationAddress.province,
      elevator: booking.floorDetails?.hasElevator,
      floor: booking.floorDetails?.destinationFloor,
    },
    bedrooms,
    move_date: booking.moveDate
      ? new Date(booking.moveDate).toISOString().slice(0, 10)
      : "",
    notes: booking.specialInstructions || "",
    hasPiano: vision.hasPiano,
    hasPoolTable: vision.hasPoolTable,
    hasSafe: vision.hasSafe,
    photos: photoUrls,
  });

  // Step 3: merge response fields for booking estimate
  const estimate = {
    ...vision,
    estimatedPrice: Number(pricing.total_cad) || 0,
  };

  // All AI estimates go through admin review so pricing and time can be adjusted before approval.
  estimate.needsManualReview = true;

  booking.aiEstimate = estimate;
  booking.status = "Pending";
  await notificationService.notifySalesTeamForReview(booking);
  logger.info(
    `Booking ${booking.bookingNumber}: AI estimate generated and sent for admin review (${estimate.aiConfidence} confidence)`,
  );

  await booking.save();

  res.json({
    success: true,
    data: {
      estimate: booking.aiEstimate,
      needsManualReview: estimate.needsManualReview,
      pricing,
      booking,
    },
  });
});

/**
 * @route   PUT /api/estimate/:bookingId/review
 * @access  Private/Sales, Admin
 */
const reviewEstimate = asyncHandler(async (req, res) => {
  const {
    estimatedPrice,
    estimatedVolume,
    loadingTime,
    recommendedTruck,
    reviewNotes,
    notes,
    confirm,
  } = req.body;
  const noteText = reviewNotes || notes;

  const booking = await Booking.findById(req.params.bookingId).populate(
    "client",
    "firstName lastName email phone notificationPreferences",
  );
  if (!booking)
    return res
      .status(404)
      .json({ success: false, message: "Booking not found" });

  // If no aiEstimate yet, create an empty shell so the admin override can still proceed
  if (!booking.aiEstimate) {
    booking.aiEstimate = {};
  }

  booking.aiEstimate.reviewedBy = req.user._id;
  booking.aiEstimate.reviewedAt = new Date();
  booking.aiEstimate.reviewNotes = noteText;
  booking.aiEstimate.needsManualReview = false;

  if (estimatedPrice != null)
    booking.aiEstimate.estimatedPrice = estimatedPrice;
  if (estimatedVolume != null)
    booking.aiEstimate.estimatedVolume = estimatedVolume;
  if (loadingTime != null) booking.aiEstimate.loadingTime = loadingTime;
  if (recommendedTruck) booking.aiEstimate.recommendedTruck = recommendedTruck;

  if (confirm) {
    booking.status = "Confirmed";
    booking.timeline.push({
      status: "Confirmed",
      changedBy: req.user._id,
      note: "Manual review approved",
    });
    await notificationService.sendBookingStatusNotification(
      booking,
      "Confirmed",
      req.user,
    );
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
  } else if (
    Array.isArray(req.body.photoUrls) &&
    req.body.photoUrls.length > 0
  ) {
    photoUrls = req.body.photoUrls;
  }

  if (photoUrls.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Provide at least one photo" });
  }

  const bedrooms = Number(req.body.bedrooms || req.body.numberOfBedrooms) || 1;

  // Step 1: vision only
  const vision = await aiService.analyzeItems(photoUrls, bedrooms);

  // Step 2: pricing only (trusted logistics engine)
  const estimate = await logisticsAgentService.generateEstimate({
    pickup: req.body.pickup || {
      address: req.body.pickupAddress,
      province: req.body.pickupProvince,
      elevator: req.body.pickupElevator,
    },
    destination: req.body.destination || {
      address: req.body.destinationAddress,
      province: req.body.destinationProvince,
      elevator: req.body.destinationElevator,
      floor: req.body.destinationFloor,
    },
    bedrooms,
    move_date: req.body.move_date || req.body.moveDate || "",
    notes: req.body.notes || "",
    hasPiano: vision.hasPiano,
    hasPoolTable: vision.hasPoolTable,
    hasSafe: vision.hasSafe,
    photos: photoUrls,
  });

  // Step 3: return merged response
  res.json({
    success: true,
    data: {
      ...estimate,
      estimatedPrice: Number(estimate.total_cad) || 0,
      estimatedVolume: vision.estimatedVolume,
      recommendedTruck: vision.recommendedTruck,
      loadingTime: vision.loadingTime,
      itemsDetected: vision.itemsDetected,
      aiConfidence: vision.aiConfidence,
      estimatedWeight: vision.estimatedWeight,
      hasPiano: vision.hasPiano,
      hasPoolTable: vision.hasPoolTable,
      hasSafe: vision.hasSafe,
      needsManualReview: true,
      photoUrls,
      rawAiResponse: vision.rawAiResponse,
    },
  });
});

/**
 * @route   POST /api/estimate/agent
 * @access  Private
 * Generates a logistics estimate from free-text move details.
 */
const generateAgentEstimate = asyncHandler(async (req, res) => {
  const estimate = await logisticsAgentService.generateEstimate(
    req.body.userRequest,
  );

  // Endpoint returns strict estimate JSON for direct frontend use.
  res.json(estimate);
});

module.exports = {
  generateEstimate,
  reviewEstimate,
  analyzePhotos,
  generateAgentEstimate,
};
