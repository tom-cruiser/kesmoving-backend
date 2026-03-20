const express = require('express');
const { getOverview, getBookingTrend, getStaffPerformance } = require('../controllers/analyticsController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('Admin', 'OperationsManager', 'Marketing'));

router.get('/overview', getOverview);
router.get('/bookings/trend', getBookingTrend);
router.get('/staff/performance', getStaffPerformance);

module.exports = router;
