import { ProviderError, type ParsedProbeResult } from './provider';
import { getAppSetting } from './db';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env, GlobalpingLocation, Monitor, ProbeNode } from './types';

const GLOBALPING_BASE = 'https://api.globalping.io';
const USER_AGENT = 'Cloudflare-Uptime/0.1 (Globalping provider)';
const GLOBALPING_REQUEST_TIMEOUT_MS = 30_000;
const GLOBALPING_LOCATIONS_CACHE_KEY = 'globalping_locations_cache';
const GLOBALPING_LOCATIONS_CACHE_TTL_MS = 10 * 60 * 1000;

// Globalping accepts country/city location rules directly. Do not download the
// multi-megabyte /v1/probes inventory just to populate this picker.
const COMMON_GLOBALPING_LOCATIONS: GlobalpingLocationOption[] = [
  ['CN', 'Beijing'], ['CN', 'Shanghai'], ['CN', 'Guangzhou'], ['CN', 'Hong Kong'],
  ['JP', 'Tokyo'], ['KR', 'Seoul'], ['SG', 'Singapore'], ['TW', 'Taipei'],
  ['US', 'Los Angeles'], ['US', 'New York'], ['US', 'Dallas'], ['US', 'Seattle'],
  ['CA', 'Toronto'], ['BR', 'Sao Paulo'], ['MX', 'Mexico City'],
  ['GB', 'London'], ['DE', 'Frankfurt'], ['FR', 'Paris'], ['NL', 'Amsterdam'],
  ['ES', 'Madrid'], ['IT', 'Milan'], ['CH', 'Zurich'], ['SE', 'Stockholm'],
  ['FI', 'Helsinki'], ['PL', 'Warsaw'], ['AT', 'Vienna'], ['TR', 'Istanbul'],
  ['IN', 'Mumbai'], ['AU', 'Sydney'], ['NZ', 'Auckland'], ['ZA', 'Johannesburg'],
].map(([country, city]) => ({ country, city, probes: 0 }));

export class GlobalpingError extends ProviderError {
  constructor(message: string, code = 'GLOBALPING_ERROR') {
    super(message, code);
    this.name = 'GlobalpingError';
  }
}

export interface GlobalpingLocationOption {
  country: string;
  city: string;
  probes: number;
}

interface GlobalpingProbe {
  location?: {
    country?: unknown;
    city?: unknown;
    asn?: unknown;
  };
  country?: unknown;
  city?: unknown;
  asn?: unknown;
}

interface GlobalpingStartResponse {
  id?: unknown;
}

interface GlobalpingHttpResult {
  status?: unknown;
  statusCode?: unknown;
  statusCodeName?: unknown;
  rawOutput?: unknown;
  resolvedAddress?: unknown;
  timings?: { total?: unknown };
}

interface GlobalpingMeasurementResponse {
  status?: unknown;
  results?: Array<{
    probe?: GlobalpingProbe;
    result?: GlobalpingHttpResult;
  }>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requestHeaders(token: string | null, json = false): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  });
  if (json) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function requestJson<T>(token: string | null, url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GLOBALPING_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: requestHeaders(token, Boolean(init.body)),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GlobalpingError('Globalping 请求超时，请稍后重试', 'TIMEOUT');
    }
    throw new GlobalpingError(error instanceof Error ? error.message : '无法连接 Globalping', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const suffix = response.status === 429 ? '，Globalping 配额或限流已触发' : '';
    throw new GlobalpingError(`Globalping 返回 HTTP ${response.status}${suffix}`, response.status === 429 ? 'RATE_LIMITED' : `HTTP_${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new GlobalpingError('Globalping 返回了无效 JSON', 'INVALID_JSON');
  }
}

function locationKey(country: string, city: string): string {
  return `${country.toLowerCase()}\u0000${city.toLowerCase()}`;
}

export async function fetchGlobalpingLocations(db: D1Database): Promise<GlobalpingLocationOption[]> {
  const cached = await getAppSetting(db, GLOBALPING_LOCATIONS_CACHE_KEY);
  if (cached) {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        const cache = parsed as { updatedAt?: unknown; locations?: unknown };
        const updatedAt = typeof cache.updatedAt === 'string' ? Date.parse(cache.updatedAt) : NaN;
        if (
          Number.isFinite(updatedAt)
          && Date.now() - updatedAt < GLOBALPING_LOCATIONS_CACHE_TTL_MS
          && Array.isArray(cache.locations)
        ) {
          return cache.locations as GlobalpingLocationOption[];
        }
      }
    } catch {
      // Ignore a stale or malformed cache and refresh it from Globalping.
    }
  }

  const result = COMMON_GLOBALPING_LOCATIONS;
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(
    GLOBALPING_LOCATIONS_CACHE_KEY,
    JSON.stringify({ updatedAt: new Date().toISOString(), locations: result }),
    new Date().toISOString(),
  ).run();
  return result;
}

function measurementLocation(location: GlobalpingLocation): Record<string, unknown> {
  return {
    country: location.country.toUpperCase(),
    ...(location.city ? { city: location.city } : {}),
    limit: 1,
  };
}

function measurementTarget(monitor: Monitor): { target: string; options: Record<string, unknown> } {
  if (!monitor.targetUrl) throw new GlobalpingError('Globalping HTTP 监控缺少 URL', 'INVALID_TARGET');
  let url: URL;
  try {
    url = new URL(monitor.targetUrl);
  } catch {
    throw new GlobalpingError('Globalping URL 格式不正确', 'INVALID_TARGET');
  }

  const request: Record<string, unknown> = {
    method: monitor.httpMethod,
    path: url.pathname || '/',
  };
  if (url.search) request.query = url.search.slice(1);

  return {
    target: url.hostname,
    options: {
      request,
      protocol: url.protocol === 'https:' ? 'HTTPS' : 'HTTP',
      ...(url.port ? { port: Number(url.port) } : {}),
    },
  };
}

export async function startGlobalpingCheck(env: Env, monitor: Monitor): Promise<string> {
  if (monitor.type !== 'http') throw new GlobalpingError('Globalping 只支持 HTTP/HTTPS 监控', 'UNSUPPORTED_TYPE');
  if (!monitor.globalpingLocations.length) throw new GlobalpingError('没有选择 Globalping 探测位置', 'NO_LOCATIONS');

  const { target, options } = measurementTarget(monitor);
  const payload = await requestJson<GlobalpingStartResponse>(await getAppSetting(env.DB, 'globalping_token'), `${GLOBALPING_BASE}/v1/measurements`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'http',
      target,
      locations: monitor.globalpingLocations.map(measurementLocation),
      measurementOptions: options,
    }),
  });
  const id = asString(payload.id);
  if (!id) throw new GlobalpingError('Globalping 没有返回测量 ID', 'START_REJECTED');
  return id;
}

function syntheticNode(probe: GlobalpingProbe | undefined, resolvedIp: string | null): ProbeNode {
  const country = (asString(probe?.country) || asString(probe?.location?.country))?.toLowerCase() || '??';
  const city = asString(probe?.city) || asString(probe?.location?.city) || 'Unknown';
  const asn = asNumber(probe?.asn) ?? asNumber(probe?.location?.asn);
  const nodeId = `globalping:${country}:${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${asn || 'na'}`;
  return {
    id: nodeId,
    provider: 'globalping',
    countryCode: country,
    countryName: country.toUpperCase(),
    city,
    ip: resolvedIp,
    asn: asn === null ? null : String(asn),
    enabled: 1,
    lastSeenAt: new Date().toISOString(),
  };
}

export async function getGlobalpingResults(
  env: Env,
  requestId: string,
): Promise<{ ready: boolean; results: ParsedProbeResult[] }> {
  const payload = await requestJson<GlobalpingMeasurementResponse>(await getAppSetting(env.DB, 'globalping_token'), `${GLOBALPING_BASE}/v1/measurements/${encodeURIComponent(requestId)}`);
  if (payload.status === 'in-progress') return { ready: false, results: [] };
  if (payload.status !== 'finished') {
    throw new GlobalpingError(`Globalping 测量状态异常：${asString(payload.status) || 'unknown'}`, 'MEASUREMENT_FAILED');
  }

  const results: ParsedProbeResult[] = [];
  for (const item of Array.isArray(payload.results) ? payload.results : []) {
    const raw = item.result || {};
    const resolvedIp = asString(raw.resolvedAddress);
    const probe = syntheticNode(item.probe, resolvedIp);
    const statusCode = asNumber(raw.statusCode);
    const finished = raw.status === 'finished';
    const success = finished && statusCode !== null && statusCode >= 200 && statusCode < 400;
    const message = asString(raw.statusCodeName) || asString(raw.rawOutput) || asString(raw.status) || (success ? 'HTTP check passed' : 'HTTP check failed');
    results.push({
      nodeId: probe.id,
      probe,
      success,
      latencyMs: asNumber(raw.timings?.total) === null ? null : Math.round(asNumber(raw.timings?.total) as number),
      statusCode,
      message,
      resolvedIp,
    });
  }
  return { ready: true, results };
}
