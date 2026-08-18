import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { ClaimsRepository } from './repository.js';
import { FaultController } from './faults.js';

const silentLogger = createLogger('silent');

function buildApp() {
  return createApp({
    config: loadConfig({ NODE_ENV: 'test' }),
    logger: silentLogger,
    repository: new ClaimsRepository(),
    faultController: new FaultController(),
  });
}

describe('app basics', () => {
  it('reports health', async () => {
    const response = await request(buildApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'contoso-claims-api' });
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('echoes an inbound correlation id', async () => {
    const response = await request(buildApp())
      .get('/health')
      .set('x-request-id', 'demo-correlation-id');

    expect(response.headers['x-request-id']).toBe('demo-correlation-id');
  });

  it('generates a correlation id when none is supplied', async () => {
    const response = await request(buildApp()).get('/health');
    expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('returns RFC 7807 problem details for unknown routes', async () => {
    const response = await request(buildApp()).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ title: 'Not Found', status: 404 });
    expect(response.body.instance).toBe('/api/does-not-exist');
    expect(response.body.traceId).toBeTruthy();
  });

  it('returns problem details for malformed JSON', async () => {
    const response = await request(buildApp())
      .post('/api/claims')
      .set('content-type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    expect(response.body.status).toBe(400);
  });

  it('exposes CORS headers for the web origin', async () => {
    const response = await request(buildApp())
      .get('/health')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
