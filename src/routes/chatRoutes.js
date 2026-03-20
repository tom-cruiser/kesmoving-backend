const express = require('express');
const { body, param } = require('express-validator');
const {
  startConversation, sendMessage, getConversations,
  getAllConversations, getConversation, getConversationMessages, assignAgent, resolveConversation,
} = require('../controllers/chatController');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.get('/conversations', getConversations);
router.get('/conversations/all', authorize('Admin', 'CustomerService', 'OperationsManager'), getAllConversations);

router.post(
  '/conversations',
  [body('subject').optional().isLength({ max: 200 })],
  validate,
  startConversation
);

router.get('/conversations/:id', [param('id').isMongoId()], validate, getConversation);
router.get('/conversations/:id/messages', [param('id').isMongoId()], validate, getConversationMessages);

router.post(
  '/conversations/:id/message',
  [
    param('id').isMongoId(),
    body('content').trim().notEmpty().isLength({ max: 5000 }).withMessage('Message content required'),
    body('clientTempId').optional({ checkFalsy: true }).isString().isLength({ max: 120 }),
  ],
  validate,
  sendMessage
);

router.put(
  '/conversations/:id/assign',
  authorize('Admin', 'CustomerService', 'OperationsManager'),
  [param('id').isMongoId()],
  validate,
  assignAgent
);

router.put(
  '/conversations/:id/resolve',
  authorize('Admin', 'CustomerService', 'OperationsManager'),
  [param('id').isMongoId()],
  validate,
  resolveConversation
);

module.exports = router;
