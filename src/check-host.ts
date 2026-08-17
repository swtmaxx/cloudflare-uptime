import type { Monitor, ProbeNode } from './types';
import { ProviderError, type ParsedProbeResult } from './provider';

const CHECK_HOST_BASE = 'https://check-host.net';

export class CheckHostError extends ProviderError {
  constructor(message: string, public readonly code = 'CHECK_HOST_ERROR') {
    super(message);
    this.name = 'CheckHostError';
  }
}

interface StartPayload {
  ok?: number;
  request_id?: string;
  nodes?: Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Cloudflare-Uptime/0.1',
      },
    });
  } catch (error) {
    throw new CheckHostError(error instanceof Error ? error.message : '无法连接 Check-Host', 'NETWORK_ERROR');
  }
  if (!response.ok) {
    throw new CheckHostError(`Check-Host 返回 HTTP ${response.status}`, `HTTP_${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new CheckHostError('Check-Host 返回了无效 JSON', 'INVALID_JSON');
  }
}

export async function fetchNodes(): Promise<ProbeNode[]> {
  const payload = await getJson<{
    nodes?: Record<string, { asn?: string; ip?: string; location?: unknown[] }>;
  }>(`${CHECK_HOST_BASE}/nodes/hosts`);
  return Object.entries(payload.nodes || {}).map(([id, node]) => {
    const location = Array.isArray(node.location) ? node.location : [];
    return {
      id,
      provider: 'check-host',
      countryCode: asString(location[0]) || '??',
      countryName: asString(location[1]) || 'Unknown',
      city: asString(location[2]) || 'Unknown',
      ip: asString(node.ip),
      asn: asString(node.asn),
      enabled: 1,
      lastSeenAt: new Date().toISOString(),
    };
  });
}

function monitorTarget(monitor: Monitor): string {
  if (monitor.type === 'http' && monitor.targetUrl) return monitor.targetUrl;
  if (monitor.type === 'tcp' && monitor.host && monitor.port) {
    const host = monitor.host.includes(':') && !monitor.host.startsWith('[') ? `[${monitor.host}]` : monitor.host;
    return `${host}:${monitor.port}`;
  }
  throw new CheckHostError('监控目标配置不完整', 'INVALID_TARGET');
}

export async function startCheck(monitor: Monitor, nodes: ProbeNode[]): Promise<string> {
  if (nodes.length === 0) throw new CheckHostError('没有选择探测节点', 'NO_NODES');
  const endpoint = monitor.type === 'http' ? 'check-http' : 'check-tcp';
  const params = new URLSearchParams({ host: monitorTarget(monitor) });
  for (const node of nodes) params.append('node', node.id);
  const payload = await getJson<StartPayload>(`${CHECK_HOST_BASE}/${endpoint}?${params.toString()}`);
  if (payload.ok !== 1 || !payload.request_id) {
    throw new CheckHostError('Check-Host 没有创建检查任务', 'START_REJECTED');
  }
  return payload.request_id;
}

function parseHttpResult(nodeId: string, value: unknown): ParsedProbeResult | null {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return null;
  const item = value[0] as unknown[];
  const success = item[0] === 1;
  const latency = asNumber(item[1]);
  const statusText = asString(item[2]);
  const rawStatus = item[3];
  const statusCode = typeof rawStatus === 'number' ? rawStatus : Number.parseInt(String(rawStatus || ''), 10);
  return {
    nodeId,
    success,
    latencyMs: latency === null ? null : Math.round(latency * 1000),
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    message: statusText,
    resolvedIp: asString(item[4]),
  };
}

function parseTcpResult(nodeId: string, value: unknown): ParsedProbeResult | null {
  if (!Array.isArray(value) || typeof value[0] !== 'object' || value[0] === null) return null;
  const item = value[0] as Record<string, unknown>;
  const latency = asNumber(item.time);
  const error = asString(item.error);
  return {
    nodeId,
    success: !error && latency !== null,
    latencyMs: latency === null ? null : Math.round(latency * 1000),
    statusCode: null,
    message: error || (latency !== null ? 'TCP connection established' : 'TCP check failed'),
    resolvedIp: asString(item.address),
  };
}

export async function getResults(
  monitor: Monitor,
  nodes: ProbeNode[],
  requestId: string,
): Promise<{ ready: boolean; results: ParsedProbeResult[] }> {
  const payload = await getJson<Record<string, unknown>>(`${CHECK_HOST_BASE}/check-result/${encodeURIComponent(requestId)}`);
  const results: ParsedProbeResult[] = [];
  let ready = true;
  for (const node of nodes) {
    const value = payload[node.id];
    if (value === undefined || value === null) {
      ready = false;
      continue;
    }
    const parsed = monitor.type === 'http'
      ? parseHttpResult(node.id, value)
      : parseTcpResult(node.id, value);
    if (!parsed) {
      ready = false;
      continue;
    }
    results.push(parsed);
  }
  return { ready, results };
}
