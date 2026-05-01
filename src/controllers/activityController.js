const ActivityLog = require('../models/ActivityLog');
const asyncHandler = require('../utils/asyncHandler');

const getActivities = asyncHandler(async (req, res) => {
  const { page = 1, limit = 40, action, resourceType, actorId, from, to } = req.query;

  const query = {};
  if (action) query.action = action;
  if (resourceType) query.resourceType = resourceType;
  if (actorId) query.actor = actorId;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    ActivityLog.find(query)
      .populate('actor', 'firstName lastName role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    ActivityLog.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: logs,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

module.exports = { getActivities };
