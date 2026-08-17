import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getResults, startCheck } from '../src/check-host.ts';
import type { Monitor, ProbeNode } from '../src/types.ts';

const nodes: ProbeNode[] = [
  {
    id: 'us1.node.check-host.net',
    provider: 'check-host',
    countryCode: 'us',
    countryName: 'United States',
    city: 'Los Angeles',
    ip: null,
    asn: null,
    enabled: 1,
    lastSeenAt: new Date().toISOString(),
  },
  {
    id: 'sg1.node.check-host.net',
    provider: 'check-host',
    countryCode: 'sg',
    countryName: 'Singapore',
    city: 'Singapore',
    ip: null,
    asn: null,
    enabled: 1,
    lastSeenAt: new Date().toISOString(),
  },
];

const httpMonitor: Monitor = {
  id: 'monitor-http',
  name: 'HTTP test',
  type: 'http',
  provider: 'check-host',
  httpMethod: 'GET',
  targetUrl: 'https://example.com/health',
  host: null,
  port: null,
  intervalSeconds: 60,
  enabled: 1,
  currentStatus: 'unknown',
  lastStartedAt: null,
  lastCheckedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nodes,
  globalpingLocations: [],
};

const tcpMonitor: Monitor = {
  ...httpMonitor,
  id: 'monitor-tcp',
  name: 'TCP test',
  type: 'tcp',
  targetUrl: null,
  host: 'example.com',
  port: 443,
};

test('parses HTTP results from all selected nodes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    [nodes[0].id]: [[1, 0.123, 'OK', '200', '192.0.2.1']],
    [nodes[1].id]: [[0, 0.321, 'Not Found', '404', '192.0.2.1']],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await getResults(httpMonitor, nodes, 'http-request');
    assert.equal(result.ready, true);
    assert.equal(result.results.length, 2);
    assert.deepEqual(result.results.map((item) => item.success), [true, false]);
    assert.equal(result.results[0].latencyMs, 123);
    assert.equal(result.results[1].statusCode, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parses TCP success and connection errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    [nodes[0].id]: [{ time: 0.04, address: '192.0.2.2' }],
    [nodes[1].id]: [{ error: 'Connection timed out' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await getResults(tcpMonitor, nodes, 'tcp-request');
    assert.equal(result.ready, true);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[0].latencyMs, 40);
    assert.equal(result.results[1].success, false);
    assert.equal(result.results[1].message, 'Connection timed out');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('starts a Check-Host request with the selected nodes', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ok: 1, request_id: 'request-123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const requestId = await startCheck(httpMonitor, nodes);
    assert.equal(requestId, 'request-123');
    assert.match(requestedUrl, /check-http/);
    assert.match(requestedUrl, /node=us1.node.check-host.net/);
    assert.match(requestedUrl, /node=sg1.node.check-host.net/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
