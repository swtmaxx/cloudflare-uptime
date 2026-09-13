<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api';
import PageHead from '../../components/PageHead.vue';
import Empty from '../../components/Empty.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import Tags from '../../components/Tags.vue';
import HeartbeatBar from '../../components/HeartbeatBar.vue';
import { formatAdminDate, providerLabel, typeLabel } from '../../utils';
import type { AdminSettings, Monitor, Tag } from '../../types';
import MonitorForm from './MonitorForm.vue';
import TagManager from './TagManager.vue';

const props = defineProps<{ settings: AdminSettings; notify: (m: string, e?: boolean) => void }>();

const monitors = ref<Monitor[]>([]);
const tags = ref<Tag[]>([]);
const search = ref('');
const status = ref('');
const tagId = ref('');
const modal = ref<'monitor' | 'tags' | null>(null);
const editing = ref<Monitor | null>(null);

async function load() {
  try {
    const data = await api<{ monitors: Monitor[]; tags: Tag[] }>('/api/monitors?includeHistory=1');
    monitors.value = data.monitors;
    tags.value = data.tags || [];
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取监控', true);
  }
}

onMounted(load);

const filtered = computed(() => {
  const needle = search.value.toLocaleLowerCase();
  return monitors.value.filter((monitor) => {
    const currentStatus = monitor.enabled ? monitor.currentStatus : 'paused';
    const haystack = [monitor.name, monitor.targetUrl || '', monitor.host || '', ...(monitor.tags || []).map((item) => item.name)].some((value) => value.toLocaleLowerCase().includes(needle));
    return (!needle || haystack) && (!status.value || currentStatus === status.value) && (!tagId.value || (monitor.tags || []).some((tag) => tag.id === tagId.value));
  });
});

async function runAction(path: string, options: RequestInit, message: string) {
  try {
    await api(path, options);
    props.notify(message);
    await load();
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '操作失败', true);
  }
}

function targetText(monitor: Monitor): string {
  return monitor.targetUrl || (monitor.type === 'tcp' ? `${monitor.host}:${monitor.port}` : monitor.host || '—');
}

function updateTags(next: Tag[]) {
  tags.value = next;
}
</script>

<template>
  <PageHead
    kicker="Monitors"
    title="监控管理"
    note="每个监控每分钟发起一次检查，可按监控选择 Worker 或 Globalping。"
  >
    <template #action>
      <button class="button primary" type="button" @click="editing = null; modal = 'monitor'">＋ 新建监控</button>
    </template>
  </PageHead>

  <div class="filter-bar">
    <input class="filter-search" v-model="search" placeholder="搜索名称、地址或标签" />
    <select v-model="status">
      <option value="">全部状态</option>
      <option value="up">正常</option>
      <option value="degraded">部分异常</option>
      <option value="down">宕机</option>
      <option value="unknown">待探测</option>
      <option value="paused">已暂停</option>
    </select>
    <select v-model="tagId">
      <option value="">全部标签</option>
      <option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
    </select>
    <button class="button small ghost" type="button" @click="modal = 'tags'">管理标签</button>
  </div>

  <div class="panel table-wrap">
    <table v-if="filtered.length">
      <thead>
        <tr><th>监控 / 最近心跳</th><th>类型</th><th>状态</th><th>探测范围</th><th>最近检查</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="monitor in filtered" :key="monitor.id">
          <td>
            <div class="monitor-name">{{ monitor.name }}</div>
            <div class="target">{{ targetText(monitor) }}</div>
            <Tags :tags="monitor.tags" />
            <div class="heartbeat-cell">
              <HeartbeatBar :history="monitor.history" :time-display="props.settings.timeDisplay" />
            </div>
          </td>
          <td><span class="tag">{{ typeLabel(monitor.type) }}</span> <span class="tag">{{ providerLabel(monitor.provider) }}</span></td>
          <td><StatusBadge :status="monitor.enabled ? monitor.currentStatus : 'paused'" /></td>
          <td>{{ monitor.provider === 'globalping' ? `${monitor.globalpingLocations.length} 个位置` : '本地 Worker' }}</td>
          <td>{{ formatAdminDate(monitor.lastCheckedAt, props.settings.timeDisplay) }}</td>
          <td>
            <div class="actions">
              <button class="button small" type="button" @click="runAction(`/api/monitors/${monitor.id}/check-now`, { method: 'POST' }, '检查任务已提交')">立即检查</button>
              <button class="button small ghost" type="button" @click="editing = monitor; modal = 'monitor'">编辑</button>
              <button class="button small ghost" type="button" @click="runAction(`/api/monitors/${monitor.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !monitor.enabled }) }, monitor.enabled ? '监控已暂停' : '监控已启用')">{{ monitor.enabled ? '暂停' : '启用' }}</button>
              <button class="button small ghost" type="button" @click="window.confirm('清理这个监控的全部历史记录？') && runAction(`/api/monitors/${monitor.id}/history`, { method: 'DELETE' }, '历史记录已清理')">清理历史</button>
              <button class="button small ghost danger" type="button" @click="window.confirm('删除这个监控及其历史记录？') && runAction(`/api/monitors/${monitor.id}`, { method: 'DELETE' }, '监控已删除')">删除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <Empty v-else title="没有匹配的监控" note="调整搜索或筛选条件。" />
  </div>

  <MonitorForm
    v-if="modal === 'monitor'"
    :monitor="editing"
    :tags="tags"
    :max-nodes-per-monitor="props.settings.maxNodesPerMonitor"
    :notify="props.notify"
    @close="modal = null"
    @saved="modal = null; load()"
  />
  <TagManager
    v-if="modal === 'tags'"
    :tags="tags"
    :set-tags="updateTags"
    :notify="props.notify"
    @close="modal = null"
  />
</template>
