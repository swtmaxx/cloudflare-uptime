<script setup lang="ts">
import type { MonitorNotificationBinding, MonitorNotificationRule } from '../../types';

const props = defineProps<{
  channels: MonitorNotificationBinding[];
  rule: MonitorNotificationRule;
  onBindingsChange: (channels: MonitorNotificationBinding[]) => void;
  onRuleChange: (rule: MonitorNotificationRule) => void;
  onManage: () => void;
  onEdit: (channelId: string) => void;
}>();

function channelLabel(type: MonitorNotificationBinding['type']): string {
  return type === 'qqbot' ? 'QQ 官方机器人' : 'PushPlus（推送加）';
}

function toggleChannel(channelId: string) {
  props.onBindingsChange(props.channels.map((channel) => (
    channel.channelId === channelId ? { ...channel, enabled: channel.enabled ? 0 : 1 } : channel
  )));
}

function setRuleFlag(key: 'enabled' | 'notifyOnDegraded' | 'notifyOnDown' | 'notifyOnRecovery', checked: boolean) {
  props.onRuleChange({ ...props.rule, [key]: checked ? 1 : 0 });
}

function setFailureThreshold(value: number) {
  const next = Math.min(10, Math.max(1, Number(value) || 1));
  props.onRuleChange({ ...props.rule, failureThreshold: next });
}
</script>

<template>
  <aside class="notification-panel">
    <div class="section-head">
      <h3 class="section-title">通知</h3>
      <button class="button small ghost" type="button" @click="onManage">设置通知</button>
    </div>

    <div v-if="channels.length" class="notification-binding-list">
      <div v-for="channel in channels" :key="channel.channelId" class="notification-binding">
        <label class="toggle-option">
          <input type="checkbox" :checked="channel.enabled === 1" @change="toggleChannel(channel.channelId)" />
          <span>{{ channel.name }}</span>
        </label>
        <span class="notification-binding-actions">
          <span class="muted">{{ channelLabel(channel.type) }}</span>
          <button class="button small ghost" type="button" @click="onEdit(channel.channelId)">编辑</button>
        </span>
      </div>
    </div>
    <div v-else class="notice">还没有通知配置，请先点击“设置通知”。</div>

    <div class="notification-rule-grid">
      <label class="toggle-option">
        <input type="checkbox" :checked="rule.enabled === 1" @change="setRuleFlag('enabled', ($event.target as HTMLInputElement).checked)" />
        <span>启用通知</span>
      </label>
      <label class="toggle-option">
        <input type="checkbox" :checked="rule.notifyOnDegraded === 1" @change="setRuleFlag('notifyOnDegraded', ($event.target as HTMLInputElement).checked)" />
        <span>部分异常</span>
      </label>
      <label class="toggle-option">
        <input type="checkbox" :checked="rule.notifyOnDown === 1" @change="setRuleFlag('notifyOnDown', ($event.target as HTMLInputElement).checked)" />
        <span>宕机</span>
      </label>
      <label class="toggle-option">
        <input type="checkbox" :checked="rule.notifyOnRecovery === 1" @change="setRuleFlag('notifyOnRecovery', ($event.target as HTMLInputElement).checked)" />
        <span>恢复</span>
      </label>
      <div class="field">
        <label>连续异常次数</label>
        <input type="number" min="1" max="10" :value="rule.failureThreshold" @input="setFailureThreshold(Number(($event.target as HTMLInputElement).value))" />
      </div>
    </div>
    <p class="field-note">达到连续异常次数后发送一次，同一状态不会重复推送；恢复正常时发送恢复通知。</p>
  </aside>
</template>
