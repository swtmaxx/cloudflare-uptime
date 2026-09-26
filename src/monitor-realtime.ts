import type { DurableObjectState } from '@cloudflare/workers-types';
import type { RealtimeEvent } from './types';

type DurableWebSocket = Parameters<DurableObjectState['acceptWebSocket']>[0];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function asEvent(value: unknown): RealtimeEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Partial<RealtimeEvent>;
  if (event.version !== 1 || typeof event.type !== 'string' || typeof event.at !== 'string') return null;
  if (event.type === 'ready' || event.type === 'pong') return event as RealtimeEvent;
  if (event.type !== 'invalidate') return null;
  if (!['dashboard', 'monitor', 'history', 'status-pages', 'settings'].includes(String(event.scope))) return null;
  if (event.monitorId !== undefined && typeof event.monitorId !== 'string') return null;
  return event as RealtimeEvent;
}

function messageText(value: string | ArrayBuffer): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

export class MonitorRealtime {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const payload = await request.json().catch(() => null);
      const event = asEvent(payload);
      if (!event) return json({ error: 'Invalid realtime event' }, 400);
      this.broadcast(event);
      return json({ ok: true });
    }

    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket upgrade required' }, 426);
    }

    const pair = new WebSocketPair();
    const server = pair[1] as unknown as DurableWebSocket;
    this.ctx.acceptWebSocket(server, ['dashboard']);
    server.send(JSON.stringify({ version: 1, type: 'ready', at: new Date().toISOString() } satisfies RealtimeEvent));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(socket: DurableWebSocket, message: string | ArrayBuffer): void {
    try {
      const payload = JSON.parse(messageText(message)) as { type?: unknown };
      if (payload.type === 'ping') {
        socket.send(JSON.stringify({ version: 1, type: 'pong', at: new Date().toISOString() } satisfies RealtimeEvent));
      }
    } catch {
      // Ignore malformed client messages; the connection is still useful for broadcasts.
    }
  }

  webSocketClose(socket: DurableWebSocket): void {
    try { socket.close(); } catch { /* already closed */ }
  }

  webSocketError(socket: DurableWebSocket): void {
    try { socket.close(1011, 'realtime socket error'); } catch { /* already closed */ }
  }

  private broadcast(event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets('dashboard')) {
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      } catch {
        try { socket.close(1011, 'broadcast failed'); } catch { /* already closed */ }
      }
    }
  }
}
