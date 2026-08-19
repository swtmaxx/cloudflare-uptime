import type { D1Database } from '@cloudflare/workers-types';
import { nowIso } from './db';
import {
  listQQUsers,
  qqChannelConfigured,
  sendQQDirectMessage,
  type QQChannelRow,
} from './qqbot';
import type {
  Env,
  Monitor,
  MonitorNotificationBinding,
  MonitorNotificationRule,
  MonitorStatus,
  NotificationChannel,
  NotificationChannelType,
  NotificationEventType,
} from './types';

export type NotificationChannelRow = {
  id: string;
  type: NotificationChannelType;
  name: string;
  token_plaintext: string;
  default_enabled: number;
  qq_app_id: string | null;
  qq_app_secret: string | null;
  qq_bot_secret: string | null;
  qq_access_token: string | null;
  qq_access_token_expires_at: number | null;
  created_at: string;
  updated_at: string;
  qq_user_count?: number;
};

type NotificationBindingRow = {
  monitor_id: string;
  channel_id: string;
  enabled: number;
  last_event_key: string | null;
  last_attempt_at: string | null;
  retry_count: number;
  last_error: string | null;
  channel_type: NotificationChannelType;
  channel_name: string;
  channel_default_enabled: number;
  token_plaintext: string;
  qq_app_id: string | null;
  qq_app_secret: string | null;
  qq_bot_secret: string | null;
  qq_access_token: string | null;
  qq_access_token_expires_at: number | null;
};

type NotificationRuleRow = {
  monitor_id: string;
  enabled: number;
  notify_on_degraded: number;
  notify_on_down: number;
  notify_on_recovery: number;
  failure_threshold: number;
  consecutive_abnormal: number;
  incident_status: 'degraded' | 'down' | null;
  incident_id: string | null;
  pending_event_key: string | null;
  pending_event_type: NotificationEventType | null;
  pending_checked_at: string | null;
  updated_at: string;
};

type QQDeliveryRow = {
  monitor_id: string;
  channel_id: string;
  user_id: string;
  openid: string;
  nickname: string | null;
  last_event_key: string | null;
  last_attempt_at: string | null;
  retry_count: number;
  last_error: string | null;
};

export interface TestNotificationInput {
  channelId?: string;
  type?: NotificationChannelType;
  token?: string;
  name?: string;
  qqAppId?: string;
  qqAppSecret?: string;
  qqBotSecret?: string;
  qqOpenId?: string;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const MAX_NOTIFICATION_RETRIES = 3;
const NOTIFICATION_RETRY_INTERVAL_MS = 60_000;

function toChannel(row: NotificationChannelRow): NotificationChannel {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    defaultEnabled: row.default_enabled,
    tokenConfigured: row.type === 'pushplus' && Boolean(row.token_plaintext),
    appId: row.type === 'qqbot' ? row.qq_app_id : null,
    appSecretConfigured: row.type === 'qqbot' && Boolean(row.qq_app_secret),
    botSecretConfigured: row.type === 'qqbot' && Boolean(row.qq_bot_secret),
    userCount: row.type === 'qqbot' ? Number(row.qq_user_count || 0) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublicRule(row: NotificationRuleRow): MonitorNotificationRule {
  return {
    enabled: row.enabled,
    notifyOnDegraded: row.notify_on_degraded,
    notifyOnDown: row.notify_on_down,
    notifyOnRecovery: row.notify_on_recovery,
    failureThreshold: row.failure_threshold,
  };
}

function toBinding(row: NotificationBindingRow): MonitorNotificationBinding {
  return {
    channelId: row.channel_id,
    name: row.channel_name,
    type: row.channel_type,
    defaultEnabled: row.channel_default_enabled,
    enabled: row.enabled,
  };
}

function toQQChannel(row: Pick<NotificationChannelRow, 'id' | 'type' | 'name' | 'qq_app_id' | 'qq_app_secret' | 'qq_bot_secret' | 'qq_access_token' | 'qq_access_token_expires_at'>): QQChannelRow {
  if (row.type !== 'qqbot') throw new Error('通知配置不是 QQ 机器人');
  return { ...row, type: 'qqbot' };
}

export async function listNotificationChannels(db: D1Database): Promise<NotificationChannel[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM qq_notification_users u
               WHERE u.channel_id = c.id AND u.enabled = 1) AS qq_user_count
       FROM notification_channels c
       ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .all<NotificationChannelRow>();
  return results.map(toChannel);
}

export async function getNotificationChannelRow(db: D1Database, id: string): Promise<NotificationChannelRow | null> {
  return db.prepare('SELECT * FROM notification_channels WHERE id = ?1').bind(id).first<NotificationChannelRow>();
}

export async function getNotificationRule(db: D1Database, monitorId: string): Promise<NotificationRuleRow> {
  await db.prepare(
    `INSERT OR IGNORE INTO monitor_notification_rules
     (monitor_id, enabled, notify_on_degraded, notify_on_down, notify_on_recovery, failure_threshold,
      consecutive_abnormal, incident_status, incident_id, pending_event_key, pending_event_type,
      pending_checked_at, updated_at)
     VALUES (?1, 1, 0, 1, 1, ?2, 0, NULL, NULL, NULL, NULL, NULL, ?3)`,
  ).bind(monitorId, DEFAULT_FAILURE_THRESHOLD, nowIso()).run();
  const row = await db
    .prepare('SELECT * FROM monitor_notification_rules WHERE monitor_id = ?1')
    .bind(monitorId)
    .first<NotificationRuleRow>();
  if (!row) throw new Error('通知规则不存在');
  return row;
}

async function listBindingRows(db: D1Database, monitorId: string): Promise<NotificationBindingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT b.*, c.type AS channel_type, c.name AS channel_name,
              c.default_enabled AS channel_default_enabled, c.token_plaintext,
              c.qq_app_id, c.qq_app_secret, c.qq_bot_secret,
              c.qq_access_token, c.qq_access_token_expires_at
       FROM monitor_notification_bindings b
       INNER JOIN notification_channels c ON c.id = b.channel_id
       WHERE b.monitor_id = ?1
       ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .bind(monitorId)
    .all<NotificationBindingRow>();
  return results;
}

export async function getMonitorNotificationSettings(db: D1Database, monitorId: string): Promise<{
  channels: MonitorNotificationBinding[];
  rule: MonitorNotificationRule;
}> {
  const rule = await getNotificationRule(db, monitorId);
  const bindings = await listBindingRows(db, monitorId);
  const existing = new Map(bindings.map((binding) => [binding.channel_id, binding]));
  const channels = (await db
    .prepare('SELECT * FROM notification_channels ORDER BY name COLLATE NOCASE, id')
    .all<NotificationChannelRow>()).results.map((channel) => {
      const binding = existing.get(channel.id);
      return {
        channelId: channel.id,
        name: channel.name,
        type: channel.type,
        defaultEnabled: channel.default_enabled,
        enabled: binding?.enabled || 0,
      };
    });
  return { channels, rule: toPublicRule(rule) };
}

async function runBatches(db: D1Database, statements: ReturnType<D1Database['prepare']>[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

export async function applyDefaultNotificationsToMonitor(db: D1Database, monitorId: string): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO monitor_notification_bindings (monitor_id, channel_id, enabled)
     SELECT ?1, id, default_enabled FROM notification_channels`,
  ).bind(monitorId).run();
}

export async function saveMonitorNotificationSettings(
  db: D1Database,
  monitorId: string,
  bindings: Array<{ channelId: string; enabled: boolean }>,
  rule: {
    enabled: boolean;
    notifyOnDegraded: boolean;
    notifyOnDown: boolean;
    notifyOnRecovery: boolean;
    failureThreshold: number;
  },
): Promise<void> {
  const timestamp = nowIso();
  const statements = [
    db.prepare('DELETE FROM monitor_notification_bindings WHERE monitor_id = ?1').bind(monitorId),
    db.prepare(
      `INSERT INTO monitor_notification_rules
       (monitor_id, enabled, notify_on_degraded, notify_on_down, notify_on_recovery, failure_threshold,
        consecutive_abnormal, incident_status, incident_id, pending_event_key, pending_event_type,
        pending_checked_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6,
               COALESCE((SELECT consecutive_abnormal FROM monitor_notification_rules WHERE monitor_id = ?1), 0),
               (SELECT incident_status FROM monitor_notification_rules WHERE monitor_id = ?1),
               (SELECT incident_id FROM monitor_notification_rules WHERE monitor_id = ?1),
               (SELECT pending_event_key FROM monitor_notification_rules WHERE monitor_id = ?1),
               (SELECT pending_event_type FROM monitor_notification_rules WHERE monitor_id = ?1),
               (SELECT pending_checked_at FROM monitor_notification_rules WHERE monitor_id = ?1), ?7)
       ON CONFLICT(monitor_id) DO UPDATE SET
         enabled = excluded.enabled,
         notify_on_degraded = excluded.notify_on_degraded,
         notify_on_down = excluded.notify_on_down,
         notify_on_recovery = excluded.notify_on_recovery,
         failure_threshold = excluded.failure_threshold,
         updated_at = excluded.updated_at`,
    ).bind(
      monitorId,
      rule.enabled ? 1 : 0,
      rule.notifyOnDegraded ? 1 : 0,
      rule.notifyOnDown ? 1 : 0,
      rule.notifyOnRecovery ? 1 : 0,
      rule.failureThreshold,
      timestamp,
    ),
    ...bindings.map((binding) => db.prepare(
      `INSERT INTO monitor_notification_bindings (monitor_id, channel_id, enabled)
       VALUES (?1, ?2, ?3)`,
    ).bind(monitorId, binding.channelId, binding.enabled ? 1 : 0)),
  ];
  await runBatches(db, statements);
}

export async function applyChannelToExistingMonitors(
  db: D1Database,
  channelId: string,
  enabled: boolean,
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO monitor_notification_bindings (monitor_id, channel_id, enabled)
     SELECT id, ?1, ?2 FROM monitors`,
  ).bind(channelId, enabled ? 1 : 0).run();
}

function eventEnabled(rule: NotificationRuleRow, eventType: NotificationEventType): boolean {
  if (eventType === 'degraded') return rule.notify_on_degraded === 1;
  if (eventType === 'down') return rule.notify_on_down === 1;
  return rule.notify_on_recovery === 1;
}

function isAbnormal(status: MonitorStatus): status is 'degraded' | 'down' {
  return status === 'degraded' || status === 'down';
}

function stateEventKey(incidentId: string, eventType: NotificationEventType): string {
  return `${incidentId}:${eventType}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character] || character));
}

function statusText(eventType: NotificationEventType): string {
  return eventType === 'recovery' ? '恢复正常' : eventType === 'down' ? '宕机' : '部分异常';
}

function notificationContent(monitor: Monitor, eventType: NotificationEventType, checkedAt: string): { html: string; text: string; title: string } {
  const state = statusText(eventType);
  const target = monitor.targetUrl || (monitor.type === 'tcp' ? `${monitor.host || ''}:${monitor.port || ''}` : monitor.host || '');
  return {
    title: `${state} · ${monitor.name}`,
    html: [
      `<strong>${escapeHtml(state)}</strong>`,
      `<br>监控：${escapeHtml(monitor.name)}`,
      `<br>目标：${escapeHtml(target)}`,
      `<br>类型：${escapeHtml(monitor.type.toUpperCase())} · ${escapeHtml(monitor.provider)}`,
      `<br>检查时间：${escapeHtml(checkedAt)}`,
    ].join(''),
    text: [
      `[Pulseboard] ${state}`,
      `监控：${monitor.name}`,
      `目标：${target}`,
      `类型：${monitor.type.toUpperCase()} · ${monitor.provider}`,
      `检查时间：${checkedAt}`,
    ].join('\n'),
  };
}

export async function sendPushPlusToken(
  token: string,
  title: string,
  content: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let response: Response;
    try {
      response = await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, title, content, template: 'html' }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('PushPlus 请求超时（10 秒）');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接 PushPlus：${message}`);
    }
    const raw = await response.text();
    let data: { code?: number | string; msg?: string } = {};
    try {
      data = JSON.parse(raw) as { code?: number | string; msg?: string };
    } catch {
      // PushPlus errors are still reported through the HTTP status when the body is not JSON.
    }
    if (!response.ok) {
      throw new Error(`PushPlus HTTP ${response.status}${data.msg ? `：${data.msg}` : ''}`);
    }
    if (data.code !== undefined && String(data.code) !== '200') {
      throw new Error(`PushPlus 返回失败（${data.code}）${data.msg ? `：${data.msg}` : ''}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function dispatchable(binding: NotificationBindingRow): boolean {
  if (binding.channel_type === 'pushplus') return Boolean(binding.token_plaintext);
  return qqChannelConfigured(toQQChannel({
    id: binding.channel_id,
    type: 'qqbot',
    name: binding.channel_name,
    qq_app_id: binding.qq_app_id,
    qq_app_secret: binding.qq_app_secret,
    qq_bot_secret: binding.qq_bot_secret,
    qq_access_token: binding.qq_access_token,
    qq_access_token_expires_at: binding.qq_access_token_expires_at,
  }));
}

async function ensureQQDeliveryRows(env: Env, monitorId: string, channelId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO monitor_notification_user_deliveries (monitor_id, channel_id, user_id)
     SELECT ?1, ?2, id FROM qq_notification_users
     WHERE channel_id = ?2`,
  ).bind(monitorId, channelId).run();
}

async function dispatchQQBinding(
  env: Env,
  monitor: Monitor,
  binding: NotificationBindingRow,
  eventKey: string,
  content: string,
  attemptAt: number,
): Promise<void> {
  await ensureQQDeliveryRows(env, monitor.id, binding.channel_id);
  const { results } = await env.DB.prepare(
    `SELECT d.*, u.openid, u.nickname
     FROM monitor_notification_user_deliveries d
     INNER JOIN qq_notification_users u ON u.id = d.user_id
     WHERE d.monitor_id = ?1 AND d.channel_id = ?2 AND u.enabled = 1
     ORDER BY u.updated_at DESC, u.id`,
  ).bind(monitor.id, binding.channel_id).all<QQDeliveryRow>();
  const channel = toQQChannel({
    id: binding.channel_id,
    type: 'qqbot',
    name: binding.channel_name,
    qq_app_id: binding.qq_app_id,
    qq_app_secret: binding.qq_app_secret,
    qq_bot_secret: binding.qq_bot_secret,
    qq_access_token: binding.qq_access_token,
    qq_access_token_expires_at: binding.qq_access_token_expires_at,
  });
  for (const delivery of results) {
    if (delivery.last_event_key === eventKey || delivery.retry_count >= MAX_NOTIFICATION_RETRIES) continue;
    if (delivery.last_attempt_at && attemptAt - Date.parse(delivery.last_attempt_at) < NOTIFICATION_RETRY_INTERVAL_MS) continue;
    try {
      await sendQQDirectMessage(env.DB, channel, delivery.openid, content);
      await env.DB.prepare(
        `UPDATE monitor_notification_user_deliveries
         SET last_event_key = ?1, last_attempt_at = ?2, retry_count = 0, last_error = NULL
         WHERE monitor_id = ?3 AND channel_id = ?4 AND user_id = ?5`,
      ).bind(eventKey, nowIso(), monitor.id, binding.channel_id, delivery.user_id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QQ 发送失败';
      await env.DB.prepare(
        `UPDATE monitor_notification_user_deliveries
         SET last_attempt_at = ?1, retry_count = retry_count + 1, last_error = ?2
         WHERE monitor_id = ?3 AND channel_id = ?4 AND user_id = ?5`,
      ).bind(nowIso(), message.slice(0, 500), monitor.id, binding.channel_id, delivery.user_id).run();
      console.warn(`[notifications] QQ channel ${binding.channel_id}, user ${delivery.user_id}: ${message}`);
    }
  }
}

async function qqDeliveryPending(env: Env, monitorId: string, channelId: string, eventKey: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM monitor_notification_user_deliveries d
     INNER JOIN qq_notification_users u ON u.id = d.user_id
     WHERE d.monitor_id = ?1 AND d.channel_id = ?2 AND u.enabled = 1
       AND (d.last_event_key IS NULL OR d.last_event_key != ?3)
       AND d.retry_count < ?4`,
  ).bind(monitorId, channelId, eventKey, MAX_NOTIFICATION_RETRIES).first<{ count: number }>();
  return Number(row?.count || 0) > 0;
}

async function dispatchPendingNotification(
  env: Env,
  monitor: Monitor,
  rule: NotificationRuleRow,
): Promise<void> {
  if (!rule.pending_event_key || !rule.pending_event_type || rule.enabled !== 1) return;
  const bindings = (await listBindingRows(env.DB, monitor.id)).filter((binding) => binding.enabled === 1 && dispatchable(binding));
  if (!bindings.length) {
    await env.DB.prepare(
      `UPDATE monitor_notification_rules
       SET pending_event_key = NULL, pending_event_type = NULL, pending_checked_at = NULL, updated_at = ?1
       WHERE monitor_id = ?2`,
    ).bind(nowIso(), monitor.id).run();
    return;
  }

  const eventType = rule.pending_event_type;
  const checkedAt = rule.pending_checked_at || nowIso();
  const payload = notificationContent(monitor, eventType, checkedAt);
  const attemptAt = Date.now();
  for (const binding of bindings) {
    if (binding.channel_type === 'qqbot') {
      await dispatchQQBinding(env, monitor, binding, rule.pending_event_key, payload.text, attemptAt);
      continue;
    }
    if (binding.last_event_key === rule.pending_event_key || binding.retry_count >= MAX_NOTIFICATION_RETRIES) continue;
    if (binding.last_attempt_at && attemptAt - Date.parse(binding.last_attempt_at) < NOTIFICATION_RETRY_INTERVAL_MS) continue;
    try {
      await sendPushPlusToken(binding.token_plaintext, payload.title, payload.html);
      await env.DB.prepare(
        `UPDATE monitor_notification_bindings
         SET last_event_key = ?1, last_attempt_at = ?2, retry_count = 0, last_error = NULL
         WHERE monitor_id = ?3 AND channel_id = ?4`,
      ).bind(rule.pending_event_key, checkedAt, monitor.id, binding.channel_id).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PushPlus 发送失败';
      await env.DB.prepare(
        `UPDATE monitor_notification_bindings
         SET last_attempt_at = ?1, retry_count = retry_count + 1, last_error = ?2
         WHERE monitor_id = ?3 AND channel_id = ?4`,
      ).bind(nowIso(), message.slice(0, 500), monitor.id, binding.channel_id).run();
      console.warn(`[notifications] PushPlus channel ${binding.channel_id}: ${message}`);
    }
  }

  const remaining = await Promise.all((await listBindingRows(env.DB, monitor.id)).filter((binding) => binding.enabled === 1 && dispatchable(binding)).map(async (binding) => {
    if (binding.channel_type === 'qqbot') return qqDeliveryPending(env, monitor.id, binding.channel_id, rule.pending_event_key as string);
    return binding.last_event_key !== rule.pending_event_key && binding.retry_count < MAX_NOTIFICATION_RETRIES;
  }));
  if (!remaining.some(Boolean)) {
    await env.DB.prepare(
      `UPDATE monitor_notification_rules
       SET pending_event_key = NULL, pending_event_type = NULL, pending_checked_at = NULL, updated_at = ?1
       WHERE monitor_id = ?2`,
    ).bind(nowIso(), monitor.id).run();
  }
}

export async function processMonitorStatus(
  env: Env,
  monitor: Monitor,
  previousStatus: MonitorStatus,
  nextStatus: MonitorStatus,
  checkedAt: string,
): Promise<void> {
  const currentRule = await getNotificationRule(env.DB, monitor.id);
  let consecutiveAbnormal = currentRule.consecutive_abnormal;
  let incidentStatus = currentRule.incident_status;
  let incidentId = currentRule.incident_id;
  let pendingEventKey = currentRule.pending_event_key;
  let pendingEventType = currentRule.pending_event_type;
  let pendingCheckedAt = currentRule.pending_checked_at;
  let eventType: NotificationEventType | null = null;

  if (isAbnormal(nextStatus)) {
    consecutiveAbnormal = isAbnormal(previousStatus) ? consecutiveAbnormal + 1 : 1;
    if (!incidentStatus && consecutiveAbnormal >= currentRule.failure_threshold) {
      incidentId = crypto.randomUUID();
      incidentStatus = nextStatus;
      eventType = nextStatus;
    } else if (incidentStatus && incidentStatus !== nextStatus) {
      incidentStatus = nextStatus;
      eventType = nextStatus;
    }
  } else if (nextStatus === 'up') {
    consecutiveAbnormal = 0;
    if (incidentStatus) {
      eventType = 'recovery';
      incidentStatus = null;
    }
  }

  if (eventType && incidentId && eventEnabled(currentRule, eventType)) {
    pendingEventKey = stateEventKey(incidentId, eventType);
    pendingEventType = eventType;
    pendingCheckedAt = checkedAt;
  }

  const updatedAt = nowIso();
  await env.DB.prepare(
    `UPDATE monitor_notification_rules
     SET consecutive_abnormal = ?1, incident_status = ?2, incident_id = ?3,
         pending_event_key = ?4, pending_event_type = ?5, pending_checked_at = ?6, updated_at = ?7
     WHERE monitor_id = ?8`,
  ).bind(
    consecutiveAbnormal,
    incidentStatus,
    incidentId,
    pendingEventKey,
    pendingEventType,
    pendingCheckedAt,
    updatedAt,
    monitor.id,
  ).run();
  await dispatchPendingNotification(env, monitor, {
    ...currentRule,
    consecutive_abnormal: consecutiveAbnormal,
    incident_status: incidentStatus,
    incident_id: incidentId,
    pending_event_key: pendingEventKey,
    pending_event_type: pendingEventType,
    pending_checked_at: pendingCheckedAt,
    updated_at: updatedAt,
  });
}

export async function sendTestNotification(env: Env, input: TestNotificationInput): Promise<void> {
  const channel = input.channelId ? await getNotificationChannelRow(env.DB, input.channelId) : null;
  if (input.channelId && !channel) throw new Error('通知配置不存在');
  const type = input.type || channel?.type || 'pushplus';
  const name = input.name?.trim() || channel?.name || (type === 'qqbot' ? 'QQ 机器人通知' : 'PushPlus 通知');
  if (type === 'pushplus') {
    const token = input.token?.trim() || channel?.token_plaintext;
    if (!token) throw new Error('PushPlus Token 尚未配置');
    await sendPushPlusToken(token, `测试通知 · ${name}`, '<strong>PushPlus 通知测试成功</strong><br>这是一条来自 Pulseboard 的测试消息。');
    return;
  }

  if (channel && channel.type !== 'qqbot') throw new Error('通知配置类型不匹配');
  const qqChannel: QQChannelRow = {
    id: channel?.id || 'test-qqbot',
    type: 'qqbot',
    name,
    qq_app_id: input.qqAppId?.trim() || channel?.qq_app_id || null,
    qq_app_secret: input.qqAppSecret?.trim() || channel?.qq_app_secret || null,
    qq_bot_secret: input.qqBotSecret?.trim() || channel?.qq_bot_secret || null,
    qq_access_token: channel?.qq_access_token || null,
    qq_access_token_expires_at: channel?.qq_access_token_expires_at || null,
  };
  const openids = input.qqOpenId?.trim()
    ? [input.qqOpenId.trim()]
    : channel
      ? (await listQQUsers(env.DB, channel.id, false)).map((user) => user.openid)
      : [];
  if (!openids.length) throw new Error('请先添加至少一个 QQ 用户 OpenID，或在测试时填写 OpenID');
  const errors: string[] = [];
  for (const openid of openids) {
    try {
      await sendQQDirectMessage(env.DB, qqChannel, openid, `[Pulseboard] 测试通知\n渠道：${name}\nQQ 私聊通知配置已生效。`);
    } catch (error) {
      errors.push(error instanceof Error ? `${openid}：${error.message}` : `${openid}：QQ 发送失败`);
    }
  }
  if (errors.length) throw new Error(errors.join('；'));
}
