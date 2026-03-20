const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');

/**
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30, unreadOnly } = req.query;
  const query = { recipient: req.user._id };
  if (unreadOnly === 'true') query.isRead = false;

  const skip = (Number(page) - 1) * Number(limit);
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Notification.countDocuments(query),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);

  res.json({ success: true, data: notifications, unreadCount, pagination: { total, page: Number(page) } });
});

/**
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, recipient: req.user._id }, { isRead: true });
  res.json({ success: true });
});

/**
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
  res.json({ success: true });
});

module.exports = { getNotifications, markAsRead, markAllAsRead };
