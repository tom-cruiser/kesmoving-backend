const Review = require('../models/Review');
const Booking = require('../models/Booking');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @route   POST /api/reviews
 * @access  Private/Client
 */
const createReview = asyncHandler(async (req, res) => {
  const { bookingId, ratings, comment } = req.body;

  const booking = await Booking.findById(bookingId);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (booking.client.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'You can only review your own bookings' });
  }

  if (booking.status !== 'Completed') {
    return res.status(400).json({ success: false, message: 'You can only review completed bookings' });
  }

  if (booking.review) {
    return res.status(409).json({ success: false, message: 'You have already reviewed this booking' });
  }

  const review = await Review.create({
    booking: bookingId,
    client: req.user._id,
    ratings,
    comment,
  });

  booking.review = review._id;
  await booking.save();

  res.status(201).json({ success: true, data: review });
});

/**
 * @route   GET /api/reviews/:bookingId
 * @access  Private
 */
const getReviewByBooking = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ booking: req.params.bookingId })
    .populate('client', 'firstName lastName avatar')
    .populate('moderatedBy', 'firstName lastName');

  if (!review) return res.status(404).json({ success: false, message: 'No review for this booking' });

  res.json({ success: true, data: review });
});

/**
 * @route   GET /api/reviews
 * @access  Public/Private
 */
const getReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, minRating } = req.query;
  const query = { isPublished: true };
  if (minRating) query['ratings.overall'] = { $gte: Number(minRating) };

  const skip = (Number(page) - 1) * Number(limit);
  const [reviews, total] = await Promise.all([
    Review.find(query)
      .populate('client', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: reviews,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  });
});

/**
 * @route   PUT /api/reviews/:id/respond  (Admin/CustomerService)
 */
const respondToReview = asyncHandler(async (req, res) => {
  const { text } = req.body;
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { adminResponse: { text, respondedBy: req.user._id, respondedAt: new Date() } },
    { new: true }
  );
  if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
  res.json({ success: true, data: review });
});

module.exports = { createReview, getReviewByBooking, getReviews, respondToReview };
