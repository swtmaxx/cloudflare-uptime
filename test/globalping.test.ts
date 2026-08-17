import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGlobalpingResults, startGlobalpingCheck } from '../src/globalping.ts';
import type { Env, Monitor } from '../src/types.ts';

const globalpingMonitor: Monitor = {
  id: 'monitor-globalping',
  name: 'Globalping test',
  type: 'http',
  provider: 'globalping',
  httpMethod: 'GET',
  targetUrl: 'https://example.com/health?check=1',
  host: null,
  port: null,
  intervalSeconds: 60,
  enabled: 1,
  currentStatus: 'unknown',
  lastStartedAt: null,
  lastCheckedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nodes: [],
  globalpingLocations: [
    { country: 'US', city: 'New York' },
    { country: 'SG', city: 'Singapore' },
  ],
};

const env = {} as Env;

test('starts a Globalping HTTP measurement with location rules', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'measurement-123', probesCount: { requested: 2, finished: 0 } }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const measurementId = await startGlobalpingCheck(env, globalpingMonitor);
    assert.equal(measurementId, 'measurement-123');
    assert.equal(requestedUrl, 'https://api.globalping.io/v1/measurements');
    const body = requestBody as unknown as Record<string, unknown>;
    assert.equal(body.type, 'http');
    assert.equal(body.target, 'example.com');
    assert.deepEqual(body.locations, [
      { country: 'US', city: 'New York', limit: 1 },
      { country: 'SG', city: 'Singapore', limit: 1 },
    ]);
    assert.deepEqual((body.measurementOptions as Record<string, unknown>).request, {
      method: 'GET',
      path: '/health',
      query: 'check=1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parses Globalping HTTP results and probe locations', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'finished',
    results: [
      {
        probe: { country: 'US', city: 'New York', asn: 64500 },
        result: { status: 'finished', statusCode: 200, statusCodeName: 'OK', resolvedAddress: '192.0.2.1', timings: { total: 42 } },
      },
      {
        probe: { country: 'SG', city: 'Singapore', asn: 64501 },
        result: { status: 'finished', statusCode: 503, statusCodeName: 'SERVICE_UNAVAILABLE', resolvedAddress: '192.0.2.2', timings: { total: 81 } },
      },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await getGlobalpingResults(env, 'measurement-123');
    assert.equal(result.ready, true);
    assert.equal(result.results.length, 2);
    assert.deepEqual(result.results.map((item) => item.success), [true, false]);
    assert.equal(result.results[0].latencyMs, 42);
    assert.equal(result.results[1].statusCode, 503);
    assert.equal(result.results[0].probe?.provider, 'globalping');
    assert.equal(result.results[0].probe?.city, 'New York');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('waits while a Globalping measurement is in progress', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'in-progress', results: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    const result = await getGlobalpingResults(env, 'measurement-123');
    assert.equal(result.ready, false);
    assert.deepEqual(result.results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
