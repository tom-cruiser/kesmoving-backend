const express = require('express');
const { protect } = require('../middleware/auth');
const { getImageKitAuth } = require('../controllers/uploadController');

const router = express.Router();

router.use(protect);

router.get('/imagekit/auth', getImageKitAuth);

module.exports = router;