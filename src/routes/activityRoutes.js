const express = require('express');
const { getActivities } = require('../controllers/activityController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('Admin', 'OperationsManager'));

router.get('/', getActivities);

module.exports = router;
