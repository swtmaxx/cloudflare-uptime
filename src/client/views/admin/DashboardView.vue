<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import StatusBadge from '../../components/StatusBadge.vue';
import Tags from '../../components/Tags.vue';
import PageHead from '../../components/PageHead.vue';
import { formatDate, formatMs, providerLabel, typeLabel } from '../../utils';
import type { AdminSettings, Monitor } from '../../types';

const props = defineProps<{ settings: AdminSettings; notify: (m: string, e?: boolean) => void }>();
const monitors = ref<Monitor[]>([]);
const counts = ref<Record<string, number>>({});
const recent = ref<Record<string, any>[]>([]);

onMounted(async () => {
  try {
    const data = await api<{ monitors: Monitor[]; counts: Record<string, number>; recentResults: Record<string, any>[] }>('/api/dashboard');
    monitors.value = data.monitors;
    counts.value = data.counts;
    recent.value = data.recentResults || [];
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取总览', true);
  }
});

function targetText(m: Monitor): string {
  return m.targetUrl || (m.type === 'tcp' ? `${m.host}:${m.port}` : m.host || '—');
}
</script>

<template>
  <PageHead kicker="Control room" title="运行总览" note="查看所有监控的最新状态和最近一次地区探测。" />
  <div class="metric-grid">
    <div class="metric"><div class="metric-label">正常</div><div class="metric-value mint">{{ counts.up || 0 }}</div></div>
    <div class="metric"><div class="metric-label">部分异常</div><div class="metric-value amber">{{ counts.degraded || 0 }}</div></div>
    <div class="metric"><div class="metric-label">宕机</div><div class="metric-value red">{{ counts.down || 0 }}</div></div>
    <div class="metric"><div class="metric-label">已暂停</div><div class="metric-value">{{ counts.paused || 0 }}</div></div>
  </div>
  <section class="section">
    <div class="section-head"><h2 class="section-title">监控状态</h2></div>
    <div class="panel table-wrap">
      <table v-if="monitors.length">
        <thead><tr><th>监控</th><th>类型</th><th>状态</th><th>探测范围</th><th>最近检查</th></tr></thead>
        <tbody>
          <tr v-for="monitor in monitors" :key="monitor.id">
            <td><div class="monitor-name">{{ monitor.name }}</div><div class="target">{{ targetText(monitor) }}</div><Tags :tags="monitor.tags" /></td>
            <td><span class="tag">{{ typeLabel(monitor.type) }}</span> <span class="tag">{{ providerLabel(monitor.provider) }}</span></td>
            <td><StatusBadge :status="monitor.enabled ? monitor.currentStatus : 'paused'" /></td>
            <td>{{ monitor.provider === 'worker' ? '本地 Worker' : `${monitor.globalpingLocations.length} 个位置` }}</td>
            <td>{{ formatDate(monitor.lastCheckedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty"><strong>还没有监控</strong><span>创建第一个 HTTP、TCP 或 Ping 监控开始使用。</span></div>
    </div>
  </section>
  <section class="section">
    <div class="section-head"><h2 class="section-title">最近探测</h2><span class="muted">按节点记录</span></div>
    <div class="panel table-wrap">
      <table v-if="recent.length">
        <thead><tr><th>监控</th><th>地区</th><th>结果</th><th>耗时</th><th>状态码</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="(result, index) in recent" :key="`${result.monitor_id}-${result.checked_at}-${index}`">
            <td class="monitor-name">{{ result.monitor_name }}</td>
            <td>{{ result.country_name }} · {{ result.city }}</td>
            <td><StatusBadge :status="result.success ? 'up' : 'down'" /></td>
            <td>{{ formatMs(result.latency_ms) }}</td>
            <td>{{ result.status_code || '—' }}</td>
            <td>{{ formatDate(result.checked_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty"><strong>暂无检查记录</strong><span>任务完成后，节点结果会显示在这里。</span></div>
    </div>
  </section>
</template>
