const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');

beforeAll(async () => {
  const TEST_DB = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/kesmoving_test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_DB);
  }
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  // Individual suite cleanup — full close handled by globalTeardown
});

describe('POST /api/auth/register', () => {
  it('registers a new user and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.email).toBe('alice@example.com');
    expect(res.body.data.user.role).toBe('Client');
  });

  it('rejects registration with duplicate email', async () => {
    const payload = {
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@example.com',
      password: 'Password123!',
    };
    await request(app).post('/api/auth/register').send(payload);
    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.status).toBe(409);
  });

  it('rejects registration with missing required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'incomplete@example.com' });

    // express-validator returns 422 Unprocessable Entity for validation failures
    expect([400, 422]).toContain(res.status);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send({
      firstName: 'Carol',
      lastName: 'White',
      email: 'carol@example.com',
      password: 'Password123!',
    });
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carol@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('refreshToken');
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carol@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('rejects non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password123!' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/profile', () => {
  let token;

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/register').send({
      firstName: 'Dave',
      lastName: 'Brown',
      email: 'dave@example.com',
      password: 'Password123!',
    });
    token = res.body.data.token;
  });

  it('returns profile for authenticated user', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('dave@example.com');
  });

  it('returns 401 when no token provided', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });
});
