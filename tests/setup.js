// Set environment variables before any module is loaded
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/kesmoving';
process.env.MONGO_URI_TEST = 'mongodb://localhost:27017/kesmoving_test';
process.env.JWT_SECRET = 'test_jwt_secret_for_jest_only';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_for_jest_only';
process.env.JWT_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '7d';
process.env.PORT = '0'; // let OS assign a random port — prevents conflicts
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.AI_CONFIDENCE_THRESHOLD = '0.70';
