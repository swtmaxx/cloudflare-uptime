<script setup lang="ts">
import { paddedHeartbeats, statusLabel, formatAdminDate } from '../utils';
import type { Heartbeat } from '../types';

const props = withDefaults(defineProps<{ history?: Heartbeat[]; onlyLast?: boolean; timeDisplay?: 'relative' | 'absolute' }>(), { history: () => [], onlyLast: false, timeDisplay: 'relative' });
</script>

<template>
  <div>
    <div class="heartbeat-bar" :aria-label="onlyLast ? '最后一次检查记录' : '最近 90 次心跳'">
      <span
        v-for="(item, index) in paddedHeartbeats(props.history, props.onlyLast)"
        :key="`${item?.id || 'empty'}-${index}`"
        :class="item?.status || 'unknown'"
        :title="item ? `${statusLabel(item.status)} · ${formatAdminDate(item.checkedAt, props.timeDisplay)}` : '尚未检查'"
      />
    </div>
    <div class="heartbeat-caption">{{ props.history.length ? `最近 ${props.history.length} 次 · ${formatAdminDate(props.history[props.history.length - 1].checkedAt, props.timeDisplay)}` : '尚未产生心跳' }}</div>
  </div>
</template>
