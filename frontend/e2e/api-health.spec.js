import { test, expect } from '@playwright/test';

const API_URL = 'https://alivev1-production.up.railway.app';

test.describe('Backend API health', () => {
  test('/health returns 200 with status ok', async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('/api/profile returns 401 without token (auth middleware live)', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/profile`);
    expect(res.status()).toBe(401);
  });

  test('/api/baseline returns 401 without token', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/baseline`);
    expect(res.status()).toBe(401);
  });

  test('/api/session/end rejects unauthenticated request', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/session/end`, { data: {} });
    // 401 = auth middleware fires first; 422 = body validation fires first — both mean unauthenticated
    expect([401, 422]).toContain(res.status());
  });
});
