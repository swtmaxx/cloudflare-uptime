<script setup lang="ts">
import { computed } from 'vue';
import { statusLabel } from '../utils';

const props = defineProps<{ status: string }>();
const label = computed(() => statusLabel(props.status));
</script>
<template>
  <span class="status" :class="status"><i class="status-dot" />{{ label }}</span>
</template>
