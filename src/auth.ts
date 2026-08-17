import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env } from './types';

const SESSION_COOKIE = 'uptime_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 120_000;

export interface AdminUser {
  id: string;
  username: string;
  createdAt: string;
  lastLoginAt: string | null;
}

type AdminRow = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  last_login_at: string | null;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function toAdminUser(row: AdminRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

async function derivePasswordHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

async function sessionHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function createSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_users').first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function createAdmin(env: Env, username: string, password: string): Promise<AdminUser> {
  const id = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO admin_users (id, username, password_hash, password_salt, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(id, username, bytesToBase64(hash), bytesToBase64(salt), createdAt)
    .run();
  return { id, username, createdAt, lastLoginAt: null };
}

export async function authenticateAdmin(env: Env, username: string, password: string): Promise<AdminUser | null> {
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE username = ?1').bind(username).first<AdminRow>();
  if (!row) return null;
  const hash = await derivePasswordHash(password, base64ToBytes(row.password_salt));
  if (!(await safeEqual(bytesToBase64(hash), row.password_hash))) return null;
  const lastLoginAt = new Date().toISOString();
  await env.DB.prepare('UPDATE admin_users SET last_login_at = ?1 WHERE id = ?2').bind(lastLoginAt, row.id).run();
  return { ...toAdminUser(row), lastLoginAt };
}

export async function verifyAdminPassword(env: Env, userId: string, password: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ?1').bind(userId).first<AdminRow>();
  if (!row) return false;
  const hash = await derivePasswordHash(password, base64ToBytes(row.password_salt));
  return safeEqual(bytesToBase64(hash), row.password_hash);
}

export async function updateAdminPassword(env: Env, userId: string, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  await env.DB.prepare(
    'UPDATE admin_users SET password_hash = ?1, password_salt = ?2 WHERE id = ?3',
  )
    .bind(bytesToBase64(hash), bytesToBase64(salt), userId)
    .run();
  await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_id = ?1').bind(userId).run();
}

export async function updateAdminUsername(env: Env, userId: string, username: string): Promise<void> {
  await env.DB.prepare('UPDATE admin_users SET username = ?1 WHERE id = ?2').bind(username, userId).run();
}

export async function currentAdmin(c: Context<{ Bindings: Env }>): Promise<AdminUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sessionHash(token);
  const row = await c.env.DB
    .prepare(
      `SELECT a.*
       FROM admin_sessions s
       INNER JOIN admin_users a ON a.id = s.admin_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    )
    .bind(hash, new Date().toISOString())
    .first<AdminRow>();
  return row ? toAdminUser(row) : null;
}

export async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<AdminUser | Response> {
  const user = await currentAdmin(c);
  return user || c.json({ error: '需要管理员登录' }, 401);
}

export async function startSession(c: Context<{ Bindings: Env }>, userId: string): Promise<void> {
  const token = createSessionToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO admin_sessions (id, admin_id, token_hash, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(crypto.randomUUID(), userId, await sessionHash(token), createdAt, expiresAt).run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: c.req.url.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(c: Context<{ Bindings: Env }>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(await sessionHash(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function validCredential(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= maxLength;
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}
