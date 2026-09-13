<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import PageHead from '../../components/PageHead.vue';
import type { AdminSettings, User } from '../../types';

const props = defineProps<{ settings: AdminSettings; user: User; notify: (m: string, e?: boolean) => void }>();
const emit = defineEmits<{ (e: 'settings-changed', settings: AdminSettings): void }>();

type Entry = { type: 'dashboard' | 'status'; slug?: string };

const entry = ref<Entry>({ type: 'dashboard' });
const pages = ref<Array<{ slug: string; title: string }>>([]);
const username = ref(props.user.username);
const adminTheme = ref<AdminSettings['theme']>(props.settings.theme);
const heartbeatPosition = ref<AdminSettings['heartbeatPosition']>(props.settings.heartbeatPosition);
const timeDisplay = ref<AdminSettings['timeDisplay']>(props.settings.timeDisplay);
const retention = ref(String(props.settings.historyRetentionDays));
const maxMonitors = ref(String(props.settings.maxMonitors));
const maxNodes = ref(String(props.settings.maxNodesPerMonitor));
const maxJobs = ref(String(props.settings.maxJobsPerTick));
const globalpingToken = ref('');
const tokenDirty = ref(false);

const currentPassword = ref('');

onMounted(() => {
  api<{ entry: Entry; pages: Array<{ slug: string; title: string }> }>('/api/settings/entry-page')
    .then((data) => { entry.value = data.entry; pages.value = data.pages || []; })
    .catch((reason) => props.notify(reason instanceof Error ? reason.message : '无法读取入口设置', true));
});

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

async function updateAdminSettings() {
  try {
    const data = await api<{ settings: AdminSettings }>('/api/settings/admin', {
      method: 'PATCH',
      body: JSON.stringify({ theme: adminTheme.value, heartbeatPosition: heartbeatPosition.value, timeDisplay: timeDisplay.value }),
    });
    emit('settings-changed', data.settings);
    props.notify('后台设置已更新');
  } catch (reason) {
    props.notify(errorMessage(reason, '保存失败'), true);
  }
}

async function updateSystemSettings() {
  const body: Record<string, unknown> = {
    historyRetentionDays: Number(retention.value),
    maxMonitors: Number(maxMonitors.value),
    maxNodesPerMonitor: Number(maxNodes.value),
    maxJobsPerTick: Number(maxJobs.value),
  };
  if (tokenDirty.value) body.globalpingToken = globalpingToken.value;
  try {
    const data = await api<{ settings: AdminSettings }>('/api/settings/admin', { method: 'PATCH', body: JSON.stringify(body) });
    emit('settings-changed', data.settings);
    globalpingToken.value = '';
    tokenDirty.value = false;
    props.notify('探测配额已更新');
  } catch (reason) {
    props.notify(errorMessage(reason, '保存失败'), true);
  }
}

async function updateUsername() {
  try {
    const result = await api<{ user: User }>('/api/auth/username', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, currentPassword: currentPassword.value }),
    });
    props.notify('用户名已更新');
    currentPassword.value = '';
    username.value = result.user.username;
  } catch (reason) {
    props.notify(errorMessage(reason, '更新失败'), true);
  }
}

async function updatePassword(form: HTMLFormElement) {
  const data = new FormData(form);
  try {
    await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: data.get('currentPassword'),
        newPassword: data.get('newPassword'),
        confirmPassword: data.get('confirmPassword'),
      }),
    });
    props.notify('密码已更新，请重新登录');
    window.setTimeout(() => { window.location.href = '/admin'; }, 700);
  } catch (reason) {
    props.notify(errorMessage(reason, '更新失败'), true);
  }
}

async function updateEntry(value: string) {
  const payload = value === 'dashboard' ? { type: 'dashboard' as const } : { type: 'status' as const, slug: value };
  try {
    const result = await api<{ entry: Entry }>('/api/settings/entry-page', { method: 'PATCH', body: JSON.stringify(payload) });
    entry.value = result.entry;
    props.notify('入口页面已更新');
  } catch (reason) {
    props.notify(errorMessage(reason, '更新失败'), true);
  }
}

async function clearAll() {
  if (!window.confirm('清理所有监控的历史记录？')) return;
  try {
    await api('/api/history', { method: 'DELETE' });
    props.notify('全部历史已清理');
  } catch (reason) {
    props.notify(errorMessage(reason, '清理失败'), true);
  }
}

</script>

<template>
  <PageHead kicker="Workspace" title="系统设置" note="管理入口页面、管理员密码和当前部署的探测配置。" />

  <div class="split">
    <section class="panel" style="padding: 20px">
      <div class="section-head"><h2 class="section-title">入口页面</h2></div>
      <div class="field">
        <label>首页跳转</label>
        <select :value="entry.type === 'status' && entry.slug ? entry.slug : 'dashboard'" @change="updateEntry(($event.target as HTMLSelectElement).value)">
          <option value="dashboard">仪表盘</option>
          <option v-for="page in pages" :key="page.slug" :value="page.slug">{{ page.title }}</option>
        </select>
      </div>
    </section>
    <section class="panel" style="padding: 20px">
      <div class="section-head"><h2 class="section-title">登录账号</h2></div>
      <form @submit.prevent="updateUsername">
        <div class="field"><label>用户名</label><input v-model="username" autocomplete="username" minlength="3" maxlength="64" required /></div>
        <div class="field" style="margin-top: 15px"><label>当前密码</label><input v-model="currentPassword" type="password" autocomplete="current-password" minlength="8" maxlength="128" required /></div>
        <div class="form-actions"><button class="button primary" type="submit">更新用户名</button></div>
      </form>
    </section>
  </div>

  <div class="section"><div class="split">
    <section class="panel" style="padding: 20px">
      <div class="section-head"><h2 class="section-title">后台外观</h2></div>
      <form @submit.prevent="updateAdminSettings">
        <div class="field">
          <label>主题</label>
          <select v-model="adminTheme">
            <option value="auto">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
        <div class="field" style="margin-top: 15px">
          <label>心跳栏位置</label>
          <select v-model="heartbeatPosition">
            <option value="top">监控信息上方</option>
            <option value="bottom">监控信息下方</option>
          </select>
        </div>
        <div class="field" style="margin-top: 15px">
          <label>时间显示</label>
          <select v-model="timeDisplay">
            <option value="relative">相对时间</option>
            <option value="absolute">具体时间</option>
          </select>
        </div>
        <div class="form-actions"><button class="button primary" type="submit">保存外观</button></div>
      </form>
    </section>
    <section class="panel" style="padding: 20px">
      <div class="section-head"><h2 class="section-title">系统配额</h2></div>
      <form @submit.prevent="updateSystemSettings">
        <div class="form-grid">
          <div class="field"><label>监控上限</label><input v-model="maxMonitors" type="number" min="1" max="1000" required /></div>
          <div class="field"><label>每个监控位置上限</label><input v-model="maxNodes" type="number" min="1" max="20" required /></div>
          <div class="field"><label>每轮调度任务上限</label><input v-model="maxJobs" type="number" min="1" max="100" required /></div>
          <div class="field"><label>历史保留天数</label><input v-model="retention" type="number" min="0" max="3650" required /></div>
          <div class="field full">
            <label>Globalping Token</label>
            <input v-model="globalpingToken" @input="tokenDirty = true" type="password" autocomplete="new-password" :placeholder="props.settings.globalpingTokenConfigured ? '已配置，留空表示不修改' : '未配置，可选'" />
            <p class="page-note">当前状态：{{ props.settings.globalpingTokenConfigured ? '已配置' : '未配置' }}。Token 保存在 D1 中。</p>
          </div>
        </div>
        <div class="form-actions">
          <button class="button primary" type="submit">保存配额</button>
          <button class="button ghost danger" type="button" @click="clearAll">立即清理历史</button>
        </div>
      </form>
    </section>
  </div></div>

  <div class="section"><section class="panel" style="padding: 20px">
    <div class="section-head"><h2 class="section-title">修改密码</h2></div>
    <form @submit.prevent="updatePassword($event.target as HTMLFormElement)">
      <div class="field"><label>当前密码</label><input name="currentPassword" type="password" autocomplete="current-password" minlength="8" maxlength="128" required /></div>
      <div class="field" style="margin-top: 15px"><label>新密码</label><input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></div>
      <div class="field" style="margin-top: 15px"><label>重复新密码</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></div>
      <div class="form-actions"><button class="button primary" type="submit">更新密码</button></div>
    </form>
  </section></div>

  <div class="section"><section class="panel">
    <div class="info-list">
      <div class="info-row"><span class="info-key">探测服务</span><span class="info-value">Worker + Globalping</span></div>
      <div class="info-row"><span class="info-key">调度频率</span><span class="info-value">每分钟运行一次，按监控频率筛选</span></div>
      <div class="info-row"><span class="info-key">状态判定</span><span class="info-value">多数探测失败才宕机</span></div>
      <div class="info-row"><span class="info-key">登录账号</span><span class="info-value">{{ props.user.username }}</span></div>
    </div>
  </section></div>
</template>
