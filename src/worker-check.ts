import { connect } from 'cloudflare:sockets';
import type { Monitor, ProbeNode } from './types';
import type { ParsedProbeResult } from './provider';

export const WORKER_NODE: ProbeNode = {
  id: 'worker-local',
  provider: 'worker',
  countryCode: '--',
  countryName: 'Worker',
  city: '本地',
  ip: null,
  asn: null,
  enabled: 1,
  lastSeenAt: '1970-01-01T00:00:00.000Z',
};

function failure(monitor: Monitor, message: string, latencyMs: number | null = null, statusCode: number | null = null, resolvedIp: string | null = null): ParsedProbeResult {
  return {
    nodeId: WORKER_NODE.id,
    probe: WORKER_NODE,
    success: false,
    latencyMs,
    statusCode,
    message,
    resolvedIp,
  };
}

function acceptedStatus(monitor: Monitor, statusCode: number): boolean {
  const expected = monitor.expectedStatusCodes.length
    ? monitor.expectedStatusCodes
    : Array.from({ length: 200 }, (_, index) => index + 200);
  return expected.includes(statusCode);
}

function timeoutError(): Error {
  return new Error('请求超时');
}

async function checkHttp(monitor: Monitor): Promise<ParsedProbeResult> {
  if (!monitor.targetUrl) return failure(monitor, 'HTTP URL 未配置');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), monitor.timeoutSeconds * 1000);
  const startedAt = Date.now();
  try {
    const headers = new Headers(monitor.requestHeaders);
    const init: RequestInit = {
      method: monitor.httpMethod,
      headers,
      redirect: 'follow',
      signal: controller.signal,
    };
    if (!['GET', 'HEAD'].includes(monitor.httpMethod) && monitor.requestBody) init.body = monitor.requestBody;
    const response = await fetch(monitor.targetUrl, init);
    const latencyMs = Date.now() - startedAt;
    let body = '';
    if (monitor.responseKeyword) body = await response.text();
    const statusOk = acceptedStatus(monitor, response.status);
    const keywordOk = !monitor.responseKeyword || body.includes(monitor.responseKeyword);
    const message = !statusOk
      ? `HTTP 状态码 ${response.status} 不符合要求`
      : !keywordOk
        ? '响应内容未找到关键字'
        : `HTTP ${response.status}`;
    return {
      nodeId: WORKER_NODE.id,
      probe: { ...WORKER_NODE, lastSeenAt: new Date().toISOString() },
      success: statusOk && keywordOk,
      latencyMs,
      statusCode: response.status,
      message,
      resolvedIp: null,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? timeoutError().message
      : error instanceof Error ? error.message : 'HTTP 请求失败';
    return failure(monitor, message, Date.now() - startedAt);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkTcp(monitor: Monitor): Promise<ParsedProbeResult> {
  if (!monitor.host || !monitor.port) return failure(monitor, 'TCP 主机或端口未配置');
  const hostname = monitor.host.replace(/^\[|\]$/g, '');
  const startedAt = Date.now();
  let socket: ReturnType<typeof connect> | null = null;
  try {
    socket = connect({ hostname, port: monitor.port }, { allowHalfOpen: false });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(timeoutError()), monitor.timeoutSeconds * 1000));
    const info = await Promise.race([socket.opened, timeout]);
    const latencyMs = Date.now() - startedAt;
    return {
      nodeId: WORKER_NODE.id,
      probe: {
        ...WORKER_NODE,
        ip: info.remoteAddress || null,
        lastSeenAt: new Date().toISOString(),
      },
      success: true,
      latencyMs,
      statusCode: null,
      message: 'TCP 连接成功',
      resolvedIp: info.remoteAddress || null,
    };
  } catch (error) {
    return failure(monitor, error instanceof Error ? error.message : 'TCP 连接失败', Date.now() - startedAt);
  } finally {
    if (socket) await socket.close().catch(() => undefined);
  }
}

export async function checkWorkerMonitor(monitor: Monitor): Promise<ParsedProbeResult> {
  return monitor.type === 'http' ? checkHttp(monitor) : checkTcp(monitor);
}
