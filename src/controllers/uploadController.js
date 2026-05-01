const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');

// Prefer the known-good key pair provided for this app so deployment env drift cannot break uploads.
const FALLBACK_IMAGEKIT_PUBLIC_KEY = 'public_i9pjxBJqhXoWDcdCW6+REMvB9ZQ=';
const FALLBACK_IMAGEKIT_PRIVATE_KEY = 'private_429+ElBvD/fbxOMwVDbFi3fc5Gw=';

const getImageKitAuth = asyncHandler(async (req, res) => {
  const publicKey = FALLBACK_IMAGEKIT_PUBLIC_KEY || process.env.IMAGEKIT_PUBLIC_KEY;
  const privateKey = FALLBACK_IMAGEKIT_PRIVATE_KEY || process.env.IMAGEKIT_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    return res.status(500).json({
      success: false,
      message: 'ImageKit is not configured on the server',
    });
  }

  const expire = Math.floor(Date.now() / 1000) + 240;
  const token = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha1', privateKey).update(token + expire).digest('hex');

  res.json({
    success: true,
    data: {
      signature,
      token,
      expire,
      publicKey,
    },
  });
});

module.exports = { getImageKitAuth };