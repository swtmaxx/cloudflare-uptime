<script setup lang="ts">
defineProps<{ title: string; note: string }>();
</script>

<template>
  <div class="empty"><strong>{{ title }}</strong><span>{{ note }}</span></div>
</template>
