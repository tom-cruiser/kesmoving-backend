const mongoose = require('mongoose');

const BOOKING_STATUSES = ['Pending', 'Confirmed', 'Scheduled', 'InProgress', 'Completed', 'Cancelled'];
const PAYMENT_STATUSES = ['Pending', 'Charged', 'Paid'];

const addressSchema = new mongoose.Schema({
  street: { type: String, required: true },
  city: { type: String, required: true },
  province: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, default: 'Canada' },
  coordinates: {
    lat: Number,
    lng: Number,
  },
}, { _id: false });

const aiEstimateSchema = new mongoose.Schema({
  itemsDetected: [String],
  estimatedVolume: Number,
  estimatedWeight: Number,
  recommendedTruck: String,
  loadingTime: Number,
  aiConfidence: Number,
  estimatedPrice: Number,
  needsManualReview: { type: Boolean, default: false },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNotes: String,
  rawAiResponse: mongoose.Schema.Types.Mixed,
}, { _id: false });

const crewAssignmentSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  movers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck' },
  assignedAt: { type: Date, default: Date.now },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const bookingSchema = new mongoose.Schema(
  {
    bookingNumber: { type: String, unique: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pickupAddress: { type: addressSchema, required: true },
    destinationAddress: { type: addressSchema, required: true },
    moveDate: { type: Date, required: true, index: true },
    moveTime: { type: String },
    status: { type: String, enum: BOOKING_STATUSES, default: 'Pending', index: true },
    itemPhotos: [
      {
        url: { type: String, required: true },
        filename: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    aiEstimate: aiEstimateSchema,
    crewAssignment: crewAssignmentSchema,
    specialInstructions: { type: String, maxlength: 1000 },
    moveType: {
      type: String,
      enum: ['Residential', 'Commercial', 'Storage', 'LongDistance'],
      default: 'Residential',
    },
    floorDetails: {
      pickupFloor: Number,
      destinationFloor: Number,
      hasElevator: { type: Boolean, default: false },
    },
    payment: {
      status: { type: String, enum: PAYMENT_STATUSES, default: 'Pending' },
      amount: Number,
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      updatedAt: Date,
      notes: String,
    },
    timeline: [
      {
        status: { type: String, enum: BOOKING_STATUSES },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
      },
    ],
    review: { type: mongoose.Schema.Types.ObjectId, ref: 'Review' },
    moveSize: { type: String },
    numberOfBedrooms: { type: Number, default: 0 },
    cancellationReason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Auto-generate booking number
bookingSchema.pre('save', async function (next) {
  if (!this.bookingNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    this.bookingNumber = `NM-${timestamp}-${rand}`;
  }
  next();
});

// Track status timeline
bookingSchema.pre('save', function (next) {
  if (this.isModified('status') && !this.isNew) {
    this.timeline.push({ status: this.status });
  }
  next();
});

bookingSchema.index({ client: 1, status: 1 });
bookingSchema.index({ moveDate: 1 });
bookingSchema.index({ 'crewAssignment.driver': 1 });
bookingSchema.index({ bookingNumber: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
