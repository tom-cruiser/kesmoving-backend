const express = require('express');
const { body, param } = require('express-validator');
const { generateEstimate, reviewEstimate, analyzePhotos } = require('../controllers/estimateController');
const { protect, authorize } = require('../middleware/auth');
const { uploadItemPhotos, handleUploadError } = require('../middleware/upload');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

// Stateless photo analysis — no booking required (used by new-booking wizard)
router.post('/analyze', uploadItemPhotos, handleUploadError, analyzePhotos);

router.post(
  '/',
  [body('bookingId').isMongoId().withMessage('Valid booking ID required')],
  validate,
  generateEstimate
);

router.put(
  '/:bookingId/review',
  authorize('Admin', 'Sales', 'OperationsManager'),
  [
    param('bookingId').isMongoId(),
    body('estimatedPrice').optional().isNumeric(),
    body('confirm').optional().isBoolean(),
  ],
  validate,
  reviewEstimate
);

module.exports = router;
