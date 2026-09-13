<script setup lang="ts">
import { monitorTagStyle } from '../utils';
import type { Tag } from '../types';

defineProps<{ tags?: Tag[] }>();
</script>

<template>
  <div v-if="tags && tags.length" class="monitor-tags">
    <span v-for="tag in tags" :key="tag.id" class="tag tag-chip" :style="monitorTagStyle(tag)">{{ tag.name }}</span>
  </div>
</template>
