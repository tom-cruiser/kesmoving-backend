const mongoose = require('mongoose');

const TRUCK_STATUSES = ['Available', 'InUse', 'Maintenance', 'OutOfService'];
const MAINTENANCE_STATUSES = ['Good', 'DueForService', 'InShop', 'Critical'];

const truckSchema = new mongoose.Schema(
  {
    truckId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    licensePlate: { type: String, required: true, unique: true, uppercase: true },
    make: { type: String, required: true },
    model: { type: String, required: true },
    year: { type: Number, required: true },
    capacity: {
      volume: { type: Number, required: true, comment: 'cubic feet' },
      weight: { type: Number, required: true, comment: 'lbs' },
      label: {
        type: String,
        enum: ['Small Truck', 'Medium Truck', 'Large Truck', 'Extra Large Truck'],
        required: true,
      },
    },
    status: { type: String, enum: TRUCK_STATUSES, default: 'Available', index: true },
    maintenanceStatus: {
      type: String,
      enum: MAINTENANCE_STATUSES,
      default: 'Good',
    },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    currentLocation: {
      lat: { type: Number },
      lng: { type: Number },
      address: String,
      updatedAt: { type: Date },
    },
    activeBooking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    mileage: { type: Number, default: 0 },
    lastServiceDate: { type: Date },
    nextServiceDate: { type: Date },
    insurance: {
      provider: String,
      policyNumber: String,
      expiryDate: Date,
    },
    notes: { type: String },
    images: [String],
  },
  { timestamps: true }
);

truckSchema.index({ status: 1 });
truckSchema.index({ truckId: 1 });

const Truck = mongoose.model('Truck', truckSchema);

module.exports = Truck;
module.exports.TRUCK_STATUSES = TRUCK_STATUSES;
