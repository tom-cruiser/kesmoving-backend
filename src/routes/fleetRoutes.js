const express = require('express');
const { body, param } = require('express-validator');
const {
  getFleet, createTruck, getTruckById, updateTruck, updateTruckLocation, deleteTruck,
} = require('../controllers/fleetController');
const { protect, authorize, staffOnly } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.get('/', staffOnly, getFleet);

router.post(
  '/',
  authorize('Admin', 'OperationsManager'),
  [
    body('truckId').notEmpty().withMessage('Truck ID required'),
    body('name').notEmpty(),
    body('licensePlate').notEmpty(),
    body('make').notEmpty(),
    body('model').notEmpty(),
    body('year').isInt({ min: 1990, max: 2030 }),
    body('capacity.volume').isNumeric(),
    body('capacity.weight').isNumeric(),
    body('capacity.label').isIn(['Small Truck', 'Medium Truck', 'Large Truck', 'Extra Large Truck']),
  ],
  validate,
  createTruck
);

router.get('/:id', staffOnly, [param('id').isMongoId()], validate, getTruckById);

router.put(
  '/:id',
  authorize('Admin', 'OperationsManager'),
  [param('id').isMongoId()],
  validate,
  updateTruck
);

router.put(
  '/:id/location',
  authorize('Driver', 'Admin', 'OperationsManager'),
  [
    param('id').isMongoId(),
    body('lat').isNumeric().withMessage('Latitude required'),
    body('lng').isNumeric().withMessage('Longitude required'),
  ],
  validate,
  updateTruckLocation
);

router.delete('/:id', authorize('Admin'), [param('id').isMongoId()], validate, deleteTruck);

module.exports = router;
