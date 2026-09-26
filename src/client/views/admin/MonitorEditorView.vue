<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import type { AdminSettings, Monitor, Tag } from '../../types';
import MonitorForm from './MonitorForm.vue';

const props = defineProps<{
  monitorId: string | null;
  settings: AdminSettings;
  notify: (message: string, error?: boolean) => void;
}>();
const emit = defineEmits<{ (event: 'navigate', path: string): void }>();
const monitor = ref<Monitor | null>(null);
const tags = ref<Tag[]>([]);
const loading = ref(true);

async function load() {
  try {
    const tagData = await api<{ tags: Tag[] }>('/api/tags');
    tags.value = tagData.tags || [];
    if (props.monitorId) {
      monitor.value = (await api<{ monitor: Monitor }>(`/api/monitors/${encodeURIComponent(props.monitorId)}`)).monitor;
    }
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取监控编辑数据', true);
  } finally {
    loading.value = false;
  }
}

function back() { emit('navigate', '/admin/monitors'); }
onMounted(() => { void load(); });
</script>

<template>
  <div v-if="loading" class="panel empty">读取编辑配置…</div>
  <MonitorForm
    v-else
    :monitor="monitor"
    :tags="tags"
    :max-nodes-per-monitor="props.settings.maxNodesPerMonitor"
    :notify="props.notify"
    :on-close="back"
    :on-saved="back"
  />
</template>
