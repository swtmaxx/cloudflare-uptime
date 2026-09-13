<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api';
import PageHead from '../../components/PageHead.vue';
import Empty from '../../components/Empty.vue';
import type { NotificationChannel } from '../../types';
import NotificationEditor from './NotificationEditor.vue';

const props = defineProps<{ notify: (m: string, e?: boolean) => void }>();

const channels = ref<NotificationChannel[]>([]);
const editing = ref<NotificationChannel | null>(null);
const editorOpen = ref(false);
const busyId = ref('');

function channelLabel(type: NotificationChannel['type']): string {
  return type === 'qqbot' ? 'QQ 官方机器人' : 'PushPlus（推送加）';
}

function channelSummary(channel: NotificationChannel): string {
  if (channel.type === 'qqbot') {
    return `${channelLabel(channel.type)} · AppID ${channel.appId || '未配置'} · ${channel.userCount} 个启用用户`;
  }
  return `${channelLabel(channel.type)} · 发送密钥已保存`;
}

async function load() {
  try {
    const data = await api<{ channels: NotificationChannel[] }>('/api/notifications');
    channels.value = data.channels || [];
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取通知配置', true);
  }
}

onMounted(load);

function openCreate() {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(channel: NotificationChannel) {
  editing.value = channel;
  editorOpen.value = true;
}

async function test(channel: NotificationChannel) {
  busyId.value = channel.id;
  try {
    await api(`/api/notifications/${channel.id}/test`, { method: 'POST' });
    props.notify('测试通知已发送');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '测试通知失败', true);
  } finally {
    busyId.value = '';
  }
}

function onSaved() {
  editorOpen.value = false;
  void load();
}
</script>

<template>
  <PageHead
    kicker="Notifications"
    title="通知设置"
    note="配置 PushPlus 或 QQ 官方机器人，并在每个监控中选择需要接收通知的渠道。"
  >
    <template #action>
      <button class="button primary" type="button" @click="openCreate">＋ 设置通知</button>
    </template>
  </PageHead>

  <div v-if="channels.length" class="panel notification-list">
    <div v-for="channel in channels" :key="channel.id" class="notification-row">
      <div>
        <div class="monitor-name">{{ channel.name }}</div>
        <div class="target">{{ channelSummary(channel) }} · {{ channel.defaultEnabled ? '新监控默认开启' : '新监控默认关闭' }}</div>
      </div>
      <div class="actions">
        <button class="button small ghost" type="button" :disabled="busyId === channel.id" @click="test(channel)">测试</button>
        <button class="button small" type="button" @click="openEdit(channel)">编辑</button>
      </div>
    </div>
  </div>
  <Empty
    v-else
    title="还没有通知配置"
    note="创建 PushPlus 或 QQ 官方机器人通知，再绑定到需要提醒的监控。"
  >
    <template #action>
      <button class="button primary" type="button" @click="openCreate">＋ 设置通知</button>
    </template>
  </Empty>

  <NotificationEditor
    v-if="editorOpen"
    :channel="editing"
    :notify="props.notify"
    @close="editorOpen = false"
    @saved="onSaved"
  />
</template>
