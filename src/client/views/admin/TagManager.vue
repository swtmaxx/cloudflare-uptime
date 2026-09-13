<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '../../api';
import Modal from '../../components/Modal.vue';
import { monitorTagStyle } from '../../utils';
import type { Tag } from '../../types';

const props = defineProps<{
  tags: Tag[];
  setTags: (tags: Tag[]) => void;
  notify: (m: string, e?: boolean) => void;
  onClose: () => void;
}>();

const name = ref('');
const color = ref('#5ee0b2');
const drafts = reactive<Record<string, { name: string; color: string }>>({});

async function refresh() {
  const data = await api<{ tags: Tag[] }>('/api/tags');
  props.setTags(data.tags || []);
}

async function create(event: Event) {
  event.preventDefault();
  try {
    await api('/api/tags', { method: 'POST', body: JSON.stringify({ name: name.value, color: color.value }) });
    await refresh();
    name.value = '';
    color.value = '#5ee0b2';
    props.notify('标签已创建');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '创建失败', true);
  }
}

async function update(tag: Tag) {
  const draft = drafts[tag.id] || { name: tag.name, color: tag.color };
  try {
    await api(`/api/tags/${tag.id}`, { method: 'PATCH', body: JSON.stringify(draft) });
    await refresh();
    props.notify('标签已更新');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '更新失败', true);
  }
}

async function remove(tag: Tag) {
  if (!window.confirm('删除这个标签？监控本身不会被删除。')) return;
  try {
    await api(`/api/tags/${tag.id}`, { method: 'DELETE' });
    await refresh();
    props.notify('标签已删除');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '删除失败', true);
  }
}

function draftFor(tag: Tag) {
  if (!drafts[tag.id]) drafts[tag.id] = { name: tag.name, color: tag.color };
  return drafts[tag.id];
}
</script>

<template>
  <Modal @close="props.onClose">
    <div class="modal-head">
      <div><div class="page-kicker">Monitor labels</div><h2>管理标签</h2></div>
    </div>
    <div>
      <div v-if="props.tags.length" v-for="tag in props.tags" :key="tag.id" class="info-row">
        <span style="display:flex;align-items:center;gap:9px;min-width:0">
          <input :value="draftFor(tag).name" maxlength="40" @input="draftFor(tag).name = ($event.target as HTMLInputElement).value" />
          <span class="tag tag-chip" :style="monitorTagStyle({ ...tag, name: draftFor(tag).name, color: draftFor(tag).color })">{{ draftFor(tag).name }}</span>
        </span>
        <span style="display:flex;align-items:center;gap:7px">
          <input :value="draftFor(tag).color" type="color" @input="draftFor(tag).color = ($event.target as HTMLInputElement).value" />
          <button class="button small" type="button" @click="update(tag)">保存</button>
          <button class="button small ghost danger" type="button" @click="remove(tag)">删除</button>
        </span>
      </div>
      <div v-else class="empty"><strong>还没有标签</strong><span>创建标签后可应用到监控上。</span></div>
    </div>
    <form @submit="create">
      <div class="form-grid" style="margin-top:16px">
        <div class="field"><label>新标签名称</label><input v-model="name" maxlength="40" required /></div>
        <div class="field"><label>颜色</label><input v-model="color" type="color" /></div>
      </div>
      <div class="form-actions"><button class="button primary" type="submit">创建标签</button></div>
    </form>
  </Modal>
</template>
