import type { RealtimeEvent, RealtimeScope } from './types';

export type RealtimeInvalidateEvent = Extract<RealtimeEvent, { type: 'invalidate' }>;
export type RealtimeConnectionState = 'connecting' | 'connected' | 'disconnected';
type RealtimeListener = (event: RealtimeInvalidateEvent) => void;

const listeners = new Set<RealtimeListener>();

export function onRealtimeEvent(listener: RealtimeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitRealtimeEvent(event: RealtimeInvalidateEvent): void {
  for (const listener of listeners) listener(event);
}

export function realtimeScopeMatches(event: RealtimeInvalidateEvent, scopes: RealtimeScope[]): boolean {
  return event.scope === 'dashboard' || scopes.includes(event.scope);
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private reconnectAttempt = 0;
  private stopped = true;

  constructor(private readonly onState: (state: RealtimeConnectionState) => void) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.reconnectTimer = undefined;
    this.pingTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close(1000, 'client closed');
    this.onState('disconnected');
  }

  private open(): void {
    if (this.stopped || this.socket) return;
    this.onState('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.onState('connected');
      emitRealtimeEvent({ version: 1, type: 'invalidate', scope: 'dashboard', at: new Date().toISOString() });
      this.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    });
    socket.addEventListener('message', (message) => {
      if (this.socket !== socket) return;
      try {
        const event = JSON.parse(String(message.data)) as RealtimeEvent;
        if (event.version === 1 && event.type === 'invalidate') emitRealtimeEvent(event);
      } catch {
        // Ignore malformed server messages and keep the connection alive.
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) window.clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      this.onState('disconnected');
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.onState('disconnected');
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(this.reconnectAttempt, 5)));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }
}
