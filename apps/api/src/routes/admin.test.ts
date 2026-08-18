import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { ClaimsRepository } from '../repository.js';
import { FaultController } from '../faults.js';

const silentLogger = createLogger('silent');
const testConfig = loadConfig({ NODE_ENV: 'test' });

function buildApp(faultController: FaultController, adminEnabled = true) {
  return createApp({
    config: { ...testConfig, adminEnabled },
    logger: silentLogger,
    repository: new ClaimsRepository(),
    faultController,
  });
}

let faults: FaultController;

beforeEach(() => {
  faults = new FaultController({
    latencyMinMs: 20,
    latencyMaxMs: 30,
    memoryChunkBytes: 64 * 1024,
    memoryMaxBytes: 256 * 1024,
  });
});

describe('GET /api/admin/fault', () => {
  it('reports no active fault by default', async () => {
    const response = await request(buildApp(faults)).get('/api/admin/fault');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ mode: 'none', activatedAt: null, expiresAt: null });
  });
});

describe('POST /api/admin/fault', () => {
  it('arms error mode and makes GET /api/claims fail with 500', async () => {
    const app = buildApp(faults);

    const armed = await request(app).post('/api/admin/fault').send({ mode: 'error' });
    expect(armed.status).toBe(200);
    expect(armed.body.mode).toBe('error');
    expect(armed.body.durationSeconds).toBe(300);
    expect(armed.body.expiresAt).toBeTruthy();

    const failing = await request(app).get('/api/claims');
    expect(failing.status).toBe(500);
    expect(failing.headers['content-type']).toContain('application/problem+json');
    expect(failing.body.detail).toContain('Injected fault');

    // Health must stay green so the platform can still probe the container.
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);

    const cleared = await request(app).post('/api/admin/fault').send({ mode: 'none' });
    expect(cleared.body.mode).toBe('none');

    const recovered = await request(app).get('/api/claims');
    expect(recovered.status).toBe(200);
  });

  it('honours a custom duration and auto-expires the fault', async () => {
    let clock = 1_000_000;
    const expiring = new FaultController({ now: () => clock });
    const app = buildApp(expiring);

    await request(app).post('/api/admin/fault').send({ mode: 'error', durationSeconds: 30 });
    expect((await request(app).get('/api/claims')).status).toBe(500);

    clock += 31_000;

    const state = await request(app).get('/api/admin/fault');
    expect(state.body.mode).toBe('none');
    expect((await request(app).get('/api/claims')).status).toBe(200);
  });

  it('delays responses in latency mode', async () => {
    const app = buildApp(faults);
    await request(app).post('/api/admin/fault').send({ mode: 'latency' });

    const startedAt = Date.now();
    const response = await request(app).get('/api/claims');
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it('retains memory in memory mode and frees it on reset', async () => {
    const app = buildApp(faults);

    const armed = await request(app).post('/api/admin/fault').send({ mode: 'memory' });
    expect(armed.body.mode).toBe('memory');
    expect(armed.body.retainedBytes).toBeGreaterThan(0);

    await request(app).get('/api/claims');
    const growing = await request(app).get('/api/admin/fault');
    expect(growing.body.retainedBytes).toBeGreaterThan(armed.body.retainedBytes);

    const cleared = await request(app).delete('/api/admin/fault');
    expect(cleared.body.mode).toBe('none');
    expect(cleared.body.retainedBytes).toBe(0);
  });

  it('caps retained memory at the configured ceiling', async () => {
    faults.activate('memory');
    for (let i = 0; i < 100; i += 1) faults.allocate();

    expect(faults.retainedBytes).toBeLessThanOrEqual(256 * 1024);
  });

  it('rejects an unknown fault mode', async () => {
    const response = await request(buildApp(faults))
      .post('/api/admin/fault')
      .send({ mode: 'chaos' });

    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Validation Failed');
  });
});

describe('admin guard', () => {
  it('returns 403 when ADMIN_ENABLED is false', async () => {
    const app = buildApp(faults, false);

    expect((await request(app).get('/api/admin/fault')).status).toBe(403);
    const blocked = await request(app).post('/api/admin/fault').send({ mode: 'error' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.title).toBe('Forbidden');
  });

  it('defaults to disabled in production and enabled elsewhere', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).adminEnabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development' }).adminEnabled).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', ADMIN_ENABLED: 'true' }).adminEnabled).toBe(true);
    expect(loadConfig({ DUAL_APPROVAL_THRESHOLD: '60000' }).dualApprovalThreshold).toBe(60_000);
  });
});
