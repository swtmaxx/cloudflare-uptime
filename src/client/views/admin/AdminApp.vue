<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../../api';
import AuthView from '../AuthView.vue';
import DashboardView from './DashboardView.vue';
import MonitorsView from './MonitorsView.vue';
import HistoryView from './HistoryView.vue';
import GlobalpingView from './GlobalpingView.vue';
import NotificationsView from './NotificationsView.vue';
import StatusPagesView from './StatusPagesView.vue';
import SettingsView from './SettingsView.vue';
import AboutView from './AboutView.vue';
import type { AdminSettings, User } from '../../types';

type View = 'overview' | 'monitors' | 'history' | 'globalping' | 'notifications' | 'status-pages' | 'settings' | 'about';
const VIEW_PATHS: Record<View, string> = {
  overview: '/admin', monitors: '/admin/monitors', history: '/admin/history', globalping: '/admin/globalping',
  notifications: '/admin/notifications', 'status-pages': '/admin/status-pages', settings: '/admin/settings', about: '/admin/about',
};
function viewFromPath(p: string): View {
  const slug = p.match(/^\/admin(?:\/([^/]+))?\/?$/)?.[1];
  if (!slug) return 'overview';
  return (Object.keys(VIEW_PATHS) as View[]).find((k) => VIEW_PATHS[k] === `/admin/${slug}`) || 'overview';
}

const user = ref<User | null>(null);
const setupRequired = ref(false);
const loading = ref(true);
const view = ref<View>(viewFromPath(window.location.pathname));
const settings = ref<AdminSettings | null>(null);
const toast = ref({ message: '', error: false });
let toastTimer: number | undefined;

function notify(message: string, error = false) {
  toast.value = { message, error };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = { message: '', error: false }; }, 3600);
}

async function loadStatus() {
  try {
    const data = await api<{ setupRequired: boolean; authenticated: boolean; user: User | null }>('/api/auth/status');
    setupRequired.value = data.setupRequired;
    user.value = data.user;
  } catch (reason) {
    notify(reason instanceof Error ? reason.message : '无法连接数据库', true);
  } finally { loading.value = false; }
}

async function loadSettings() {
  try {
    settings.value = (await api<{ settings: AdminSettings }>('/api/settings/admin')).settings;
  } catch (reason) {
    notify(reason instanceof Error ? reason.message : '无法读取设置', true);
  }
}

function navigate(next: View) {
  const p = VIEW_PATHS[next];
  if (window.location.pathname !== p) window.history.pushState({}, '', p);
  view.value = next;
}
function logout() {
  api('/api/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/admin'; });
}
function refresh() { window.location.reload(); }

onMounted(() => {
  loadStatus();
  window.addEventListener('popstate', () => { view.value = viewFromPath(window.location.pathname); });
});
</script>

<template>
  <main v-if="loading" class="auth-page"><section class="auth-box"><div class="empty">正在读取配置...</div></section></main>
  <AuthView v-else-if="setupRequired || !user" :setup="setupRequired" @authenticated="(u) => { user = u; loadSettings(); }" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">P</div><div class="brand-copy"><div class="brand-name">Pulseboard</div><div class="brand-sub">uptime control room</div></div></div>
      <div class="nav-label">Workspace</div>
      <nav class="nav">
        <button v-for="(path, id) in VIEW_PATHS" :key="id" class="nav-button" :class="{ active: view === id }" type="button" @click="navigate(id as View)">{{ { overview: '◉ 总览', monitors: '◌ 监控管理', history: '▤ 检查记录', globalping: '⌁ Globalping 节点', notifications: '✦ 通知设置', 'status-pages': '□ 公开状态页', settings: '⚙ 系统设置', about: 'ⓘ 关于' }[id] }}</button>
      </nav>
      <div class="sidebar-foot">
        <div class="user-line"><span>{{ user.username }}</span><button class="button text-button" type="button" @click="logout">退出</button></div>
        <div>Worker + Globalping</div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span class="topbar-title">单 Worker · D1 · 可用性监控</span>
        <div class="topbar-actions"><span class="muted">每分钟调度</span><button class="button small ghost" type="button" @click="refresh">刷新</button></div>
      </header>
      <div class="content">
        <DashboardView v-if="view === 'overview' && settings" :settings="settings" :notify="notify" />
        <MonitorsView v-else-if="view === 'monitors' && settings" :settings="settings" :notify="notify" />
        <HistoryView v-else-if="view === 'history'" :notify="notify" />
        <GlobalpingView v-else-if="view === 'globalping'" :notify="notify" />
        <NotificationsView v-else-if="view === 'notifications'" :notify="notify" />
        <StatusPagesView v-else-if="view === 'status-pages'" :notify="notify" />
        <SettingsView v-else-if="view === 'settings' && settings" :settings="settings" :user="user" @settings-changed="(s) => (settings = s)" :notify="notify" />
        <AboutView v-else-if="view === 'about' && settings" :settings="settings" :user="user" />
      </div>
    </main>
    <div v-if="toast.message" :class="`toast${toast.error ? ' error' : ''}`">{{ toast.message }}</div>
  </div>
</template>
