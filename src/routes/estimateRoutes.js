const express = require("express");
const { body, param } = require("express-validator");
const {
  generateEstimate,
  reviewEstimate,
  analyzePhotos,
  generateAgentEstimate,
} = require("../controllers/estimateController");
const { protect, authorize } = require("../middleware/auth");
const validate = require("../middleware/validate");

const router = express.Router();

router.use(protect);

// Stateless photo analysis — no booking required (used by new-booking wizard)
router.post("/analyze", analyzePhotos);

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
