import { getResults as getCheckHostResults, startCheck as startCheckHost } from './check-host';
import { getAppSetting, getJob, getMonitor, getPendingJob, getSystemSettings, newId, nowIso } from './db';
import { getGlobalpingResults, startGlobalpingCheck } from './globalping';
import { processMonitorStatus } from './notifications';
import { checkWorkerMonitor } from './worker-check';
import { ProviderError, type ParsedProbeResult } from './provider';
import type { Env, Monitor, ProbeNode } from './types';

function monitorStatus(successes: number, failures: number): Monitor['currentStatus'] {
  if (successes === 0 && failures === 0) return 'unknown';
  if (failures > successes) return 'down';
  if (failures > 0) return 'degraded';
  return 'up';
}

async function markUnknown(env: Env, monitorId: string, checkedAt: string, reason?: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE monitors
     SET current_status = 'unknown', last_checked_at = ?1, updated_at = ?1
     WHERE id = ?2`,
  ).bind(checkedAt, monitorId).run();
  if (reason) console.warn(`[scheduler] monitor ${monitorId}: ${reason}`);
}

async function completeJob(env: Env, jobId: string, monitor: Monitor, results: ParsedProbeResult[], checkedAt: string): Promise<void> {
  const successCount = results.filter((item) => item.success).length;
  const failureCount = results.length - successCount;
  const status = monitorStatus(successCount, failureCount);
  const nodeStatements = results
    .filter((item) => item.probe)
    .map((item) => {
      const node = item.probe as ProbeNode;
      return env.DB.prepare(
        `INSERT INTO probe_nodes
         (id, provider, country_code, country_name, city, ip, asn, enabled, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           country_code = excluded.country_code,
           country_name = excluded.country_name,
           city = excluded.city,
           ip = excluded.ip,
           asn = excluded.asn,
           enabled = 1,
           last_seen_at = excluded.last_seen_at`,
      ).bind(node.id, node.provider, node.countryCode, node.countryName, node.city, node.ip, node.asn, node.lastSeenAt);
    });
  const statements = results.map((item) => env.DB.prepare(
    `INSERT OR REPLACE INTO check_results
     (id, job_id, monitor_id, node_id, success, latency_ms, status_code, message, resolved_ip, checked_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(
    newId(),
    jobId,
    monitor.id,
    item.nodeId,
    item.success ? 1 : 0,
    item.latencyMs,
    item.statusCode,
    item.message,
    item.resolvedIp,
    checkedAt,
  ));
  statements.unshift(...nodeStatements);
  statements.push(
    env.DB.prepare(
      `UPDATE check_jobs
       SET state = 'completed', completed_at = ?1, next_poll_at = NULL, error_message = NULL
       WHERE id = ?2`,
    ).bind(checkedAt, jobId),
    env.DB.prepare(
      `UPDATE monitors
       SET current_status = ?1, last_checked_at = ?2, updated_at = ?2
       WHERE id = ?3`,
    ).bind(status, checkedAt, monitor.id),
  );
  await env.DB.batch(statements);
  try {
    await processMonitorStatus(env, monitor, monitor.currentStatus, status, checkedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : '通知处理失败';
    console.warn(`[scheduler] monitor ${monitor.id} notification processing failed: ${message}`);
  }
}

export async function startMonitorJob(env: Env, monitorId: string): Promise<{ jobId: string | null; error?: string }> {
  const monitor = await getMonitor(env.DB, monitorId);
  if (!monitor) return { jobId: null, error: '监控不存在' };
  if (!monitor.enabled) return { jobId: null, error: '监控已暂停' };

  const pending = await getPendingJob(env.DB, monitorId);
  if (pending) return { jobId: null, error: '该监控已有检查任务正在等待结果' };
  const hasTargets = monitor.provider === 'globalping'
    ? monitor.globalpingLocations.length > 0
    : monitor.provider === 'worker' || monitor.nodes.length > 0;
  if (!hasTargets) {
    await markUnknown(env, monitorId, nowIso(), '没有选择探测节点');
    return { jobId: null, error: monitor.provider === 'globalping' ? '请至少选择一个 Globalping 探测位置' : '请至少选择一个探测节点' };
  }

  const createdAt = nowIso();
  const jobId = newId();
  const expiresAt = new Date(Date.now() + 150_000).toISOString();
  try {
    if (monitor.provider === 'worker') {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO check_jobs
           (id, monitor_id, request_id, provider, state, created_at, expires_at, poll_count)
           VALUES (?1, ?2, NULL, 'worker', 'pending', ?3, ?4, 0)`,
        ).bind(jobId, monitorId, createdAt, expiresAt),
        env.DB.prepare('UPDATE monitors SET last_started_at = ?1, updated_at = ?1 WHERE id = ?2').bind(createdAt, monitorId),
      ]);
      const result = await checkWorkerMonitor(monitor);
      await completeJob(env, jobId, monitor, [result], nowIso());
      return { jobId };
    }

    const requestId = monitor.provider === 'globalping'
      ? await startGlobalpingCheck(env, monitor)
      : await startCheckHost(monitor, monitor.nodes);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO check_jobs
         (id, monitor_id, request_id, provider, state, created_at, next_poll_at, expires_at, poll_count)
         VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?6, 0)`,
      ).bind(jobId, monitorId, requestId, monitor.provider, createdAt, expiresAt),
      env.DB.prepare('UPDATE monitors SET last_started_at = ?1, updated_at = ?1 WHERE id = ?2').bind(createdAt, monitorId),
    ]);
    return { jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${monitor.provider} 创建任务失败`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO check_jobs
         (id, monitor_id, request_id, provider, state, error_message, created_at, expires_at, completed_at, poll_count)
         VALUES (?1, ?2, NULL, ?3, 'provider_error', ?4, ?5, ?5, ?5, 0)`,
      ).bind(jobId, monitorId, monitor.provider, message.slice(0, 500), createdAt),
      env.DB.prepare(
        `UPDATE monitors
         SET current_status = 'unknown', last_started_at = ?1, last_checked_at = ?1, updated_at = ?1
         WHERE id = ?2`,
      ).bind(createdAt, monitorId),
    ]);
    return { jobId, error: message };
  }
}

async function expireJob(env: Env, jobId: string, monitorId: string, reason: string): Promise<void> {
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE check_jobs
       SET state = 'expired', error_message = ?1, completed_at = ?2, next_poll_at = NULL
       WHERE id = ?3`,
    ).bind(reason.slice(0, 500), timestamp, jobId),
    env.DB.prepare(
      `UPDATE monitors
       SET current_status = 'unknown', last_checked_at = ?1, updated_at = ?1
       WHERE id = ?2`,
    ).bind(timestamp, monitorId),
  ]);
}

export async function collectJob(env: Env, jobId: string): Promise<'completed' | 'pending' | 'expired' | 'missing'> {
  const job = await getJob(env.DB, jobId);
  if (!job || job.state !== 'pending') return job ? 'completed' : 'missing';
  const monitor = await getMonitor(env.DB, job.monitor_id);
  if (!monitor || !job.request_id || job.provider === 'worker') {
    await expireJob(env, job.id, job.monitor_id, '检查任务信息不完整');
    return 'expired';
  }

  if (Date.now() >= Date.parse(job.expires_at)) {
    await expireJob(env, job.id, job.monitor_id, `${job.provider} 结果等待超时`);
    return 'expired';
  }

  try {
    const result = job.provider === 'globalping'
      ? await getGlobalpingResults(env, job.request_id)
      : await getCheckHostResults(monitor, monitor.nodes, job.request_id);
    if (!result.ready || (job.provider === 'check-host' && result.results.length < monitor.nodes.length)) {
      await env.DB.prepare(
        `UPDATE check_jobs
         SET poll_count = poll_count + 1, next_poll_at = ?1, error_message = NULL
         WHERE id = ?2`,
      ).bind(new Date(Date.now() + 60_000).toISOString(), job.id).run();
      return 'pending';
    }
    await completeJob(env, job.id, monitor, result.results, nowIso());
    return 'completed';
  } catch (error) {
    if (error instanceof ProviderError) {
      const pollCount = job.poll_count + 1;
      await env.DB.prepare(
        `UPDATE check_jobs
         SET poll_count = ?1, next_poll_at = ?2, error_message = ?3
         WHERE id = ?4`,
      ).bind(pollCount, new Date(Date.now() + 60_000).toISOString(), error.message.slice(0, 500), job.id).run();
      return 'pending';
    }
    throw error;
  }
}

async function collectPending(env: Env, maxJobs: number): Promise<number> {
  const { results } = await env.DB
    .prepare(
      `SELECT id FROM check_jobs
       WHERE state = 'pending' AND provider != 'worker'
         AND (next_poll_at IS NULL OR next_poll_at <= ?1)
       ORDER BY created_at LIMIT ${maxJobs}`,
    )
    .bind(nowIso())
    .all<{ id: string }>();
  for (const row of results) await collectJob(env, row.id);
  return results.length;
}

async function startDueMonitors(env: Env, maxJobs: number): Promise<void> {
  const now = nowIso();
  const { results } = await env.DB
    .prepare(
      `SELECT m.id
       FROM monitors m
       WHERE m.enabled = 1
         AND (m.last_started_at IS NULL
              OR strftime('%s', m.last_started_at) + m.interval_seconds <= strftime('%s', ?1))
         AND NOT EXISTS (
           SELECT 1 FROM check_jobs j
           WHERE j.monitor_id = m.id AND j.state = 'pending'
         )
       ORDER BY m.last_started_at IS NOT NULL, m.last_started_at, m.created_at
       LIMIT ${maxJobs}`,
    )
    .bind(now)
    .all<{ id: string }>();
  for (const row of results) await startMonitorJob(env, row.id);
}

async function cleanupHistory(env: Env): Promise<void> {
  const settings = await getSystemSettings(env.DB);
  if (settings.historyRetentionDays === 0) return;
  const cutoff = new Date(Date.now() - settings.historyRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM check_results WHERE checked_at < ?1').bind(cutoff),
    env.DB.prepare('DELETE FROM check_jobs WHERE created_at < ?1 AND state != \'pending\'').bind(cutoff),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?1').bind(nowIso()),
  ]);
}

async function acquireLease(env: Env, owner: string): Promise<boolean> {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO scheduler_leases (id, owner, expires_at)
     VALUES ('main', ?1, ?2)
     ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
     WHERE scheduler_leases.expires_at <= ?3`,
  ).bind(owner, expiresAt, now).run();
  return (result.meta.changes || 0) > 0;
}

async function releaseLease(env: Env, owner: string): Promise<void> {
  await env.DB.prepare("DELETE FROM scheduler_leases WHERE id = 'main' AND owner = ?1").bind(owner).run();
}

export async function runScheduler(env: Env): Promise<void> {
  const owner = crypto.randomUUID();
  if (!(await acquireLease(env, owner))) return;
  try {
    const settings = await getSystemSettings(env.DB);
    const collected = await collectPending(env, settings.maxJobsPerTick);
    await startDueMonitors(env, Math.max(0, settings.maxJobsPerTick - collected));
    if (new Date().getUTCMinutes() === 0) await cleanupHistory(env);
  } finally {
    await releaseLease(env, owner);
  }
}
