<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api';
import HeartbeatBar from '../../components/HeartbeatBar.vue';
import PageHead from '../../components/PageHead.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import Empty from '../../components/Empty.vue';
import { formatAdminDate, formatMs, providerLabel, typeLabel } from '../../utils';
import type { AdminSettings, CheckResult, Monitor } from '../../types';
import { onRealtimeEvent, realtimeScopeMatches } from '../../realtime';

const props = defineProps<{
  monitorId: string;
  settings: AdminSettings;
  notify: (message: string, error?: boolean) => void;
}>();
const emit = defineEmits<{ (event: 'navigate', path: string): void }>();

const monitor = ref<Monitor | null>(null);
const results = ref<CheckResult[]>([]);
const loading = ref(true);
const checking = ref(false);
let removeRealtimeListener: (() => void) | undefined;

async function load() {
  try {
    const [monitorData, resultData] = await Promise.all([
      api<{ monitor: Monitor }>(`/api/monitors/${encodeURIComponent(props.monitorId)}`),
      api<{ results: CheckResult[] }>(`/api/monitors/${encodeURIComponent(props.monitorId)}/results?limit=100`),
    ]);
    monitor.value = monitorData.monitor;
    results.value = resultData.results || [];
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取监控详情', true);
  } finally {
    loading.value = false;
  }
}

async function checkNow() {
  checking.value = true;
  try {
    await api(`/api/monitors/${encodeURIComponent(props.monitorId)}/check-now`, { method: 'POST' });
    props.notify('检查任务已提交');
    await load();
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '检查任务提交失败', true);
  } finally {
    checking.value = false;
  }
}

function targetText(item: Monitor): string {
  return item.targetUrl || (item.type === 'tcp' ? `${item.host}:${item.port}` : item.host || '—');
}

onMounted(() => {
  void load();
  removeRealtimeListener = onRealtimeEvent((event) => {
    if (event.monitorId === props.monitorId || realtimeScopeMatches(event, ['history'])) void load();
  });
});
onBeforeUnmount(() => removeRealtimeListener?.());
</script>

<template>
  <PageHead kicker="Monitor detail" :title="monitor?.name || '监控详情'" note="查看当前状态、心跳历史和最近探测结果。">
    <template #action>
      <button class="button ghost" type="button" @click="emit('navigate', '/admin/monitors')">返回列表</button>
      <button v-if="monitor" class="button ghost" type="button" @click="emit('navigate', `/admin/edit/${encodeURIComponent(monitor.id)}`)">编辑</button>
      <button v-if="monitor" class="button primary" type="button" :disabled="checking || !monitor.enabled" @click="checkNow">{{ checking ? '提交中…' : '立即检查' }}</button>
    </template>
  </PageHead>

  <div v-if="loading" class="panel empty">读取监控详情…</div>
  <template v-else-if="monitor">
    <div class="metric-grid">
      <div class="metric"><div class="metric-label">当前状态</div><div class="metric-value"><StatusBadge :status="monitor.enabled ? monitor.currentStatus : 'paused'" /></div></div>
      <div class="metric"><div class="metric-label">类型</div><div class="metric-value metric-text">{{ typeLabel(monitor.type) }}</div></div>
      <div class="metric"><div class="metric-label">探测服务</div><div class="metric-value metric-text">{{ providerLabel(monitor.provider) }}</div></div>
      <div class="metric"><div class="metric-label">最近检查</div><div class="metric-value metric-text">{{ formatAdminDate(monitor.lastCheckedAt, props.settings.timeDisplay) }}</div></div>
    </div>

    <section class="section split">
      <div class="panel detail-panel">
        <div class="section-head"><h2 class="section-title">监控信息</h2></div>
        <div class="info-list">
          <div class="info-row"><span class="info-key">目标</span><span class="info-value mono">{{ targetText(monitor) }}</span></div>
          <div class="info-row"><span class="info-key">检查间隔</span><span class="info-value">{{ monitor.intervalSeconds }} 秒</span></div>
          <div class="info-row"><span class="info-key">超时时间</span><span class="info-value">{{ monitor.timeoutSeconds }} 秒</span></div>
          <div class="info-row"><span class="info-key">探测范围</span><span class="info-value">{{ monitor.provider === 'worker' ? 'Cloudflare Worker' : `${monitor.globalpingLocations.length} 个位置` }}</span></div>
        </div>
      </div>
      <div class="panel detail-panel">
        <div class="section-head"><h2 class="section-title">最近心跳</h2></div>
        <HeartbeatBar :history="monitor.history" :time-display="props.settings.timeDisplay" />
        <div class="detail-last-check">最近更新时间：{{ formatAdminDate(monitor.lastCheckedAt, props.settings.timeDisplay) }}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">探测结果</h2><span class="muted">最近 {{ results.length }} 条</span></div>
      <div class="panel table-wrap">
        <table v-if="results.length">
          <thead><tr><th>节点</th><th>结果</th><th>耗时</th><th>状态码</th><th>说明</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in results" :key="`${item.id || item.nodeId}-${item.checkedAt}-${index}`">
              <td>{{ item.node ? `${item.node.countryName} · ${item.node.city}` : item.nodeId }}</td>
              <td><StatusBadge :status="item.success ? 'up' : 'down'" /></td>
              <td>{{ formatMs(item.latencyMs) }}</td>
              <td>{{ item.statusCode || '—' }}</td>
              <td>{{ item.message || '—' }}</td>
              <td>{{ formatAdminDate(item.checkedAt, props.settings.timeDisplay) }}</td>
            </tr>
          </tbody>
        </table>
        <Empty v-else title="暂无探测结果" note="下一次检查完成后会显示结果。" />
      </div>
    </section>
  </template>
  <Empty v-else title="监控不存在" note="它可能已经被删除，返回监控列表继续操作。" />
</template>
