<script setup lang="ts">
defineProps<{ kicker: string; title: string; note?: string }>();
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-kicker">{{ kicker }}</div>
      <h1>{{ title }}</h1>
      <p v-if="note" class="page-note">{{ note }}</p>
    </div>
    <div v-if="$slots.action"><slot name="action" /></div>
  </div>
</template>
