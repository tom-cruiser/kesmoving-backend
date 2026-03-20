const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = [
  'Admin',
  'OperationsManager',
  'CustomerService',
  'Sales',
  'Driver',
  'Mover',
  'WarehouseWorker',
  'Packer',
  'QualityAssurance',
  'ITSupport',
  'Marketing',
  'Client',
];

const notificationPreferencesSchema = new mongoose.Schema({
  email: { type: Boolean, default: true },
  sms: { type: Boolean, default: true },
  inApp: { type: Boolean, default: true },
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    phone: { type: String, trim: true },
    role: { type: String, enum: ROLES, default: 'Client' },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
    avatar: { type: String },
    address: {
      street: String,
      city: String,
      province: String,
      postalCode: String,
      country: { type: String, default: 'Canada' },
    },
    notificationPreferences: { type: notificationPreferencesSchema, default: () => ({}) },
    lastLogin: { type: Date },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    refreshToken: { type: String, select: false },
  },
  { timestamps: true }
);

// Indexes
userSchema.index({ role: 1 });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_, ret) => {
    delete ret.password;
    delete ret.refreshToken;
    delete ret.passwordResetToken;
    delete ret.passwordResetExpires;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
