<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../api';
import Modal from '../../components/Modal.vue';
import { monitorTagStyle, globalpingKey } from '../../utils';
import type { GlobalpingLocation, Monitor, MonitorNotificationBinding, MonitorNotificationRule, MonitorNotificationSettings, NotificationChannel, Tag } from '../../types';

const props = defineProps<{
  monitor: Monitor | null;
  tags: Tag[];
  maxNodesPerMonitor: number;
  notify: (m: string, e?: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}>();

type Provider = 'worker' | 'globalping';
type MonitorType = 'http' | 'tcp' | 'ping';
type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Preset { id: string; label: string; description: string; locations: string[] }

const GLOBALPING_PRESETS: Preset[] = [
  { id: 'global', label: '全球', description: '亚洲、北美、欧洲', locations: ['CN|Shanghai', 'SG|Singapore', 'JP|Tokyo', 'US|Los Angeles', 'DE|Frankfurt'] },
  { id: 'asia', label: '亚洲', description: '中国、日本、新加坡', locations: ['CN|Shanghai', 'JP|Tokyo', 'SG|Singapore', 'IN|Mumbai', 'AU|Sydney'] },
  { id: 'china', label: '中国及周边', description: '中国大陆、香港、日本', locations: ['CN|Beijing', 'CN|Shanghai', 'CN|Guangzhou', 'CN|Hong Kong', 'JP|Tokyo'] },
  { id: 'europe', label: '欧洲', description: '欧洲主要城市', locations: ['GB|London', 'DE|Frankfurt', 'FR|Paris', 'NL|Amsterdam', 'SE|Stockholm'] },
  { id: 'americas', label: '美洲', description: '美国、加拿大、巴西', locations: ['US|Los Angeles', 'US|New York', 'US|Dallas', 'CA|Toronto', 'BR|Sao Paulo'] },
];

const defaultNotificationRule: MonitorNotificationRule = { enabled: 1, notifyOnDegraded: 0, notifyOnDown: 1, notifyOnRecovery: 1, failureThreshold: 3 };

const name = ref(props.monitor?.name || '');
const type = ref<MonitorType>(props.monitor?.type || 'http');
const provider = ref<Provider>(props.monitor?.provider || 'worker');
const httpMethod = ref<HttpMethod>(props.monitor?.httpMethod || 'GET');
const url = ref(props.monitor?.targetUrl || '');
const host = ref(props.monitor?.host || '');
const port = ref(String(props.monitor?.port || ''));
const intervalMinutes = ref(String(Math.max(1, Math.round((props.monitor?.intervalSeconds || 60) / 60))));
const timeoutSeconds = ref(String(props.monitor?.timeoutSeconds || 10));
const requestHeaders = ref(JSON.stringify(props.monitor?.requestHeaders || {}, null, 2));
const requestBody = ref(props.monitor?.requestBody || '');
const expectedStatusCodes = ref((props.monitor?.expectedStatusCodes || []).join(', '));
const responseKeyword = ref(props.monitor?.responseKeyword || '');
const enabled = ref(props.monitor?.enabled !== 0);
const tagIds = ref<string[]>(props.monitor?.tags?.map((tag) => tag.id) || []);
const locations = ref<GlobalpingLocation[]>(props.monitor?.globalpingLocations || []);
const knownLocations = ref<GlobalpingLocation[]>([]);
const locationSearch = ref('');
const showAllLocations = ref(false);
const notificationBindings = ref<MonitorNotificationBinding[]>([]);
const notificationRule = ref<MonitorNotificationRule>({ ...defaultNotificationRule });
const notificationLoading = ref(true);
const busy = ref(false);

const effectiveGlobalping = computed(() => (type.value === 'http' || type.value === 'ping') && provider.value === 'globalping');
const effectiveWorker = computed(() => provider.value === 'worker');

watch([type, provider], ([nextType, nextProvider]: [MonitorType, Provider]) => {
  if (nextType === 'tcp' && nextProvider === 'globalping') provider.value = 'worker';
  if (nextType === 'ping' && nextProvider === 'worker') provider.value = 'globalping';
});

function changeType(nextType: MonitorType) {
  type.value = nextType;
  if (nextType === 'ping') provider.value = 'globalping';
  if (nextType === 'tcp' && provider.value === 'globalping') provider.value = 'worker';
}

async function loadLocations() {
  if (!effectiveGlobalping.value || knownLocations.value.length) return;
  try {
    const data = await api<{ locations: GlobalpingLocation[] }>('/api/globalping/locations');
    const nextLocations = data.locations || [];
    knownLocations.value = nextLocations;
    if (!props.monitor && locations.value.length === 0) {
      const recommended = GLOBALPING_PRESETS[0].locations
        .map((key) => nextLocations.find((location) => globalpingKey(location) === key.toLowerCase()))
        .filter((location): location is GlobalpingLocation => Boolean(location))
        .slice(0, Math.max(1, props.maxNodesPerMonitor));
      locations.value = recommended;
    }
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取 Globalping 位置', true);
  }
}

watch(effectiveGlobalping, (value) => { if (value) loadLocations(); });

async function loadNotificationSettings() {
  notificationLoading.value = true;
  try {
    if (props.monitor) {
      const data = await api<MonitorNotificationSettings>(`/api/monitors/${props.monitor.id}/notifications`);
      notificationBindings.value = data.channels || [];
      notificationRule.value = data.rule || { ...defaultNotificationRule };
    } else {
      const data = await api<{ channels: NotificationChannel[] }>('/api/notifications');
      notificationBindings.value = (data.channels || []).map((channel) => ({
        channelId: channel.id, name: channel.name, type: channel.type, defaultEnabled: channel.defaultEnabled, enabled: channel.defaultEnabled,
      }));
    }
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取通知配置', true);
  } finally {
    notificationLoading.value = false;
  }
}

const locationLimit = computed(() => Math.max(1, props.maxNodesPerMonitor || 1));
const mergedLocations = computed(() => [...new Map([...knownLocations.value, ...locations.value].map((location) => [globalpingKey(location), location])).values()]);
const filteredLocations = computed(() => mergedLocations.value.filter((location) => {
  const needle = locationSearch.value.trim().toLocaleLowerCase();
  return !needle || `${location.country} ${location.city || ''}`.toLocaleLowerCase().includes(needle);
}));
const selectedLocations = computed(() => locations.value.filter((location) => mergedLocations.value.some((item) => globalpingKey(item) === globalpingKey(location))));

function toggle<T>(values: T[], value: T, setter: (next: T[]) => void) {
  setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
}
function selectedLocation(location: GlobalpingLocation): boolean {
  return locations.value.some((item) => globalpingKey(item) === globalpingKey(location));
}
function toggleLocation(location: GlobalpingLocation) {
  if (selectedLocation(location)) {
    locations.value = locations.value.filter((item) => globalpingKey(item) !== globalpingKey(location));
  } else {
    locations.value = [...locations.value, { country: location.country, ...(location.city ? { city: location.city } : {}) }];
  }
}
function atLimit(location: GlobalpingLocation): boolean {
  return !selectedLocation(location) && locations.value.length >= locationLimit.value;
}
function selectPreset(preset: Preset) {
  const presetLocations = preset.locations
    .map((key) => mergedLocations.value.find((location) => globalpingKey(location) === key.toLowerCase()))
    .filter((location): location is GlobalpingLocation => Boolean(location));
  locations.value = presetLocations.slice(0, locationLimit.value);
}
function clearLocations() { locations.value = []; }
function toggleTag(tagIdItem: string) { toggle(tagIds.value, tagIdItem, (next) => (tagIds.value = next)); }
function toggleBadgeEnabled(channel: MonitorNotificationBinding) {
  notificationBindings.value = notificationBindings.value.map((item) => item.channelId === channel.channelId ? { ...item, enabled: item.enabled ? 0 : 1 } : item);
}
function setRule(patch: Partial<MonitorNotificationRule>) { notificationRule.value = { ...notificationRule.value, ...patch }; }

async function submit(event: Event) {
  event.preventDefault();
  busy.value = true;
  let headers: Record<string, string> = {};
  let statuses: number[] = [];
  try {
    if (type.value === 'http' && effectiveWorker.value) {
      const parsed = requestHeaders.value.trim() ? JSON.parse(requestHeaders.value) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求头必须是 JSON 对象');
      headers = parsed as Record<string, string>;
      statuses = expectedStatusCodes.value.trim()
        ? [...new Set(expectedStatusCodes.value.split(/[,\s]+/).filter(Boolean).map(Number))]
        : [];
      if (statuses.some((value) => !Number.isInteger(value) || value < 100 || value > 599)) throw new Error('成功状态码格式不正确');
    }
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : 'HTTP 高级参数格式不正确', true);
    busy.value = false;
    return;
  }

  const payload: Record<string, unknown> = {
    name: name.value,
    type: type.value,
    provider: provider.value,
    httpMethod: type.value === 'http' ? httpMethod.value : 'GET',
    intervalMinutes: Number(intervalMinutes.value),
    timeoutSeconds: Number(timeoutSeconds.value),
    requestHeaders: type.value === 'http' && effectiveWorker.value ? headers : {},
    requestBody: type.value === 'http' && effectiveWorker.value ? requestBody.value : '',
    expectedStatusCodes: type.value === 'http' && effectiveWorker.value ? statuses : [],
    responseKeyword: type.value === 'http' && effectiveWorker.value ? responseKeyword.value : '',
    host: type.value === 'http' ? null : host.value,
    port: type.value === 'tcp' ? Number(port.value) : null,
    targetUrl: type.value === 'http' ? url.value : null,
    tagIds: tagIds.value,
    globalpingLocations: effectiveGlobalping.value ? locations.value : [],
    enabled: enabled.value,
  };

  try {
    const result = await api<{ monitor: Monitor }>(props.monitor ? `/api/monitors/${props.monitor.id}` : '/api/monitors', {
      method: props.monitor ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    await api(`/api/monitors/${result.monitor.id}/notifications`, {
      method: 'PUT',
      body: JSON.stringify({
        bindings: notificationBindings.value.map((binding) => ({ channelId: binding.channelId, enabled: binding.enabled === 1 })),
        rule: {
          enabled: notificationRule.value.enabled === 1,
          notifyOnDegraded: notificationRule.value.notifyOnDegraded === 1,
          notifyOnDown: notificationRule.value.notifyOnDown === 1,
          notifyOnRecovery: notificationRule.value.notifyOnRecovery === 1,
          failureThreshold: notificationRule.value.failureThreshold,
        },
      }),
    });
    props.notify(props.monitor ? '监控已更新' : '监控已创建');
    props.onSaved();
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '保存失败', true);
    busy.value = false;
  }
}

onMounted(() => {
  loadNotificationSettings();
  if (effectiveGlobalping.value) loadLocations();
});
</script>

<template>
  <Modal className="monitor-modal" @close="props.onClose">
    <div class="modal-head">
      <div><div class="page-kicker">Monitor setup</div><h2>{{ props.monitor ? '编辑监控' : '新建监控' }}</h2></div>
    </div>
    <form @submit="submit">
      <div class="monitor-form-layout">
        <div>
          <div class="form-grid">
            <div class="field full"><label>名称</label><input v-model="name" required maxlength="80" placeholder="例如：主站健康检查" /></div>
            <div class="field full">
              <label>标签</label>
              <div class="check-row">
                <label v-for="tag in props.tags" :key="tag.id" class="check-option">
                  <input type="checkbox" :checked="tagIds.includes(tag.id)" @change="toggleTag(tag.id)" />
                  <span class="tag tag-chip" :style="monitorTagStyle(tag)">{{ tag.name }}</span>
                </label>
                <span v-if="!props.tags.length" class="muted">还没有标签，可在监控管理中创建。</span>
              </div>
            </div>
            <div class="field"><label>类型</label><select v-model="type" @change="changeType(type as MonitorType)"><option value="http">HTTP / HTTPS</option><option value="tcp">TCP 端口</option><option value="ping">Ping（Globalping）</option></select></div>
            <div class="field"><label>检查频率（分钟）</label><input v-model="intervalMinutes" type="number" min="1" max="60" required /></div>
            <div class="field"><label>探测服务</label><select v-model="provider" :disabled="type === 'ping'"><option value="worker">Worker（本地）</option><option value="globalping">Globalping（多地区）</option></select></div>
            <div v-if="type === 'http'" class="field"><label>HTTP 方法</label><select v-model="httpMethod"><option v-for="method in (['GET','HEAD','OPTIONS','POST','PUT','PATCH','DELETE'] as HttpMethod[])" :key="method" :value="method">{{ method }}</option></select></div>
            <div v-else class="field"><label>{{ type === 'ping' ? 'Ping 超时（秒）' : '连接超时（秒）' }}</label><input v-model="timeoutSeconds" type="number" min="1" max="30" required /></div>

            <div v-if="type === 'http'" class="field full"><label>URL</label><input v-model="url" type="url" maxlength="2048" placeholder="https://example.com/health" required /></div>
            <template v-else>
              <div class="field" :style="type === 'ping' ? { gridColumn: '1 / -1' } : {}"><label>{{ type === 'ping' ? 'Ping 主机' : '主机' }}</label><input v-model="host" maxlength="253" :placeholder="type === 'ping' ? 'example.com 或 IP 地址' : 'db.example.com'" required /></div>
              <div v-if="type === 'tcp'" class="field"><label>端口</label><input v-model="port" type="number" min="1" max="65535" placeholder="443" required /></div>
            </template>

            <template v-if="type === 'http' && effectiveWorker">
              <div class="field"><label>请求超时（秒）</label><input v-model="timeoutSeconds" type="number" min="1" max="30" required /></div>
              <div class="field"><label>成功状态码</label><input v-model="expectedStatusCodes" placeholder="留空表示 200-399" /></div>
              <div class="field full"><label>请求头（JSON）</label><textarea v-model="requestHeaders" rows="4" placeholder='{"Authorization":"Bearer ..."}' /></div>
              <div class="field full"><label>请求体</label><textarea v-model="requestBody" rows="4" placeholder="POST / PUT / PATCH 请求体，可填写 JSON 或文本" /></div>
              <div class="field full"><label>响应关键字</label><input v-model="responseKeyword" maxlength="1000" placeholder="响应正文必须包含的文本，可留空" /></div>
            </template>

            <div v-if="effectiveGlobalping" class="field full">
              <div class="globalping-picker">
                <div class="globalping-picker-head">
                  <div><label>Globalping 探测位置</label><div class="field-note">先用常用范围快速选择，需要精确控制时再展开位置列表。</div></div>
                  <span class="selection-count">{{ locations.length }} / {{ locationLimit }}</span>
                </div>
                <div class="globalping-presets">
                  <button v-for="preset in GLOBALPING_PRESETS" :key="preset.id" class="globalping-preset" type="button" @click="selectPreset(preset)" :disabled="!mergedLocations.length"><strong>{{ preset.label }}</strong><span>{{ preset.description }}</span></button>
                </div>
                <div v-if="selectedLocations.length" class="selected-location-list">
                  <span v-for="location in selectedLocations" :key="globalpingKey(location)" class="selected-location">{{ location.country }} · {{ location.city }}<button type="button" :aria-label="`移除 ${location.country} ${location.city}`" @click="toggleLocation(location)">×</button></span>
                  <button class="button small text-button" type="button" @click="clearLocations">清空</button>
                </div>
                <div v-else class="notice warning">请选择一个探测范围，或展开位置列表。</div>
                <button class="button small ghost location-toggle" type="button" @click="showAllLocations = !showAllLocations">{{ showAllLocations ? '收起位置列表' : '选择其他位置' }}</button>
                <div v-if="showAllLocations" class="location-library">
                  <input v-model="locationSearch" placeholder="搜索国家或城市" aria-label="搜索 Globalping 国家或城市" />
                  <div v-if="filteredLocations.length" class="node-picker">
                    <label v-for="location in filteredLocations" :key="globalpingKey(location)" class="node-option" :class="{ disabled: atLimit(location) }">
                      <input type="checkbox" :checked="selectedLocation(location)" :disabled="atLimit(location)" @change="toggleLocation(location)" />
                      <span><strong>{{ location.country }} · {{ location.city || '全境' }}</strong></span>
                    </label>
                  </div>
                  <div v-else class="notice">没有匹配的位置。</div>
                </div>
              </div>
            </div>

            <div class="field full"><label class="node-option" style="padding:0;border:0"><input type="checkbox" v-model="enabled" /><span>创建后立即启用</span></label></div>
          </div>
        </div>
        <aside class="notification-panel">
          <div class="section-head"><h3 class="section-title">通知</h3></div>
          <div v-if="notificationBindings.length" class="notification-binding-list">
            <div v-for="channel in notificationBindings" :key="channel.channelId" class="notification-binding">
              <label class="toggle-option"><input type="checkbox" :checked="channel.enabled === 1" @change="toggleBadgeEnabled(channel)" /><span>{{ channel.name }}</span></label>
            </div>
          </div>
          <div v-else class="notice">还没有通知配置。</div>
          <div class="notification-rule-grid">
            <label class="toggle-option"><input type="checkbox" :checked="notificationRule.enabled === 1" @change="setRule({ enabled: notificationRule.enabled === 1 ? 0 : 1 })" /><span>启用通知</span></label>
            <label class="toggle-option"><input type="checkbox" :checked="notificationRule.notifyOnDegraded === 1" @change="setRule({ notifyOnDegraded: notificationRule.notifyOnDegraded === 1 ? 0 : 1 })" /><span>部分异常</span></label>
            <label class="toggle-option"><input type="checkbox" :checked="notificationRule.notifyOnDown === 1" @change="setRule({ notifyOnDown: notificationRule.notifyOnDown === 1 ? 0 : 1 })" /><span>宕机</span></label>
            <label class="toggle-option"><input type="checkbox" :checked="notificationRule.notifyOnRecovery === 1" @change="setRule({ notifyOnRecovery: notificationRule.notifyOnRecovery === 1 ? 0 : 1 })" /><span>恢复</span></label>
            <div class="field"><label>连续异常次数</label><input type="number" min="1" max="10" :value="notificationRule.failureThreshold" @change="setRule({ failureThreshold: Math.min(10, Math.max(1, Number(($event.target as HTMLInputElement).value) || 1)) })" /></div>
          </div>
          <p class="field-note">达到连续异常次数后发送一次，同一状态不会重复推送；恢复正常时发送恢复通知。</p>
        </aside>
      </div>
      <div class="notice" style="margin-top:18px">{{ effectiveWorker ? 'Worker 直接从 Cloudflare 发起 HTTP 或 TCP 检查，适合 API 和端口可用性。' : type === 'ping' ? 'Globalping 从所选国家和城市的在线探针发起 ICMP Ping，并记录平均延迟和丢包率。' : 'Globalping 按国家和城市规则随机选择在线探针。' }}</div>
      <div class="form-actions">
        <button type="button" class="button ghost" @click="props.onClose">取消</button>
        <button type="submit" class="button primary" :disabled="busy || notificationLoading">{{ notificationLoading ? '读取通知…' : props.monitor ? '保存修改' : '创建监控' }}</button>
      </div>
    </form>
  </Modal>
</template>
