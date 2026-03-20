// Global teardown: drop the test database and close the connection after all suites finish
const mongoose = require('mongoose');

module.exports = async function globalTeardown() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
};
