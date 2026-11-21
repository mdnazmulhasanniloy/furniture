process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Cheap argon2 so auth tests stay fast (production defaults come from env.ts).
process.env.ARGON2_MEMORY_COST ??= '1024';
process.env.ARGON2_TIME_COST ??= '1';
