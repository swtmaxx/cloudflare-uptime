<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import PageHead from '../../components/PageHead.vue';
import Empty from '../../components/Empty.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { formatDate, formatMs } from '../../utils';
import type { CheckResult, Monitor } from '../../types';

const props = defineProps<{ notify: (m: string, e?: boolean) => void }>();

const monitors = ref<Monitor[]>([]);
const monitorId = ref('');
const results = ref<CheckResult[]>([]);
const monitor = ref<Monitor | null>(null);

onMounted(() => {
  api<{ monitors: Monitor[] }>('/api/monitors')
    .then((data) => {
      monitors.value = data.monitors;
      monitorId.value = monitorId.value || data.monitors[0]?.id || '';
    })
    .catch((reason) => props.notify(reason instanceof Error ? reason.message : '无法读取监控', true));
});

async function loadResults(id: string) {
  if (!id) { monitor.value = null; results.value = []; return; }
  monitor.value = monitors.value.find((item) => item.id === id) || null;
  try {
    const data = await api<{ results: CheckResult[] }>(`/api/monitors/${id}/results?limit=250`);
    results.value = data.results;
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取历史', true);
  }
}

async function clear(all: boolean) {
  if (!window.confirm(all ? '清理所有监控的历史记录？' : '清理当前监控的全部历史记录？')) return;
  try {
    await api(all ? '/api/history' : `/api/monitors/${monitorId.value}/history`, { method: 'DELETE' });
    if (!all) results.value = [];
    props.notify(all ? '全部历史已清理' : '当前监控历史已清理');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '清理失败', true);
  }
}
</script>

<template>
  <PageHead
    kicker="Check history"
    title="检查记录"
    note="查看每个探测节点的原始结果；系统不会单独创建故障事件。"
  >
    <template #action>
      <button class="button small ghost danger" type="button" @click="clear(true)">清理全部历史</button>
    </template>
  </PageHead>

  <div class="filter-bar">
    <select :value="monitorId" @change="loadResults(($event.target as HTMLSelectElement).value)">
      <option value="">选择监控</option>
      <option v-for="item in monitors" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <button class="button small ghost danger" type="button" :disabled="!monitorId" @click="clear(false)">清理当前监控</button>
  </div>

  <div class="panel table-wrap">
    <template v-if="monitor">
      <table v-if="results.length">
        <thead>
          <tr><th>节点</th><th>结果</th><th>耗时</th><th>状态码</th><th>说明</th><th>时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in results" :key="`${item.nodeId}-${item.checkedAt}-${index}`">
            <td>{{ item.node ? `${item.node.countryName} · ${item.node.city}` : item.nodeId }}</td>
            <td><StatusBadge :status="item.success ? 'up' : 'down'" /></td>
            <td>{{ formatMs(item.latencyMs) }}</td>
            <td>{{ item.statusCode || '—' }}</td>
            <td>{{ item.message || '—' }}</td>
            <td>{{ formatDate(item.checkedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <Empty v-else title="暂无记录" note="下一次探测任务完成后会显示结果。" />
    </template>
    <Empty v-else title="暂无监控" note="创建监控后会产生检查记录。" />
  </div>
</template>
