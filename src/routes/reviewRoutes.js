const express = require('express');
const { body, param } = require('express-validator');
const { createReview, getReviewByBooking, getReviews, respondToReview } = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.get('/', getReviews);
router.get('/:bookingId', protect, [param('bookingId').isMongoId()], validate, getReviewByBooking);

router.post(
  '/',
  protect,
  authorize('Client'),
  [
    body('bookingId').isMongoId().withMessage('Valid booking ID required'),
    body('ratings.overall').isInt({ min: 1, max: 5 }).withMessage('Overall rating (1-5) required'),
    body('comment').optional().isLength({ max: 2000 }),
  ],
  validate,
  createReview
);

router.put(
  '/:id/respond',
  protect,
  authorize('Admin', 'CustomerService', 'OperationsManager'),
  [param('id').isMongoId(), body('text').notEmpty().isLength({ max: 1000 })],
  validate,
  respondToReview
);

module.exports = router;
