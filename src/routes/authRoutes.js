const express = require('express');
const { body, param } = require('express-validator');
const {
  register, login, getProfile, updateProfile, refreshToken, logout, getAllUsers, updateUserRole, resetUserPassword,
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../models/User');

const router = express.Router();

router.post(
  '/register',
  [
    body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }),
    body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('phone').optional({ checkFalsy: true }).isMobilePhone().withMessage('Invalid phone number'),
  ],
  validate,
  register
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  login
);

router.post('/refresh', refreshToken);
router.post('/logout', protect, logout);
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);

// Admin routes
router.get('/users', protect, authorize('Admin', 'OperationsManager'), getAllUsers);
router.put(
  '/users/:id/role',
  protect,
  authorize('Admin'),
  [
    param('id').isMongoId(),
    body('role').optional().isIn(ROLES).withMessage('Invalid role'),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  updateUserRole
);

router.put(
  '/users/:id/password',
  protect,
  authorize('Admin'),
  [
    param('id').isMongoId(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  resetUserPassword
);

module.exports = router;
