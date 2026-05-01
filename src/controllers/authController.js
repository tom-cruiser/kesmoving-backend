const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });

const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d',
  });

/**
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phone } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists' });
  }

  const user = await User.create({ firstName, lastName, email, password, phone, role: 'Client' });

  const token = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logger.info(`New client registered: ${user.email}`);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: { token, refreshToken, user },
  });
});

/**
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }

  if (!user.isActive) {
    return res.status(401).json({ success: false, message: 'Account has been deactivated. Contact support.' });
  }

  const token = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Remove password from output
  user.password = undefined;

  logger.info(`User logged in: ${user.email} (${user.role})`);

  res.json({
    success: true,
    data: { token, refreshToken, user },
  });
});

/**
 * @route   GET /api/auth/profile
 * @access  Private
 */
const getProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user });
});

/**
 * @route   PUT /api/auth/profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'phone', 'address', 'notificationPreferences'];
  const updates = {};
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  const user = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  });

  res.json({ success: true, data: user });
});

/**
 * @route   POST /api/auth/refresh
 * @access  Public
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Refresh token required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }

  const user = await User.findById(decoded.id).select('+refreshToken');
  if (!user || user.refreshToken !== token) {
    return res.status(401).json({ success: false, message: 'Refresh token revoked' });
  }

  const newToken = generateToken(user._id);
  const newRefresh = generateRefreshToken(user._id);
  user.refreshToken = newRefresh;
  await user.save({ validateBeforeSave: false });

  res.json({ success: true, data: { token: newToken, refreshToken: newRefresh } });
});

/**
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * @route   GET /api/auth/users  (Admin only)
 * @access  Private/Admin
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 20 } = req.query;
  const query = {};
  if (role) query.role = role;
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(query).skip(skip).limit(Number(limit)).sort({ createdAt: -1 }),
    User.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: users,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  });
});

/**
 * @route   PUT /api/auth/users/:id/role  (Admin only)
 */
const updateUserRole = asyncHandler(async (req, res) => {
  const { role, isActive } = req.body;
  const updates = {};
  if (role) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;

  const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  res.json({ success: true, data: user });
});

/**
 * @route   PUT /api/auth/users/:id/password  (Admin only)
 */
const resetUserPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;

  const user = await User.findById(req.params.id).select('+password');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.password = password;
  await user.save();

  logger.info(`Admin ${req.user._id} reset password for user ${user._id} (${user.email})`);
  res.json({ success: true, message: 'Password updated successfully' });
});

module.exports = { register, login, getProfile, updateProfile, refreshToken, logout, getAllUsers, updateUserRole, resetUserPassword };
