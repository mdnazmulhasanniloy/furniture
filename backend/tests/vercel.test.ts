import request from 'supertest';
import { describe, expect, it } from 'vitest';
import handler from '../api/index.js';

describe('vercel entry', () => {
  it('NFR-04 · api/index.ts default export is the Express app and answers /health', async () => {
    expect(typeof handler).toBe('function');
    const res = await request(handler).get('/health');
    expect(res.status).toBe(200);
  });
});
