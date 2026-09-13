import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendPushPlusToken } from '../src/notifications.ts';
import type { Env } from '../src/types.ts';

test('sends the expected PushPlus HTML payload', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ code: 200, msg: '请求成功' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await sendPushPlusToken('token-123', '宕机 · test', '<strong>offline</strong>');
    assert.equal(requestedUrl, 'https://www.pushplus.plus/send');
    assert.deepEqual(requestBody, {
      token: 'token-123',
      title: '宕机 · test',
      content: '<strong>offline</strong>',
      template: 'html',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports PushPlus API errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 400, msg: 'Token 无效' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await assert.rejects(() => sendPushPlusToken('invalid', 'test', 'content'), /Token 无效/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
