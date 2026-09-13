<script setup lang="ts">
import { computed } from 'vue';
import PublicView from './views/PublicView.vue';
import AdminApp from './views/admin/AdminApp.vue';

const publicMatch = window.location.pathname.match(/^\/status\/([^/]+)$/);
const isPublic = computed(() => Boolean(publicMatch) || window.location.pathname === '/');
const slug = publicMatch ? decodeURIComponent(publicMatch[1]) : null;
</script>

<template>
  <PublicView v-if="isPublic" :slug="slug" />
  <AdminApp v-else />
</template>
