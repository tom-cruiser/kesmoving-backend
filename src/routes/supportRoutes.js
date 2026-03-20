const express = require('express');
const { body } = require('express-validator');
const { escalateConversation, resolveEscalatedConversation } = require('../controllers/supportController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.post(
  '/escalate',
  [
    body('conversationId').isMongoId().withMessage('Valid conversationId is required'),
    body('reason').optional({ checkFalsy: true }).isString().isLength({ max: 500 }),
  ],
  validate,
  escalateConversation
);

router.post(
  '/resolve',
  [
    body('conversationId').isMongoId().withMessage('Valid conversationId is required'),
  ],
  validate,
  resolveEscalatedConversation
);

module.exports = router;