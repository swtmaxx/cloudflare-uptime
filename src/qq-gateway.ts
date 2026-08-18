import type { D1Database, DurableObjectState } from '@cloudflare/workers-types';
import {
  getQQAccessToken,
  setQQUserEnabled,
  upsertQQUser,
  type QQChannelRow,
} from './qqbot';

const QQ_GATEWAY_API = 'https://api.sgroup.qq.com/gateway';
const QQ_RECONNECT_DELAY_MS = 10_000;
const QQ_HELLO_TIMEOUT_MS = 20_000;
const QQ_INTENT_GROUP_AND_C2C = 1 << 25;

type GatewayState = 'stopped' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface GatewayStatus {
  status: GatewayState;
  channelId: string | null;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

interface GatewayPayload {
  op?: unknown;
  d?: unknown;
  s?: unknown;
  t?: unknown;
}

interface GatewayHello {
  heartbeat_interval?: unknown;
}

interface QQGatewayEnv {
  DB: D1Database;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class QQGateway {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private runningPromise: Promise<void> | null = null;
  private sequence: number | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: QQGatewayEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/status') return jsonResponse(await this.status());
    if (request.method !== 'POST') return jsonResponse({ error: 'Not found' }, 404);

    if (path === '/start') {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const channelId = text(body.channelId);
      if (!channelId) return jsonResponse({ error: 'channelId is required' }, 400);
      await this.ctx.storage.put({ enabled: true, channelId });
      await this.updateStatus({ status: 'connecting', channelId, lastError: null });
      this.ensureConnection();
      return jsonResponse(await this.status(), 202);
    }

    if (path === '/stop') {
      await this.ctx.storage.put('enabled', false);
      await this.ctx.storage.deleteAlarm();
      this.clearHeartbeat();
      this.socket?.close(1000, 'stopped by administrator');
      this.socket = null;
      await this.updateStatus({ status: 'stopped', lastError: null });
      return jsonResponse(await this.status());
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }

  async alarm(): Promise<void> {
    if (await this.ctx.storage.get<boolean>('enabled')) {
      await this.updateStatus({ status: 'reconnecting' });
      this.ensureConnection();
    }
  }

  private async status(): Promise<GatewayStatus> {
    const stored = await this.ctx.storage.get<Partial<GatewayStatus>>('status');
    return {
      status: stored?.status || 'stopped',
      channelId: stored?.channelId || (await this.ctx.storage.get<string>('channelId')) || null,
      lastConnectedAt: stored?.lastConnectedAt || null,
      lastEventAt: stored?.lastEventAt || null,
      lastError: stored?.lastError || null,
    };
  }

  private async updateStatus(update: Partial<GatewayStatus>): Promise<void> {
    const current = await this.status();
    await this.ctx.storage.put('status', { ...current, ...update });
  }

  private ensureConnection(): void {
    if (this.runningPromise) return;
    const task = this.runConnection()
      .catch(async (error) => {
        await this.updateStatus({ status: 'error', lastError: errorMessage(error) });
      })
      .finally(async () => {
        this.runningPromise = null;
        if (await this.ctx.storage.get<boolean>('enabled')) {
          await this.ctx.storage.setAlarm(Date.now() + QQ_RECONNECT_DELAY_MS);
        }
      });
    this.runningPromise = task;
    this.ctx.waitUntil(task);
  }

  private async runConnection(): Promise<void> {
    const channelId = await this.ctx.storage.get<string>('channelId');
    if (!channelId || !(await this.ctx.storage.get<boolean>('enabled'))) return;
    const channel = await this.env.DB
      .prepare("SELECT * FROM notification_channels WHERE id = ?1 AND type = 'qqbot'")
      .bind(channelId)
      .first<QQChannelRow>();
    if (!channel) throw new Error('QQ 通知配置不存在');

    const accessToken = await getQQAccessToken(this.env.DB, channel);
    const gateway = await this.getGateway(accessToken);
    if (!(await this.ctx.storage.get<boolean>('enabled'))) return;
    const socket = new WebSocket(gateway);
    this.socket = socket;
    this.sequence = null;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const helloTimer = setTimeout(() => {
        socket.close(4000, 'QQ Gateway hello timeout');
        finish();
      }, QQ_HELLO_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        void this.updateStatus({ status: 'connecting', lastError: null });
      });
      socket.addEventListener('message', (event) => {
        void this.handleMessage(event.data, socket, accessToken, helloTimer).catch((error) => {
          void this.updateStatus({ status: 'error', lastError: errorMessage(error) });
          socket.close(4002, 'QQ Gateway event handling failed');
        });
      });
      socket.addEventListener('error', () => {
        clearTimeout(helloTimer);
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(4002, 'QQ Gateway socket error');
        }
        finish();
      });
      socket.addEventListener('close', () => {
        clearTimeout(helloTimer);
        this.clearHeartbeat();
        finish();
      });
    });

    this.clearHeartbeat();
    if (this.socket === socket) this.socket = null;
    if (await this.ctx.storage.get<boolean>('enabled')) {
      await this.updateStatus({ status: 'reconnecting' });
    } else {
      await this.updateStatus({ status: 'stopped' });
    }
  }

  private async getGateway(accessToken: string): Promise<string> {
    const response = await fetch(QQ_GATEWAY_API, {
      headers: { Authorization: `QQBot ${accessToken}`, Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`QQ Gateway 地址获取失败（HTTP ${response.status}）`);
    const url = text(payload.url);
    if (!url.startsWith('wss://')) throw new Error('QQ Gateway 没有返回有效 WebSocket 地址');
    return url;
  }

  private async handleMessage(
    data: string | ArrayBuffer,
    socket: WebSocket,
    accessToken: string,
    helloTimer: ReturnType<typeof setTimeout>,
  ): Promise<void> {
    const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(raw) as GatewayPayload;
    } catch {
      return;
    }
    const operation = Number(payload.op);
    const sequence = Number(payload.s);
    if (Number.isInteger(sequence)) this.sequence = sequence;

    if (operation === 10) {
      clearTimeout(helloTimer);
      const hello = record(payload.d) as GatewayHello;
      const heartbeatInterval = Number(hello.heartbeat_interval);
      if (!Number.isFinite(heartbeatInterval) || heartbeatInterval < 1_000) {
        socket.close(4000, 'invalid heartbeat interval');
        return;
      }
      socket.send(JSON.stringify({
        op: 2,
        d: {
          token: `QQBot ${accessToken}`,
          intents: QQ_INTENT_GROUP_AND_C2C,
          shard: [0, 1],
          properties: { $os: 'cloudflare-worker', $browser: 'uptime-monitor', $device: 'uptime-monitor' },
        },
      }));
      this.clearHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: this.sequence }));
      }, heartbeatInterval);
      await this.updateStatus({ status: 'connecting', lastError: null });
      return;
    }

    if (operation === 7 || operation === 9) {
      socket.close(4001, operation === 7 ? 'QQ requested reconnect' : 'QQ invalid session');
      return;
    }
    if (operation === 0) {
      if (payload.t === 'READY') {
        await this.updateStatus({ status: 'connected', lastConnectedAt: new Date().toISOString(), lastError: null });
      }
      await this.handleEvent(payload);
    }
  }

  private async handleEvent(payload: GatewayPayload): Promise<void> {
    const event = text(payload.t);
    const data = record(payload.d);
    const author = record(data.author);
    const openidValue = event === 'FRIEND_ADD' || event === 'FRIEND_DEL'
      ? data.openid
      : author.user_openid || data.user_openid || data.openid;
    const openid = text(openidValue);
    if (!openid) return;

    if (['FRIEND_ADD', 'C2C_MESSAGE_CREATE', 'C2C_MSG_RECEIVE'].includes(event)) {
      const channelId = await this.ctx.storage.get<string>('channelId');
      if (!channelId) return;
      const nickname = text(author.username) || undefined;
      await upsertQQUser(this.env.DB, channelId, openid, 'websocket', nickname);
    } else if (['FRIEND_DEL', 'C2C_MSG_REJECT'].includes(event)) {
      const channelId = await this.ctx.storage.get<string>('channelId');
      if (!channelId) return;
      const user = await this.env.DB
        .prepare('SELECT id FROM qq_notification_users WHERE channel_id = ?1 AND openid = ?2')
        .bind(channelId, openid)
        .first<{ id: string }>();
      if (user) await setQQUserEnabled(this.env.DB, channelId, user.id, false);
    }
    await this.updateStatus({ lastEventAt: new Date().toISOString() });
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
