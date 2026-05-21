const express = require("express");
const { body, param } = require("express-validator");
const {
  generateEstimate,
  reviewEstimate,
  analyzePhotos,
  generateAgentEstimate,
  publicQuote,
} = require("../controllers/estimateController");
const { protect, authorize } = require("../middleware/auth");
const validate = require("../middleware/validate");

const router = express.Router();

// ── Public (no auth) ─────────────────────────────────────────────────────────
router.post(
  "/public-quote",
  [
    body("bedrooms").optional().isInt({ min: 0, max: 10 }),
    body("moveDate").optional().isString(),
  ],
  validate,
  publicQuote,
);

// Stateless photo analysis for landing + new-booking flows (no auth required)
router.post("/analyze", analyzePhotos);

router.use(protect);

// Text-based logistics estimate agent for strict 2026 pricing output.
router.post(
  "/agent",
  [
    body("userRequest")
      .isString()
      .trim()
      .isLength({ min: 8 })
      .withMessage("userRequest is required"),
  ],
  validate,
  generateAgentEstimate,
);

router.post(
  "/",
  [body("bookingId").isMongoId().withMessage("Valid booking ID required")],
  validate,
  generateEstimate,
);

router.put(
  "/:bookingId/review",
  authorize("Admin", "Sales", "OperationsManager"),
  [
    param("bookingId").isMongoId(),
    body("estimatedPrice").optional().isNumeric(),
    body("confirm").optional().isBoolean(),
  ],
  validate,
  reviewEstimate,
);

module.exports = router;
