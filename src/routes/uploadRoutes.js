const express = require('express');
const rateLimit = require('express-rate-limit');
const { getImageKitAuth } = require('../controllers/uploadController');

const router = express.Router();

const publicLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 60,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, message: 'Too many upload auth requests. Please try again later.' },
});

router.get('/imagekit/auth', publicLimiter, getImageKitAuth);

module.exports = router;