<script setup lang="ts">
import { computed } from 'vue';
import { safeMarkdown } from '../utils';

const props = withDefaults(defineProps<{ value?: string; className?: string }>(), { value: '', className: 'markdown-preview' });
const html = computed(() => (props.value ? safeMarkdown(props.value) : null));
</script>

<template>
  <div v-if="html" :class="className" v-html="html" />
</template>
