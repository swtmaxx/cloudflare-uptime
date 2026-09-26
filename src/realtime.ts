import type { Env, RealtimeEvent, RealtimeScope } from './types';

export function realtimeEvent(scope: RealtimeScope, monitorId?: string): RealtimeEvent {
  return {
    version: 1,
    type: 'invalidate',
    scope,
    ...(monitorId ? { monitorId } : {}),
    at: new Date().toISOString(),
  };
}

export async function broadcastRealtime(env: Env, event: RealtimeEvent): Promise<void> {
  if (!env.UPTIME_REALTIME) return;
  try {
    const id = env.UPTIME_REALTIME.idFromName('dashboard');
    const response = await env.UPTIME_REALTIME.get(id).fetch('https://realtime.internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!response.ok) console.warn(`[realtime] broadcast failed with HTTP ${response.status}`);
  } catch (error) {
    console.warn(`[realtime] broadcast failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
