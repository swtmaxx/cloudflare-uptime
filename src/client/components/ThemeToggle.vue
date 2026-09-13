<script setup lang="ts">
import { onMounted, ref } from 'vue';

const emit = defineEmits<{ (e: 'change'): void }>();
const dark = ref(false);

function compute(): boolean {
  return document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
onMounted(() => { dark.value = compute(); });
const label = () => (dark.value ? '切换到浅色' : '切换到深色');
function toggle() {
  dark.value = !dark.value;
  emit('change');
}
</script>

<template>
  <button class="public-theme-toggle" type="button" :title="label()" :aria-label="label()" @click="toggle">{{ dark ? '☼' : '◐' }}</button>
</template>
