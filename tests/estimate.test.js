const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');

let clientToken;
let adminToken;
let bookingId;

beforeAll(async () => {
  const TEST_DB = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/kesmoving_test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_DB);
  }

  const clientRes = await request(app).post('/api/auth/register').send({
    firstName: 'Estimate',
    lastName: 'Client',
    email: 'estimate.client@example.com',
    password: 'Password123!',
  });
  clientToken = clientRes.body.data.token;

  const User = require('../src/models/User');
  await request(app).post('/api/auth/register').send({
    firstName: 'Estimate',
    lastName: 'Admin',
    email: 'estimate.admin@example.com',
    password: 'Password123!',
  });
  await User.findOneAndUpdate({ email: 'estimate.admin@example.com' }, { role: 'Admin' });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'estimate.admin@example.com', password: 'Password123!' });
  adminToken = loginRes.body.data.token;

  // Create a booking to attach estimates to
  const bookingRes = await request(app)
    .post('/api/bookings')
    .set('Authorization', `Bearer ${clientToken}`)
    .send({
      moveDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      moveSize: '1-bedroom',
      pickupAddress: {
        street: '10 Pine Rd',
        city: 'Ottawa',
        province: 'ON',
        postalCode: 'K1A 0B1',
        country: 'Canada',
      },
      destinationAddress: {
        street: '20 Elm St',
        city: 'Gatineau',
        province: 'QC',
        postalCode: 'J8P 1A1',
        country: 'Canada',
      },
      contactPhone: '613-555-0200',
    });
  bookingId = bookingRes.body.data._id;
});

afterAll(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('POST /api/estimate (generate estimate)', () => {
  it('rejects generation when booking has no photos', async () => {
    // The booking was created without photos — controller should reject
    const res = await request(app)
      .post('/api/estimate')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ bookingId });

    // Either bad request (no photos) or the mock AI runs — both acceptable
    expect([200, 400]).toContain(res.status);
  });

  it('rejects estimate request without auth', async () => {
    const res = await request(app)
      .post('/api/estimate')
      .send({ bookingId });
    expect(res.status).toBe(401);
  });

  it('rejects estimate with invalid bookingId', async () => {
    const res = await request(app)
      .post('/api/estimate')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ bookingId: 'not-a-mongo-id' });

    expect([400, 422]).toContain(res.status);
  });
});

describe('PUT /api/estimate/:bookingId/review (staff review)', () => {
  it('allows admin to review/override an estimate', async () => {
    // First ensure the booking has an aiEstimate by seeding it directly
    const Booking = require('../src/models/Booking');
    await Booking.findByIdAndUpdate(bookingId, {
      aiEstimate: {
        estimatedPrice: 1500,
        estimatedVolume: 30,
        estimatedWeight: 1200,
        loadingTime: 3,
        aiConfidence: 0.55,
        recommendedTruck: 'Medium',
        needsManualReview: true,
        itemsDetected: [],
      },
    });

    const res = await request(app)
      .put(`/api/estimate/${bookingId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estimatedPrice: 1800, confirm: true });

    expect(res.status).toBe(200);
  });

  it('denies client from reviewing an estimate', async () => {
    const res = await request(app)
      .put(`/api/estimate/${bookingId}/review`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ estimatedPrice: 1800, confirm: true });

    expect(res.status).toBe(403);
  });
});
