process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Cheap argon2 so auth tests stay fast (production defaults come from env.ts).
process.env.ARGON2_MEMORY_COST ??= '1024';
process.env.ARGON2_TIME_COST ??= '1';
// Fake R2 settings (T-008); the S3 client is always mocked in tests, nothing reaches a network.
process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key-VALUE';
process.env.R2_BUCKET_NAME ??= 'test-bucket';
process.env.R2_ENDPOINT ??= 'https://test-account.r2.cloudflarestorage.com';
process.env.R2_PUBLIC_BASE_URL ??= 'https://cdn.furnixa.test';
