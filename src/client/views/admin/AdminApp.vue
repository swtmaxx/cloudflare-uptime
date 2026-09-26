<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api';
import AuthView from '../AuthView.vue';
import DashboardView from './DashboardView.vue';
import MonitorsView from './MonitorsView.vue';
import HistoryView from './HistoryView.vue';
import StatusPagesView from './StatusPagesView.vue';
import SettingsView from './SettingsView.vue';
import AboutView from './AboutView.vue';
import MonitorDetailView from './MonitorDetailView.vue';
import MonitorEditorView from './MonitorEditorView.vue';
import type { AdminSettings, User } from '../../types';
import { emitRealtimeEvent, onRealtimeEvent, RealtimeClient, type RealtimeConnectionState } from '../../realtime';

type View = 'overview' | 'monitors' | 'history' | 'status-pages' | 'settings' | 'about' | 'monitor-detail' | 'monitor-add' | 'monitor-edit';
type NavView = Exclude<View, 'monitor-detail' | 'monitor-add' | 'monitor-edit'>;
const VIEW_PATHS: Record<NavView, string> = {
  overview: '/admin/dashboard', monitors: '/admin/monitors', history: '/admin/history',
  'status-pages': '/admin/status-pages', settings: '/admin/settings', about: '/admin/about',
};
function routeFromPath(p: string): { view: View; monitorId: string | null } {
  const detail = p.match(/^\/admin\/dashboard\/([^/]+)/);
  if (detail) return { view: 'monitor-detail', monitorId: decodeURIComponent(detail[1]) };
  const edit = p.match(/^\/admin\/edit\/([^/]+)/);
  if (edit) return { view: 'monitor-edit', monitorId: decodeURIComponent(edit[1]) };
  if (p.startsWith('/admin/add')) return { view: 'monitor-add', monitorId: null };
  if (p.startsWith('/admin/monitors')) return { view: 'monitors', monitorId: null };
  if (p.startsWith('/admin/history')) return { view: 'history', monitorId: null };
  if (p.startsWith('/admin/status-pages')) return { view: 'status-pages', monitorId: null };
  if (p.startsWith('/admin/settings')) return { view: 'settings', monitorId: null };
  if (p.startsWith('/admin/about')) return { view: 'about', monitorId: null };
  return { view: 'overview', monitorId: null };
}

const user = ref<User | null>(null);
const setupRequired = ref(false);
const loading = ref(true);
const initialRoute = routeFromPath(window.location.pathname);
const view = ref<View>(initialRoute.view);
const monitorId = ref<string | null>(initialRoute.monitorId);
const settings = ref<AdminSettings | null>(null);
const realtimeState = ref<RealtimeConnectionState>('disconnected');
const toast = ref({ message: '', error: false });
let toastTimer: number | undefined;
let realtimeClient: RealtimeClient | null = null;
let fallbackTimer: number | undefined;
let removeRealtimeListener: (() => void) | undefined;

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
    if (data.user) {
      await loadSettings();
      startRealtime();
    }
  } catch (reason) {
    notify(reason instanceof Error ? reason.message : '无法连接数据库', true);
  } finally { loading.value = false; }
}

function startRealtime() {
  realtimeClient?.close();
  realtimeClient = new RealtimeClient((state) => { realtimeState.value = state; });
  realtimeClient.connect();
  if (fallbackTimer) window.clearInterval(fallbackTimer);
  fallbackTimer = window.setInterval(() => {
    if (realtimeState.value !== 'connected') emitRealtimeEvent({ version: 1, type: 'invalidate', scope: 'dashboard', at: new Date().toISOString() });
  }, 60_000);
}

function authenticated(userValue: User) {
  user.value = userValue;
  void loadSettings();
  startRealtime();
}

async function loadSettings() {
  try {
    settings.value = (await api<{ settings: AdminSettings }>('/api/settings/admin')).settings;
  } catch (reason) {
    notify(reason instanceof Error ? reason.message : '无法读取设置', true);
  }
}

function navigate(next: NavView) {
  const p = VIEW_PATHS[next];
  if (window.location.pathname !== p) window.history.pushState({}, '', p);
  view.value = next;
  monitorId.value = null;
}
function navigatePath(path: string) {
  window.history.pushState({}, '', path);
  const next = routeFromPath(path);
  view.value = next.view;
  monitorId.value = next.monitorId;
}
function logout() {
  realtimeClient?.close();
  api('/api/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/admin'; });
}
function refresh() { window.location.reload(); }

onMounted(() => {
  loadStatus();
  window.addEventListener('popstate', () => {
    const next = routeFromPath(window.location.pathname);
    view.value = next.view;
    monitorId.value = next.monitorId;
  });
  removeRealtimeListener = onRealtimeEvent((event) => {
    if (event.scope === 'settings') void loadSettings();
  });
});

onBeforeUnmount(() => {
  realtimeClient?.close();
  if (fallbackTimer) window.clearInterval(fallbackTimer);
  removeRealtimeListener?.();
});
</script>

<template>
  <main v-if="loading" class="auth-page"><section class="auth-box"><div class="empty">正在读取配置...</div></section></main>
  <AuthView v-else-if="setupRequired || !user" :setup="setupRequired" @authenticated="authenticated" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">P</div><div class="brand-copy"><div class="brand-name">Pulseboard</div><div class="brand-sub">uptime control room</div></div></div>
      <div class="nav-label">Workspace</div>
      <nav class="nav">
        <button v-for="(path, id) in VIEW_PATHS" :key="id" class="nav-button" :class="{ active: view === id }" type="button" @click="navigate(id as View)">{{ { overview: '◉ 总览', monitors: '◌ 监控管理', history: '▤ 检查记录', 'status-pages': '□ 公开状态页', settings: '⚙ 系统设置', about: 'ⓘ 关于' }[id] }}</button>
      </nav>
      <div class="sidebar-foot">
        <div class="user-line"><span>{{ user.username }}</span><button class="button text-button" type="button" @click="logout">退出</button></div>
        <div>Worker + Globalping</div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span class="topbar-title">单 Worker · D1 · 可用性监控</span>
        <div class="topbar-actions"><span class="connection-state" :class="realtimeState"><i class="status-dot" />{{ realtimeState === 'connected' ? '实时连接' : realtimeState === 'connecting' ? '连接中' : '离线兜底' }}</span><span class="muted">每分钟调度</span><button class="button small ghost" type="button" @click="refresh">刷新</button></div>
      </header>
      <div class="content">
        <DashboardView v-if="view === 'overview' && settings" :settings="settings" :notify="notify" />
        <MonitorsView v-else-if="view === 'monitors' && settings" :settings="settings" :notify="notify" />
        <HistoryView v-else-if="view === 'history'" :notify="notify" />
        <StatusPagesView v-else-if="view === 'status-pages'" :notify="notify" />
        <MonitorDetailView v-else-if="view === 'monitor-detail' && settings && monitorId" :monitor-id="monitorId" :settings="settings" :notify="notify" @navigate="navigatePath" />
        <MonitorEditorView v-else-if="(view === 'monitor-add' || view === 'monitor-edit') && settings" :monitor-id="monitorId" :settings="settings" :notify="notify" @navigate="navigatePath" />
        <SettingsView v-else-if="view === 'settings' && settings" :settings="settings" :user="user" @settings-changed="(s) => (settings = s)" :notify="notify" />
        <AboutView v-else-if="view === 'about' && settings" :settings="settings" :user="user" />
      </div>
    </main>
    <div v-if="toast.message" :class="`toast${toast.error ? ' error' : ''}`">{{ toast.message }}</div>
  </div>
</template>
