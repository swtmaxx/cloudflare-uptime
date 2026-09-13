<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import type { User } from '../types';

const props = defineProps<{ setup: boolean }>();
const emit = defineEmits<{ (e: 'authenticated', user: User): void }>();

const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const result = await api<{ user: User }>(props.setup ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    emit('authenticated', result.user);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '请求失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-box">
      <div class="brand"><div class="brand-mark">P</div><div class="brand-copy"><div class="brand-name">Pulseboard</div><div class="brand-sub">uptime control room</div></div></div>
      <h1 class="auth-title">{{ setup ? '建立管理员' : '登录控制台' }}</h1>
      <p class="auth-note">{{ setup ? '首次使用，请创建一个管理员账号。账号只保存在你的 D1 数据库中。' : '登录后管理监控和公开状态页。' }}</p>
      <div v-if="error" class="notice warning" style="margin-bottom: 16px">{{ error }}</div>
      <form @submit.prevent="submit">
        <div class="field"><label>用户名</label><input v-model="username" autocomplete="username" required minlength="3" maxlength="64" /></div>
        <div class="field"><label>密码</label><input v-model="password" type="password" :autocomplete="setup ? 'new-password' : 'current-password'" required minlength="8" /></div>
        <button class="button primary" type="submit" :disabled="busy">{{ setup ? '创建并进入' : '登录控制台' }}</button>
      </form>
    </section>
  </main>
</template>
