<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import * as QRCode from 'qrcode';
import { api } from '../../api';
import Modal from '../../components/Modal.vue';
import type { NotificationChannel, QQGatewayStatus, QQNotificationUser } from '../../types';

type NotificationType = 'pushplus' | 'qqbot';

const props = defineProps<{
  channel: NotificationChannel | null;
  notify: (m: string, e?: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const type = ref<NotificationType>(props.channel?.type || 'pushplus');
const name = ref(props.channel?.name || 'PushPlus 通知');
const token = ref('');
const appId = ref(props.channel?.appId || '');
const appSecret = ref('');
const showToken = ref(false);
const showAppSecret = ref(false);
const defaultEnabled = ref(props.channel?.defaultEnabled === 1);
const applyToExisting = ref(false);
const users = ref<QQNotificationUser[]>([]);
const openid = ref('');
const testOpenid = ref('');
const userNickname = ref('');
const link = ref('');
const qrData = ref('');
const gatewayStatus = ref<QQGatewayStatus | null>(null);
const gatewayBusy = ref(false);
const busy = ref(false);
const userBusy = ref(false);

let pollTimer: number | undefined;

function channelLabel(t: NotificationType): string {
  return t === 'qqbot' ? 'QQ 官方机器人' : 'PushPlus（推送加）';
}
function channelKicker(t: NotificationType): string {
  return t === 'qqbot' ? 'QQ bot notification' : 'PushPlus notification';
}

function resetState() {
  type.value = props.channel?.type || 'pushplus';
  name.value = props.channel?.name || 'PushPlus 通知';
  token.value = '';
  appId.value = props.channel?.appId || '';
  appSecret.value = '';
  defaultEnabled.value = props.channel?.defaultEnabled === 1;
  applyToExisting.value = false;
  link.value = '';
  qrData.value = '';
  openid.value = '';
  testOpenid.value = '';
  userNickname.value = '';
  users.value = [];
  gatewayStatus.value = null;
  gatewayBusy.value = false;
}

async function loadUsers() {
  if (!props.channel || props.channel.type !== 'qqbot') return;
  try {
    const data = await api<{ users: QQNotificationUser[] }>(`/api/notifications/${props.channel.id}/qq/users`);
    users.value = data.users || [];
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取 QQ 用户', true);
  }
}

async function loadGatewayStatus() {
  if (!props.channel || props.channel.type !== 'qqbot') return;
  try {
    const data = await api<QQGatewayStatus>(`/api/notifications/${props.channel.id}/qq/gateway/status`);
    gatewayStatus.value = data;
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取 QQ WebSocket 状态', true);
  }
}

function setupGatewayPoll() {
  teardownGatewayPoll();
  if (!props.channel || props.channel.type !== 'qqbot') return;
  void loadGatewayStatus();
  pollTimer = window.setInterval(() => { void loadGatewayStatus(); }, 5000);
}
function teardownGatewayPoll() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = undefined;
}
onBeforeUnmount(teardownGatewayPoll);

watch(() => [props.channel?.id, props.channel?.type] as const, () => {
  resetState();
  void loadUsers();
  setupGatewayPoll();
}, { immediate: true });

async function gatewayAction(action: 'start' | 'stop') {
  if (!props.channel || props.channel.type !== 'qqbot') return;
  gatewayBusy.value = true;
  try {
    const data = await api<QQGatewayStatus>(`/api/notifications/${props.channel.id}/qq/gateway/${action}`, { method: 'POST' });
    gatewayStatus.value = data;
    props.notify(action === 'start' ? 'QQ WebSocket 已启动，正在连接 Gateway' : 'QQ WebSocket 已停止');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : 'QQ WebSocket 操作失败', true);
  } finally {
    gatewayBusy.value = false;
  }
}

function selectType(next: NotificationType) {
  type.value = next;
  name.value = next === 'qqbot' ? 'QQ 机器人通知' : 'PushPlus 通知';
}

async function submit() {
  busy.value = true;
  try {
    const payload: Record<string, unknown> = {
      type: type.value,
      name: name.value,
      defaultEnabled: defaultEnabled.value,
      applyToExisting: applyToExisting.value,
    };
    if (type.value === 'pushplus') {
      payload.token = token.value;
    } else {
      payload.appId = appId.value;
      if (appSecret.value.trim()) payload.appSecret = appSecret.value;
    }
    await api(props.channel ? `/api/notifications/${props.channel.id}` : '/api/notifications', {
      method: props.channel ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    props.notify(`${channelLabel(type.value)}${props.channel ? '已更新' : '已创建'}`);
    emit('saved');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '保存通知失败', true);
    busy.value = false;
  }
}

async function test() {
  if (!props.channel && type.value === 'pushplus' && !token.value.trim()) {
    props.notify('请输入 PushPlus Token', true);
    return;
  }
  if (!props.channel && type.value === 'qqbot' && !testOpenid.value.trim()) {
    props.notify('未保存 QQ 配置时，请填写测试 OpenID', true);
    return;
  }
  busy.value = true;
  try {
    const payload: Record<string, unknown> = {
      type: type.value,
      ...(props.channel ? { channelId: props.channel.id } : {}),
      ...(name.value.trim() ? { name: name.value } : {}),
    };
    if (type.value === 'pushplus') {
      if (token.value.trim()) payload.token = token.value;
    } else {
      if (appId.value.trim()) payload.appId = appId.value;
      if (appSecret.value.trim()) payload.appSecret = appSecret.value;
      if (testOpenid.value.trim()) payload.openid = testOpenid.value;
    }
    await api('/api/notifications/test', { method: 'POST', body: JSON.stringify(payload) });
    props.notify('测试通知已发送');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '测试通知失败', true);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!props.channel || !window.confirm(`删除这个${channelLabel(props.channel.type)}？已绑定的监控会同时解除绑定。`)) return;
  busy.value = true;
  try {
    await api(`/api/notifications/${props.channel.id}`, { method: 'DELETE' });
    props.notify('通知已删除');
    emit('saved');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '删除通知失败', true);
    busy.value = false;
  }
}

async function addUser() {
  if (!props.channel || props.channel.type !== 'qqbot') return;
  userBusy.value = true;
  try {
    await api(`/api/notifications/${props.channel.id}/qq/users`, {
      method: 'POST',
      body: JSON.stringify({ openid: openid.value, nickname: userNickname.value }),
    });
    openid.value = '';
    userNickname.value = '';
    await loadUsers();
    props.notify('QQ 用户已添加');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '添加 QQ 用户失败', true);
  } finally {
    userBusy.value = false;
  }
}

async function toggleUser(user: QQNotificationUser) {
  if (!props.channel || props.channel.type !== 'qqbot') return;
  userBusy.value = true;
  try {
    await api(`/api/notifications/${props.channel.id}/qq/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: user.enabled !== 1 }),
    });
    await loadUsers();
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '更新 QQ 用户失败', true);
  } finally {
    userBusy.value = false;
  }
}

async function deleteUser(user: QQNotificationUser) {
  if (!props.channel || props.channel.type !== 'qqbot' || !window.confirm('删除这个 QQ 用户？')) return;
  userBusy.value = true;
  try {
    await api(`/api/notifications/${props.channel.id}/qq/users/${user.id}`, { method: 'DELETE' });
    await loadUsers();
    props.notify('QQ 用户已删除');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '删除 QQ 用户失败', true);
  } finally {
    userBusy.value = false;
  }
}

async function createLink() {
  if (!props.channel || props.channel.type !== 'qqbot') return;
  busy.value = true;
  try {
    const data = await api<{ url: string }>(`/api/notifications/${props.channel.id}/qq/link`, { method: 'POST' });
    link.value = data.url;
    qrData.value = await QRCode.toDataURL(data.url, { width: 240, margin: 1 });
    props.notify('QQ 添加二维码已生成');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '生成 QQ 添加链接失败', true);
  } finally {
    busy.value = false;
  }
}

async function copyLink() {
  if (!link.value) return;
  try {
    await navigator.clipboard.writeText(link.value);
    props.notify('添加链接已复制');
  } catch {
    props.notify('复制失败，请手动复制链接', true);
  }
}

const gatewayStatusLabel: Record<QQGatewayStatus['status'], string> = {
  stopped: '已停止',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  error: '连接错误',
};

function gatewayRunning(): boolean {
  return gatewayStatus.value?.status === 'connected' || gatewayStatus.value?.status === 'connecting' || gatewayStatus.value?.status === 'reconnecting';
}
function gatewayStopped(): boolean {
  return gatewayStatus.value?.status === 'stopped';
}
</script>

<template>
  <Modal :class="type === 'qqbot' ? 'notification-modal qq-notification-modal' : 'notification-modal'" @close="emit('close')">
    <div class="modal-head">
      <div>
        <div class="page-kicker">{{ channelKicker(type) }}</div>
        <h2>{{ channel ? '编辑通知' : '设置通知' }}</h2>
      </div>
    </div>
    <form @submit.prevent="submit">
      <div class="form-grid">
        <div class="field full">
          <label>通知类型</label>
          <select :value="type" :disabled="Boolean(channel)" @change="selectType(($event.target as HTMLSelectElement).value as NotificationType)">
            <option value="pushplus">PushPlus（推送加）</option>
            <option value="qqbot">QQ 官方机器人</option>
          </select>
        </div>
        <div class="field full">
          <label>显示名称</label>
          <input v-model="name" maxlength="80" required />
        </div>
        <template v-if="type === 'pushplus'">
          <div class="field full">
            <label>发送密钥</label>
            <div class="secret-input">
              <input v-model="token" :type="showToken ? 'text' : 'password'" :placeholder="channel?.tokenConfigured ? '已保存，留空保持不变' : '输入 PushPlus Token'" maxlength="512" :required="!channel" />
              <button class="secret-toggle" type="button" :title="showToken ? '隐藏发送密钥' : '显示发送密钥'" :aria-label="showToken ? '隐藏发送密钥' : '显示发送密钥'" @click="showToken = !showToken">{{ showToken ? '隐藏' : '显示' }}</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="field full">
            <label>QQ AppID</label>
            <input v-model="appId" maxlength="128" placeholder="开放平台中的 AppID" required />
          </div>
          <div class="field full">
            <label>QQ AppSecret</label>
            <div class="secret-input">
              <input v-model="appSecret" :type="showAppSecret ? 'text' : 'password'" :placeholder="channel?.appSecretConfigured ? '已保存，留空保持不变' : '输入开放平台中的 AppSecret'" maxlength="512" :required="!channel" />
              <button class="secret-toggle" type="button" :title="showAppSecret ? '隐藏 AppSecret' : '显示 AppSecret'" :aria-label="showAppSecret ? '隐藏 AppSecret' : '显示 AppSecret'" @click="showAppSecret = !showAppSecret">{{ showAppSecret ? '隐藏' : '显示' }}</button>
            </div>
          </div>
        </template>
      </div>
      <p class="field-note">
        <template v-if="type === 'pushplus'">测试不会保存当前输入；编辑已有渠道时留空 Token 将使用已保存密钥。更多信息：<a href="https://www.pushplus.plus/" target="_blank" rel="noreferrer">https://www.pushplus.plus/</a></template>
        <template v-else>QQ 使用官方机器人 Open Platform，只发送私聊纯文本。AppSecret 用于获取 Access Token；控制台中的 Token 不需要填写。</template>
      </p>

      <div v-if="type === 'qqbot'" class="qq-management">
        <div class="qq-link-panel">
          <div class="section-head">
            <div><h3 class="section-title">扫码添加用户</h3><p class="field-note">先保存 QQ 配置，再生成官方添加链接。用户扫码后仍需在 QQ 中确认。</p></div>
            <button class="button small ghost" type="button" :disabled="!channel || busy" @click="createLink">生成二维码</button>
          </div>
          <div v-if="qrData" class="qq-qr-result">
            <img class="qq-qr" :src="qrData" alt="QQ 机器人添加二维码" />
            <div class="qq-link-copy">
              <textarea :value="link" readonly rows="3" />
              <button class="button small" type="button" @click="copyLink">复制添加链接</button>
            </div>
          </div>
          <div v-else class="notice">保存后可以在这里生成 QQ 官方添加二维码。</div>
        </div>

        <div v-if="channel" class="qq-link-panel">
          <div class="section-head">
            <div>
              <h3 class="section-title">WebSocket 连接</h3>
              <p class="field-note">Worker 会在后台连接 QQ Gateway。启动后无需配置公网回调地址，收到私聊或好友事件时会自动登记 OpenID。</p>
            </div>
            <div class="gateway-actions">
              <button class="button small ghost" type="button" :disabled="busy || gatewayBusy || gatewayRunning()" @click="gatewayAction('start')">启动</button>
              <button class="button small ghost danger" type="button" :disabled="busy || gatewayBusy || gatewayStopped()" @click="gatewayAction('stop')">停止</button>
            </div>
          </div>
          <div :class="`gateway-status ${gatewayStatus?.status || 'stopped'}`">
            <span class="status-dot" />
            <strong>{{ gatewayStatus ? gatewayStatusLabel[gatewayStatus.status] : '读取状态中' }}</strong>
            <span v-if="gatewayStatus?.lastConnectedAt">最近连接 {{ new Date(gatewayStatus.lastConnectedAt).toLocaleString() }}</span>
            <span v-if="gatewayStatus?.lastEventAt">最近事件 {{ new Date(gatewayStatus.lastEventAt).toLocaleString() }}</span>
          </div>
          <div v-if="gatewayStatus?.lastError" class="notice warning">{{ gatewayStatus.lastError }}</div>
        </div>

        <div v-if="channel" class="qq-link-panel">
          <div class="section-head">
            <div>
              <h3 class="section-title">QQ 用户</h3>
              <p class="field-note">WebSocket 收到 FRIEND_ADD 或 C2C_MESSAGE_CREATE 后会自动加入；也可以手动填写 OpenID。</p>
            </div>
          </div>
          <div class="qq-user-add">
            <input v-model="openid" placeholder="QQ OpenID" maxlength="128" required />
            <input v-model="userNickname" placeholder="备注（可选）" maxlength="80" />
            <button class="button small" type="button" :disabled="userBusy" @click="addUser">添加</button>
          </div>
          <div class="qq-user-list">
            <div v-for="user in users" :key="user.id" class="qq-user-row">
              <div class="qq-user-main">
                <strong>{{ user.nickname || '未命名用户' }}</strong>
                <span>{{ user.openid }}</span>
              </div>
              <div class="qq-user-actions">
                <span class="muted">{{ user.source === 'websocket' ? 'WebSocket' : '手动' }} · {{ user.enabled ? '启用' : '停用' }}</span>
                <button class="button small ghost" type="button" :disabled="userBusy" @click="toggleUser(user)">{{ user.enabled ? '停用' : '启用' }}</button>
                <button class="button small ghost danger" type="button" :disabled="userBusy" @click="deleteUser(user)">删除</button>
              </div>
            </div>
            <div v-if="!users.length" class="empty">还没有 QQ 用户</div>
          </div>
        </div>

        <div class="field full">
          <label>测试 OpenID（可选）</label>
          <input v-model="testOpenid" maxlength="128" :placeholder="channel ? '留空则发送给所有启用用户' : '未保存配置时必填'" />
        </div>
      </div>

      <div class="notification-options">
        <label class="toggle-option">
          <input v-model="defaultEnabled" type="checkbox" />
          <span>默认开启</span>
        </label>
        <p>新的监控将默认启用此通知，仍然可以在每个监控中单独关闭。</p>
        <label class="toggle-option">
          <input v-model="applyToExisting" type="checkbox" />
          <span>应用到所有现有监控</span>
        </label>
        <p>保存时将此通知绑定到所有现有监控，并按默认开启状态设置。</p>
      </div>

      <div class="form-actions notification-actions">
        <button class="button ghost danger" type="button" :disabled="!channel || busy" @click="remove">删除</button>
        <span class="form-action-right">
          <button class="button ghost" type="button" :disabled="busy" @click="test">测试</button>
          <button class="button primary" type="submit" :disabled="busy">{{ channel ? '保存' : '创建' }}</button>
        </span>
      </div>
    </form>
  </Modal>
</template>
