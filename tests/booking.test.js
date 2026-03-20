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

  // Register client
  const clientRes = await request(app).post('/api/auth/register').send({
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    password: 'Password123!',
  });
  clientToken = clientRes.body.data.token;

  // Register admin (directly set role via User model)
  const User = require('../src/models/User');
  const adminRes = await request(app).post('/api/auth/register').send({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@example.com',
    password: 'Password123!',
  });
  await User.findOneAndUpdate({ email: 'admin@example.com' }, { role: 'Admin' });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@example.com', password: 'Password123!' });
  adminToken = loginRes.body.data.token;
});

afterAll(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

const sampleBooking = {
  moveDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  moveSize: '2-bedroom',
  pickupAddress: {
    street: '123 Maple St',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M1A 1A1',
    country: 'Canada',
  },
  destinationAddress: {
    street: '456 Oak Ave',
    city: 'Mississauga',
    province: 'ON',
    postalCode: 'L5A 1B2',
    country: 'Canada',
  },
  contactPhone: '416-555-0100',
};

describe('POST /api/bookings', () => {
  it('creates a booking for authenticated client', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(sampleBooking);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('bookingNumber');
    expect(res.body.data.status).toBe('Pending');
    bookingId = res.body.data._id;
  });

  it('rejects booking creation without auth', async () => {
    const res = await request(app).post('/api/bookings').send(sampleBooking);
    expect(res.status).toBe(401);
  });

  it('rejects booking with missing required fields', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ moveSize: '1-bedroom' });

    // express-validator returns 422 Unprocessable Entity
    expect([400, 422]).toContain(res.status);
  });
});

describe('GET /api/bookings', () => {
  it('returns bookings list for authenticated client', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns all bookings for admin', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/bookings/:id', () => {
  it('returns booking detail for owner', async () => {
    // Create booking first to ensure bookingId is set
    const createRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(sampleBooking);
    const id = createRes.body.data._id;

    const res = await request(app)
      .get(`/api/bookings/${id}`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(id);
  });

  it('returns 404 for non-existent booking id', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/bookings/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/bookings/:id/status', () => {
  let testBookingId;

  beforeEach(async () => {
    const createRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${clientToken}`)
      .send(sampleBooking);
    testBookingId = createRes.body.data._id;
  });

  it('allows admin to update booking status', async () => {
    const res = await request(app)
      .put(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Confirmed', note: 'Confirmed by admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Confirmed');
  });

  it('rejects status update from non-admin client', async () => {
    const res = await request(app)
      .put(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'Confirmed' });

    expect(res.status).toBe(403);
  });

  it('rejects invalid status value', async () => {
    const res = await request(app)
      .put(`/api/bookings/${testBookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'NotAStatus' });

    // express-validator returns 422 for invalid enum value
    expect([400, 422]).toContain(res.status);
  });
});
