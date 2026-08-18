import type { D1Database } from '@cloudflare/workers-types';
import { newId, nowIso } from './db';

const QQ_API_BASE = 'https://api.bot.qq.com';
const QQ_REQUEST_TIMEOUT_MS = 10_000;
const QQ_TOKEN_REFRESH_MARGIN_MS = 60_000;
const QQ_WEBHOOK_MAX_AGE_SECONDS = 10 * 60;

export interface QQChannelRow {
  id: string;
  type: 'qqbot';
  name: string;
  qq_app_id: string | null;
  qq_app_secret: string | null;
  qq_bot_secret: string | null;
  qq_access_token: string | null;
  qq_access_token_expires_at: number | null;
}

export interface QQUserRow {
  id: string;
  channel_id: string;
  openid: string;
  nickname: string | null;
  source: 'manual' | 'webhook';
  enabled: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface QQUser {
  id: string;
  openid: string;
  nickname: string | null;
  source: 'manual' | 'webhook';
  enabled: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export class QQBotError extends Error {
  constructor(message: string, public readonly code = 'QQBOT_ERROR', public readonly status?: number) {
    super(message);
    this.name = 'QQBotError';
  }
}

interface QQAccessTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface QQAddLinkResponse {
  url_link?: unknown;
  url?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function toUser(row: QQUserRow): QQUser {
  return {
    id: row.id,
    openid: row.openid,
    nickname: row.nickname,
    source: row.source === 'webhook' ? 'webhook' : 'manual',
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

function requireQQCredentials(channel: QQChannelRow): { appId: string; appSecret: string; botSecret: string } {
  const appId = asString(channel.qq_app_id);
  const appSecret = asString(channel.qq_app_secret);
  const botSecret = asString(channel.qq_bot_secret);
  if (!appId || !appSecret || !botSecret) throw new QQBotError('QQ 机器人配置不完整，请填写 AppID、AppSecret 和 Bot Secret', 'CONFIGURATION');
  return { appId, appSecret, botSecret };
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQ_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new QQBotError('QQ API 请求超时（10 秒）', 'TIMEOUT');
    throw new QQBotError(error instanceof Error ? `无法连接 QQ API：${error.message}` : '无法连接 QQ API', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) throw new QQBotError(`QQ API HTTP ${response.status}`, `HTTP_${response.status}`, response.status);
    throw new QQBotError('QQ API 返回了无效 JSON', 'INVALID_JSON', response.status);
  }
  if (!response.ok) {
    const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const code = asString(record.code) || asNumber(record.code)?.toString() || `HTTP_${response.status}`;
    const message = asString(record.message) || asString(record.msg) || `HTTP ${response.status}`;
    throw new QQBotError(`QQ API 请求失败（${code}）：${message}`, code, response.status);
  }
  return data as T;
}

export async function getQQAccessToken(db: D1Database, channel: QQChannelRow): Promise<string> {
  const credentials = requireQQCredentials(channel);
  const expiresAt = Number(channel.qq_access_token_expires_at || 0);
  if (channel.qq_access_token && expiresAt > Date.now() + QQ_TOKEN_REFRESH_MARGIN_MS) return channel.qq_access_token;

  const payload = await requestJson<QQAccessTokenResponse>(`${QQ_API_BASE}/app/getAppAccessToken`, {
    method: 'POST',
    body: JSON.stringify({ appId: credentials.appId, clientSecret: credentials.appSecret }),
  });
  const token = asString(payload.access_token);
  const expiresIn = Math.max(60, asNumber(payload.expires_in) || 7200);
  if (!token) throw new QQBotError('QQ API 没有返回 access_token', 'TOKEN_MISSING');
  const nextExpiresAt = Date.now() + expiresIn * 1000;
  channel.qq_access_token = token;
  channel.qq_access_token_expires_at = nextExpiresAt;
  await db.prepare(
    `UPDATE notification_channels
     SET qq_access_token = ?1, qq_access_token_expires_at = ?2, updated_at = ?3
     WHERE id = ?4 AND type = 'qqbot'`,
  ).bind(token, nextExpiresAt, nowIso(), channel.id).run();
  return token;
}

async function requestWithToken<T>(
  db: D1Database,
  channel: QQChannelRow,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getQQAccessToken(db, channel);
  try {
    return await requestJson<T>(`${QQ_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `QQBot ${token}`, ...(init.headers || {}) },
    });
  } catch (error) {
    if (!(error instanceof QQBotError) || error.status !== 401) throw error;
    await db.prepare(
      `UPDATE notification_channels
       SET qq_access_token = NULL, qq_access_token_expires_at = NULL, updated_at = ?1
       WHERE id = ?2 AND type = 'qqbot'`,
    ).bind(nowIso(), channel.id).run();
    channel.qq_access_token = null;
    channel.qq_access_token_expires_at = null;
    const refreshed = await getQQAccessToken(db, channel);
    return requestJson<T>(`${QQ_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `QQBot ${refreshed}`, ...(init.headers || {}) },
    });
  }
}

export async function sendQQDirectMessage(db: D1Database, channel: QQChannelRow, openid: string, content: string): Promise<void> {
  const normalizedOpenid = openid.trim();
  if (!normalizedOpenid) throw new QQBotError('QQ OpenID 不能为空', 'INVALID_OPENID');
  const normalizedContent = content.trim();
  if (!normalizedContent) throw new QQBotError('QQ 通知内容不能为空', 'EMPTY_MESSAGE');
  await requestWithToken(db, channel, `/v2/users/${encodeURIComponent(normalizedOpenid)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ msg_type: 0, content: normalizedContent.slice(0, 2000) }),
  });
}

export async function generateQQAddLink(db: D1Database, channel: QQChannelRow): Promise<string> {
  const callbackData = `uptime-${channel.id.replaceAll(/[^a-zA-Z0-9]/g, '').slice(0, 25)}`.slice(0, 32);
  const payload = await requestWithToken<QQAddLinkResponse>(db, channel, '/v2/generate_url_link', {
    method: 'POST',
    body: JSON.stringify({ callback_data: callbackData }),
  });
  const url = asString(payload.url_link) || asString(payload.url);
  if (!url) throw new QQBotError('QQ API 没有返回机器人添加链接', 'LINK_MISSING');
  return url;
}

function repeatedSeed(secret: string): Uint8Array {
  const source = new TextEncoder().encode(secret);
  if (!source.length) throw new QQBotError('Bot Secret 不能为空', 'CONFIGURATION');
  const seed = new Uint8Array(32);
  for (let index = 0; index < seed.length; index += 1) seed[index] = source[index % source.length];
  return seed;
}

function pkcs8FromSeed(seed: Uint8Array): Uint8Array {
  const prefix = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  const result = new Uint8Array(prefix.length + seed.length);
  result.set(prefix, 0);
  result.set(seed, prefix.length);
  return result;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function importQQPrivateKey(botSecret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8FromSeed(repeatedSeed(botSecret)) as unknown as BufferSource,
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    true,
    ['sign'],
  );
}

async function deriveQQPublicKey(botSecret: string): Promise<CryptoKey> {
  const privateKey = await importQQPrivateKey(botSecret);
  const jwk = await crypto.subtle.exportKey('jwk', privateKey) as JsonWebKey;
  if (!jwk.x) throw new QQBotError('无法从 Bot Secret 生成 QQ 公钥', 'CRYPTO_UNSUPPORTED');
  return crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(jwk.x) as unknown as BufferSource,
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    false,
    ['verify'],
  );
}

export async function signQQValidation(botSecret: string, eventTimestamp: string, plainToken: string): Promise<string> {
  const privateKey = await importQQPrivateKey(botSecret);
  const message = new TextEncoder().encode(`${eventTimestamp}${plainToken}`);
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    privateKey,
    message as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyQQWebhookSignature(
  botSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const timestampNumber = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > QQ_WEBHOOK_MAX_AGE_SECONDS) return false;
  const signatureBytes = hexToBytes(signature.trim());
  if (!signatureBytes || signatureBytes.length !== 64) return false;
  try {
    const publicKey = await deriveQQPublicKey(botSecret);
    return crypto.subtle.verify(
      { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
      publicKey,
      signatureBytes as unknown as BufferSource,
      new TextEncoder().encode(`${timestamp}${body}`) as unknown as BufferSource,
    );
  } catch (error) {
    console.warn(`[qqbot] webhook signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function listQQUsers(db: D1Database, channelId: string, includeDisabled = true): Promise<QQUser[]> {
  const query = includeDisabled
    ? 'SELECT * FROM qq_notification_users WHERE channel_id = ?1 ORDER BY enabled DESC, updated_at DESC, id'
    : 'SELECT * FROM qq_notification_users WHERE channel_id = ?1 AND enabled = 1 ORDER BY updated_at DESC, id';
  const { results } = await db.prepare(query).bind(channelId).all<QQUserRow>();
  return results.map(toUser);
}

export async function upsertQQUser(
  db: D1Database,
  channelId: string,
  openid: string,
  source: 'manual' | 'webhook',
  nickname?: string | null,
): Promise<QQUser> {
  const normalizedOpenid = openid.trim();
  if (!normalizedOpenid) throw new QQBotError('QQ OpenID 不能为空', 'INVALID_OPENID');
  const normalizedNickname = nickname?.trim() || null;
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO qq_notification_users
     (id, channel_id, openid, nickname, source, enabled, created_at, updated_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7)
     ON CONFLICT(channel_id, openid) DO UPDATE SET
       nickname = COALESCE(excluded.nickname, qq_notification_users.nickname),
       source = excluded.source,
       enabled = 1,
       updated_at = excluded.updated_at,
       last_seen_at = COALESCE(excluded.last_seen_at, qq_notification_users.last_seen_at)`,
  ).bind(newId(), channelId, normalizedOpenid, normalizedNickname, source, timestamp, source === 'webhook' ? timestamp : null).run();
  const row = await db.prepare('SELECT * FROM qq_notification_users WHERE channel_id = ?1 AND openid = ?2').bind(channelId, normalizedOpenid).first<QQUserRow>();
  if (!row) throw new QQBotError('QQ 用户保存失败', 'DATABASE');
  return toUser(row);
}

export async function setQQUserEnabled(db: D1Database, channelId: string, userId: string, enabled: boolean): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE qq_notification_users SET enabled = ?1, updated_at = ?2
     WHERE id = ?3 AND channel_id = ?4`,
  ).bind(enabled ? 1 : 0, nowIso(), userId, channelId).run();
  return (result.meta.changes || 0) > 0;
}

export async function deleteQQUser(db: D1Database, channelId: string, userId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM qq_notification_users WHERE id = ?1 AND channel_id = ?2').bind(userId, channelId).run();
  return (result.meta.changes || 0) > 0;
}

export function qqChannelConfigured(channel: QQChannelRow): boolean {
  return Boolean(asString(channel.qq_app_id) && asString(channel.qq_app_secret) && asString(channel.qq_bot_secret));
}
