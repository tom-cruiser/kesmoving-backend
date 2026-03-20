const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    ratings: {
      overall: { type: Number, required: true, min: 1, max: 5 },
      professionalism: { type: Number, min: 1, max: 5 },
      timeliness: { type: Number, min: 1, max: 5 },
      carefulHandling: { type: Number, min: 1, max: 5 },
      valueForMoney: { type: Number, min: 1, max: 5 },
    },
    comment: { type: String, maxlength: 2000 },
    isPublished: { type: Boolean, default: true },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    adminResponse: {
      text: String,
      respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      respondedAt: Date,
    },
  },
  { timestamps: true }
);

const Review = mongoose.model('Review', reviewSchema);
module.exports = Review;
