<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import Markdown from '../components/Markdown.vue';
import EmptyComponent from '../components/Empty.vue';
import PublicMonitorCard from '../components/PublicMonitorCard.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { formatDate } from '../utils';
import type { PublicGroup, PublicMonitor, PublicPage } from '../types';

const props = defineProps<{ slug: string | null }>();
const data = ref<{ page: PublicPage; groups?: PublicGroup[]; monitors: PublicMonitor[]; generatedAt: string } | null>(null);
const error = ref('');
let timer: number | undefined;
let active = true;

function applyPublicTheme(configured: string): void {
  const saved = localStorage.getItem('public-theme');
  const theme = saved === 'light' || saved === 'dark' ? saved : configured;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

async function load() {
  try {
    const endpoint = props.slug ? `/api/public/status/${encodeURIComponent(props.slug)}` : '/api/public/home';
    const result = await api<{ page: PublicPage; groups?: PublicGroup[]; monitors: PublicMonitor[]; generatedAt: string }>(endpoint);
    if (!active) return;
    data.value = result;
    applyPublicTheme(result.page.theme || 'auto');
    const seconds = Math.min(Math.max(Number(result.page.refreshSeconds) || 300, 30), 86400);
    timer = window.setTimeout(load, seconds * 1000);
  } catch (reason) {
    if (active) error.value = reason instanceof Error ? reason.message : '状态页不存在';
  }
}

onMounted(() => { load(); });
onUnmounted(() => { active = false; if (timer) window.clearTimeout(timer); });

function groups(): PublicGroup[] {
  if (!data.value) return [];
  return data.value.groups?.length ? data.value.groups : [{ name: '服务', monitors: data.value.monitors }];
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('public-theme', next);
  document.documentElement.dataset.theme = next;
}
</script>

<template>
  <main v-if="error" class="public-page"><div class="public-inner"><div class="notice warning">{{ error }}</div></div></main>
  <main v-else-if="!data" class="public-page"><div class="public-inner"><div class="empty">正在读取状态页...</div></div></main>
  <main v-else class="public-page">
    <div class="public-inner">
      <style>{{ data.page.customCss || '' }}</style>
      <header class="public-head">
        <div><h1 class="public-title">{{ data.page.title }}</h1><Markdown :value="data.page.description" /></div>
        <div class="public-head-actions">
          <div class="public-updated">更新于<br />{{ formatDate(data.generatedAt) }}</div>
          <a v-if="props.slug" class="public-rss-link" :href="`/status/${encodeURIComponent(props.slug)}/rss.xml`" target="_blank" rel="noreferrer">RSS</a>
          <ThemeToggle @change="toggleTheme" />
        </div>
      </header>
      <section v-for="group in groups()" :key="group.id || group.name" class="public-group">
        <h2 class="public-group-title">{{ group.name }}</h2>
        <div class="public-list">
          <template v-if="group.monitors.length">
            <PublicMonitorCard v-for="monitor in group.monitors" :key="monitor.id" :monitor="monitor" :show-tags="data.page.showTags !== 0" :last-heartbeat-only="data.page.lastHeartbeatOnly === 1" />
          </template>
          <Empty v-else title="暂无公开监控" note="管理员还没有把监控加入这个分组。" />
        </div>
      </section>
      <EmptyComponent v-if="!groups().length" title="暂无公开监控" note="管理员还没有把监控加入这个状态页。" />
      <Markdown :value="data.page.footer" class="markdown-preview public-footer" />
      <div v-if="data.page.showPoweredBy !== 0" class="public-powered">Powered by Pulseboard · <a href="/admin">管理员入口</a></div>
    </div>
  </main>
</template>
