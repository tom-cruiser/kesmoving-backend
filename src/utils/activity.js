const ActivityLog = require('../models/ActivityLog');
const logger = require('./logger');

/**
 * Record an activity. Accepts either a req object (req.user) or a plain user object.
 * Never throws — a logging failure must never break the response.
 */
const logActivity = async (actorOrReq, action, resourceType, resourceId, resourceRef, details = {}) => {
  try {
    let actor, actorName, actorRole, ip;

    if (actorOrReq && actorOrReq.user) {
      actor = actorOrReq.user._id;
      actorName = `${actorOrReq.user.firstName} ${actorOrReq.user.lastName}`;
      actorRole = actorOrReq.user.role;
      ip = actorOrReq.ip;
    } else {
      actor = actorOrReq._id;
      actorName = `${actorOrReq.firstName} ${actorOrReq.lastName}`;
      actorRole = actorOrReq.role;
    }

    await ActivityLog.create({ actor, actorName, actorRole, action, resourceType, resourceId, resourceRef, details, ip });
  } catch (err) {
    logger.error(`Activity log failed: ${err.message}`);
  }
};

module.exports = logActivity;
