/**
 * Run once to create the default admin user.
 * Usage:  node scripts/seedAdmin.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const User = require("../src/models/User");

const ADMIN = {
  firstName: "Admin",
  lastName: "Kesmoving",
  email: "admin@kesmoving.ca",
  password: "Admin@Kesmoving2026!",
  role: "Admin",
  isActive: true,
  isEmailVerified: true,
};

(async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("Missing MongoDB URI. Set MONGODB_URI (or MONGO_URI) in server/.env");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const existing = await User.findOne({ email: ADMIN.email });
  if (existing) {
    existing.firstName = ADMIN.firstName;
    existing.lastName = ADMIN.lastName;
    existing.password = ADMIN.password;
    existing.role = ADMIN.role;
    existing.isActive = ADMIN.isActive;
    existing.isEmailVerified = ADMIN.isEmailVerified;
    await existing.save();

    console.log(`✓ Admin user updated: ${ADMIN.email}`);
    console.log(`  Password reset to: ${ADMIN.password}`);
    await mongoose.disconnect();
    return;
  }

  await User.create(ADMIN);
  console.log(`✓ Admin user created`);
  console.log(`  Email:    ${ADMIN.email}`);
  console.log(`  Password: ${ADMIN.password}`);

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
