const express = require('express');
const { param } = require('express-validator');
const { getTruckLocation, getBookingTracking } = require('../controllers/trackingController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.get('/truck/:truckId', [param('truckId').isMongoId()], validate, getTruckLocation);
router.get('/booking/:bookingId', [param('bookingId').isMongoId()], validate, getBookingTracking);

module.exports = router;
