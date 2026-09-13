<script setup lang="ts">
import { computed } from 'vue';
import { availabilityClass, formatDateOnly, paddedHeartbeats, statusLabel } from '../utils';
import Tags from './Tags.vue';
import type { PublicMonitor } from '../types';

const props = withDefaults(defineProps<{ monitor: PublicMonitor; showTags?: boolean; lastHeartbeatOnly?: boolean }>(), { showTags: true, lastHeartbeatOnly: false });

const status = computed(() => (props.monitor.enabled ? props.monitor.status : 'paused'));
const availability = computed(() => (props.monitor.availability === null || props.monitor.availability === undefined ? '暂无数据' : `总可用率: ${Number(props.monitor.availability).toFixed(2)}%`));
const icon = computed(() => (status.value === 'down' ? '!' : status.value === 'unknown' || status.value === 'paused' ? '?' : '✓'));
const cells = computed(() => paddedHeartbeats(props.monitor.history || [], props.lastHeartbeatOnly).map((item, index) => {
  const availabilityText = item?.availability === null || item?.availability === undefined ? null : Number(item.availability).toFixed(1);
  const title = item ? `${availabilityText === null ? statusLabel(item.status) : `${availabilityText}%`} 于 ${formatDateOnly(item.checkedAt)}` : '尚未检查';
  return { key: `${item?.id || 'empty'}-${index}`, className: item?.status || 'unknown', title };
}));
</script>

<template>
  <article class="public-monitor">
    <div class="public-monitor-head">
      <div class="public-monitor-name">
        <span :class="`public-state-icon ${status === 'paused' ? 'unknown' : status}`">{{ icon }}</span>
        <span>{{ monitor.name }}</span>
      </div>
      <div :class="`public-availability ${availabilityClass(monitor.availability)}`">{{ availability }}</div>
    </div>
    <Tags v-if="showTags" :tags="monitor.tags" />
    <div class="public-history" :aria-label="lastHeartbeatOnly ? '最后一次检查记录' : '最近 90 次检查记录'">
      <span v-for="cell in cells" :key="cell.key" :class="`public-history-cell ${cell.className}`" :title="cell.title" />
    </div>
  </article>
</template>
