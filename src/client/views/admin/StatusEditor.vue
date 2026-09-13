<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../../api';
import EmptyComponent from '../../components/Empty.vue';
import Markdown from '../../components/Markdown.vue';
import Modal from '../../components/Modal.vue';
import PublicMonitorCard from '../../components/PublicMonitorCard.vue';
import type { Monitor, PublicMonitor, StatusPage, StatusPageGroup, ThemeMode } from '../../types';

const props = defineProps<{
  page: StatusPage | null;
  monitors: Monitor[];
  notify: (message: string, error?: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void; (e: 'deleted'): void }>();

function toPublicMonitor(monitor: Monitor): PublicMonitor {
  return {
    id: monitor.id,
    name: monitor.name,
    status: monitor.currentStatus,
    enabled: Boolean(monitor.enabled),
    availability: null,
    lastCheckedAt: monitor.lastCheckedAt,
    history: monitor.history || [],
    tags: monitor.tags,
  };
}

const initialGroups = (): StatusPageGroup[] => (props.page?.groups?.length
  ? props.page.groups.map((group) => ({ name: group.name, monitorIds: [...group.monitorIds] }))
  : [{ name: '服务', monitorIds: props.page?.monitorIds || [] }]);

const title = ref(props.page?.title || '');
const slug = ref(props.page?.slug || '');
const description = ref(props.page?.description || '');
const footer = ref(props.page?.footer || '');
const refreshSeconds = ref(String(props.page?.refreshSeconds || 300));
const theme = ref<ThemeMode>(props.page?.theme || 'auto');
const showTags = ref(props.page?.showTags !== 0);
const showPoweredBy = ref(props.page?.showPoweredBy !== 0);
const lastHeartbeatOnly = ref(props.page?.lastHeartbeatOnly === 1);
const rssTitle = ref(props.page?.rssTitle || '');
const customCss = ref(props.page?.customCss || '');
const groups = ref<StatusPageGroup[]>(initialGroups());
const busy = ref(false);

const monitorMap = computed(() => new Map(props.monitors.map((monitor) => [monitor.id, monitor])));

function updateGroup(index: number, update: Partial<StatusPageGroup>) {
  groups.value = groups.value.map((group, groupIndex) => (groupIndex === index ? { ...group, ...update } : group));
}
function moveGroup(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= groups.value.length) return;
  const next = [...groups.value];
  [next[index], next[target]] = [next[target], next[index]];
  groups.value = next;
}
function moveMonitor(groupIndex: number, monitorIndex: number, direction: -1 | 1) {
  groups.value = groups.value.map((group, index) => {
    if (index !== groupIndex) return group;
    const target = monitorIndex + direction;
    if (target < 0 || target >= group.monitorIds.length) return group;
    const ids = [...group.monitorIds];
    [ids[monitorIndex], ids[target]] = [ids[target], ids[monitorIndex]];
    return { ...group, monitorIds: ids };
  });
}
function addMonitor(groupIndex: number, monitorId: string) {
  if (!monitorId) return;
  updateGroup(groupIndex, { monitorIds: [...groups.value[groupIndex].monitorIds, monitorId] });
}
function removeMonitor(groupIndex: number, monitorIndex: number) {
  updateGroup(groupIndex, { monitorIds: groups.value[groupIndex].monitorIds.filter((_, index) => index !== monitorIndex) });
}
function addGroup() {
  const name = window.prompt('分组名称', `分组 ${groups.value.length + 1}`);
  if (name?.trim()) groups.value = [...groups.value, { name: name.trim(), monitorIds: [] }];
}
function deleteGroup(groupIndex: number) {
  if (groups.value.length > 1) groups.value = groups.value.filter((_, index) => index !== groupIndex);
}

const previewGroups = computed(() => groups.value.map((group) => ({
  ...group,
  monitors: group.monitorIds
    .map((id) => monitorMap.value.get(id))
    .filter((monitor): monitor is Monitor => Boolean(monitor))
    .map(toPublicMonitor),
})));

async function submit() {
  busy.value = true;
  try {
    await api(props.page ? `/api/status-pages/${props.page.id}` : '/api/status-pages', {
      method: props.page ? 'PATCH' : 'POST',
      body: JSON.stringify({
        title: title.value,
        slug: slug.value,
        description: description.value,
        footer: footer.value,
        refreshSeconds: Number(refreshSeconds.value),
        theme: theme.value,
        showTags: showTags.value,
        showPoweredBy: showPoweredBy.value,
        lastHeartbeatOnly: lastHeartbeatOnly.value,
        rssTitle: rssTitle.value,
        customCss: customCss.value,
        groups: groups.value.map((group) => ({ name: group.name, monitorIds: group.monitorIds })),
      }),
    });
    props.notify(props.page ? '状态页已更新' : '状态页已创建');
    emit('saved');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '保存失败', true);
    busy.value = false;
  }
}

async function removePage() {
  if (!props.page || !window.confirm('删除这个公开状态页？')) return;
  try {
    await api(`/api/status-pages/${props.page.id}`, { method: 'DELETE' });
    props.notify('状态页已删除');
    emit('deleted');
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '删除失败', true);
  }
}
</script>

<template>
  <Modal wide @close="emit('close')">
    <div class="modal-head">
      <div>
        <div class="page-kicker">Public page editor</div>
        <h2>{{ page ? '编辑状态页' : '新建状态页' }}</h2>
      </div>
    </div>

    <div class="status-editor">
      <div class="status-editor-pane">
        <form v-on:submit.prevent="submit">
          <div class="form-grid">
            <div class="field full">
              <label>标题</label>
              <input v-model="title" required maxlength="120" placeholder="服务状态" />
            </div>
            <div class="field">
              <label>访问标识</label>
              <input v-model="slug" required pattern="[a-z0-9-]+" maxlength="64" placeholder="service-status" />
            </div>
            <div class="field">
              <label>自动刷新（秒）</label>
              <input v-model="refreshSeconds" type="number" min="30" max="86400" />
            </div>
            <div class="field full">
              <label>描述（支持安全 Markdown）</label>
              <textarea v-model="description" maxlength="4000" placeholder="介绍服务当前状态" />
            </div>
            <div class="field full">
              <label>页脚（支持安全 Markdown）</label>
              <textarea v-model="footer" maxlength="4000" placeholder="联系支持团队或维护说明" />
            </div>
            <div class="field">
              <label>状态页主题</label>
              <select v-model="theme">
                <option value="auto">自动</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
            <div class="field">
              <label>RSS 标题</label>
              <input v-model="rssTitle" maxlength="160" placeholder="留空使用页面标题" />
            </div>
            <div class="field full">
              <label>显示选项</label>
              <div class="check-row">
                <label class="check-option"><input v-model="showTags" type="checkbox" />显示标签</label>
                <label class="check-option"><input v-model="showPoweredBy" type="checkbox" />显示 Powered By</label>
                <label class="check-option"><input v-model="lastHeartbeatOnly" type="checkbox" />只显示最后一次心跳</label>
              </div>
            </div>
            <div class="field full">
              <div class="section-head">
                <h3 class="section-title">状态页分组</h3>
                <button class="button small ghost" type="button" @click="addGroup">＋ 添加分组</button>
              </div>
              <div class="editor-groups">
                <div v-for="(group, groupIndex) in groups" :key="`${group.name}-${groupIndex}`" class="editor-group">
                  <div class="editor-group-head">
                    <input v-model="group.name" class="editor-group-name" maxlength="80" />
                    <span class="editor-group-actions">
                      <button class="icon-button" title="上移分组" type="button" @click="moveGroup(groupIndex, -1)">↑</button>
                      <button class="icon-button" title="下移分组" type="button" @click="moveGroup(groupIndex, 1)">↓</button>
                      <button class="icon-button" title="删除分组" type="button" @click="deleteGroup(groupIndex)">×</button>
                    </span>
                  </div>
                  <div class="group-monitor-list">
                    <template v-if="group.monitorIds.length">
                      <div v-for="(monitorId, monitorIndex) in group.monitorIds" :key="monitorId" class="group-monitor-row">
                        <span>{{ monitorMap.get(monitorId)?.name || monitorId }}</span>
                        <span class="sort-actions">
                          <button class="icon-button" title="上移" type="button" @click="moveMonitor(groupIndex, monitorIndex, -1)">↑</button>
                          <button class="icon-button" title="下移" type="button" @click="moveMonitor(groupIndex, monitorIndex, 1)">↓</button>
                          <button class="icon-button" title="移除" type="button" @click="removeMonitor(groupIndex, monitorIndex)">×</button>
                        </span>
                      </div>
                    </template>
                    <span v-else class="muted" style="padding-top: 9px">还没有监控</span>
                  </div>
                  <div class="group-add">
                    <select :value="''" @change="addMonitor(groupIndex, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
                      <option value="">选择要添加的监控</option>
                      <option v-for="monitor in monitors.filter((m) => !group.monitorIds.includes(m.id))" :key="monitor.id" :value="monitor.id">{{ monitor.name }}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <div class="field full">
              <label>自定义 CSS</label>
              <textarea v-model="customCss" maxlength="12000" placeholder="仅注入公开状态页，不会影响后台管理" />
            </div>
          </div>
          <div class="status-editor-actions">
            <button class="button ghost" type="button" @click="emit('close')">放弃</button>
            <div class="right">
              <button v-if="page" class="button ghost danger" type="button" @click="removePage">删除页面</button>
              <button class="button primary" type="submit" :disabled="busy">{{ page ? '保存修改' : '创建状态页' }}</button>
            </div>
          </div>
        </form>
      </div>

      <aside class="status-editor-preview">
        <div class="preview-label">公开预览</div>
        <div class="preview-frame">
          <style>{{ customCss }}</style>
          <main class="public-page preview-public" :data-preview-theme="theme">
            <header class="public-head">
              <div>
                <h1 class="public-title">{{ title || '服务状态' }}</h1>
                <Markdown :value="description" />
              </div>
              <span class="muted">预览</span>
            </header>
            <section v-for="group in previewGroups" :key="group.name" class="public-group">
              <h3 class="public-group-title">{{ group.name || '未命名分组' }}</h3>
              <div class="public-list">
                <template v-if="group.monitors.length">
                  <PublicMonitorCard v-for="monitor in group.monitors" :key="monitor.id" :monitor="monitor" :show-tags="showTags" :last-heartbeat-only="lastHeartbeatOnly" />
                </template>
                <EmptyComponent v-else title="暂无监控" note="添加监控到这个分组。" />
              </div>
            </section>
            <Markdown :value="footer" class="markdown-preview public-footer" />
            <div v-if="showPoweredBy" class="muted" style="margin-top: 18px; font-size: 11px">Powered by Pulseboard</div>
          </main>
        </div>
      </aside>
    </div>
  </Modal>
</template>
