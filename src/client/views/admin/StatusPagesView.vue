<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import EmptyComponent from '../../components/Empty.vue';
import PageHead from '../../components/PageHead.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import StatusEditor from './StatusEditor.vue';
import type { Monitor, StatusPage } from '../../types';

const props = withDefaults(defineProps<{ notify: (message: string, error?: boolean) => void; onEdit?: () => void }>(), { onEdit: undefined });

const pages = ref<StatusPage[]>([]);
const monitors = ref<Monitor[]>([]);
const editing = ref<StatusPage | null | undefined>(undefined);

async function load() {
  try {
    const [pageData, monitorData] = await Promise.all([
      api<{ pages: StatusPage[] }>('/api/status-pages'),
      api<{ monitors: Monitor[] }>('/api/monitors'),
    ]);
    pages.value = pageData.pages || [];
    monitors.value = monitorData.monitors || [];
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取状态页', true);
  }
}

async function toggle(page: StatusPage) {
  try {
    await api(`/api/status-pages/${page.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !page.enabled }) });
    props.notify(page.enabled ? '状态页已隐藏' : '状态页已发布');
    load();
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '更新失败', true);
  }
}

async function remove(page: StatusPage) {
  if (!window.confirm('删除这个公开状态页？')) return;
  try {
    await api(`/api/status-pages/${page.id}`, { method: 'DELETE' });
    props.notify('状态页已删除');
    load();
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '删除失败', true);
  }
}

function openEditor(page: StatusPage | null) {
  editing.value = page;
  if (props.onEdit) props.onEdit();
}

onMounted(load);
</script>

<template>
  <PageHead
    kicker="Public surface"
    title="公开状态页"
    note="把监控当前状态以简洁页面公开给团队或用户。"
  >
    <template #action>
      <button class="button primary" type="button" @click="openEditor(null)">＋ 新建状态页</button>
    </template>
  </PageHead>

  <div class="panel table-wrap">
    <table v-if="pages.length">
      <thead>
        <tr><th>名称</th><th>地址</th><th>分组 / 监控</th><th>状态</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="page in pages" :key="page.id">
          <td>
            <div class="monitor-name">{{ page.title }}</div>
            <div class="target">{{ page.description || '无描述' }}</div>
          </td>
          <td class="mono">/status/{{ page.slug }}</td>
          <td>{{ page.groups.length }} 组 · {{ page.monitorIds.length }} 个</td>
          <td><StatusBadge :status="page.enabled ? 'up' : 'paused'" /></td>
          <td>
            <div class="actions">
              <a class="button small" :href="`/status/${encodeURIComponent(page.slug)}`" target="_blank" rel="noreferrer">打开</a>
              <a class="button small ghost" :href="`/status/${encodeURIComponent(page.slug)}/rss.xml`" target="_blank" rel="noreferrer">RSS</a>
              <button class="button small ghost" type="button" @click="openEditor(page)">编辑</button>
              <button class="button small ghost" type="button" @click="toggle(page)">{{ page.enabled ? '隐藏' : '发布' }}</button>
              <button class="button small ghost danger" type="button" @click="remove(page)">删除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyComponent v-else title="还没有公开状态页" note="创建一个页面，把监控状态分享出去。" />
  </div>

  <StatusEditor
    v-if="editing !== undefined"
    :page="editing"
    :monitors="monitors"
    :notify="props.notify"
    @close="editing = undefined"
    @saved="() => { editing = undefined; load(); }"
    @deleted="() => { editing = undefined; load(); }"
  />
</template>
