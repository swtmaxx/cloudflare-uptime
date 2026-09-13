<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api';
import PageHead from '../../components/PageHead.vue';
import Empty from '../../components/Empty.vue';
import { formatDate } from '../../utils';
import type { GlobalpingProbe } from '../../types';

const props = defineProps<{ notify: (m: string, e?: boolean) => void }>();

const probes = ref<GlobalpingProbe[]>([]);
const search = ref('');
const country = ref('');
const status = ref('');
const page = ref(1);
const updatedAt = ref<string | null>(null);
const loading = ref(true);
const pageSize = 50;

async function load() {
  loading.value = true;
  try {
    const data = await api<{ probes: GlobalpingProbe[]; updatedAt: string }>('/api/globalping/probes');
    probes.value = data.probes || [];
    updatedAt.value = data.updatedAt || null;
    page.value = 1;
  } catch (reason) {
    props.notify(reason instanceof Error ? reason.message : '无法读取 Globalping 节点', true);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const countries = computed(() => [...new Set(probes.value.map((probe) => probe.countryCode))].sort());

const filtered = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return probes.value.filter((probe) => {
    const matchesSearch = !needle || [probe.id, probe.countryCode, probe.city, probe.network || '', probe.asn || '', probe.ip || '', ...probe.resolvers]
      .some((value) => value.toLocaleLowerCase().includes(needle));
    return matchesSearch && (!country.value || probe.countryCode === country.value) && (!status.value || (status.value === 'online' ? probe.online : !probe.online));
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const currentPage = computed(() => Math.min(page.value, pageCount.value));
const visible = computed(() => filtered.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize));
const onlineCount = computed(() => probes.value.filter((probe) => probe.online).length);
const cityCount = computed(() => new Set(probes.value.map((probe) => `${probe.countryCode}\u0000${probe.city}`)).size);

function updateSearch(value: string) { search.value = value; page.value = 1; }
function updateCountry(value: string) { country.value = value; page.value = 1; }
function updateStatus(value: string) { status.value = value; page.value = 1; }
</script>

<template>
  <PageHead kicker="Globalping" title="探测节点" note="查看 Globalping 当前公开的全部可用探针。">
    <template #action>
      <button class="button small ghost" type="button" @click="load" :disabled="loading">{{ loading ? '读取中…' : '刷新节点' }}</button>
    </template>
  </PageHead>

  <div class="metric-grid probe-metric-grid">
    <div class="metric"><div class="metric-label">全部节点</div><div class="metric-value">{{ probes.length }}</div></div>
    <div class="metric"><div class="metric-label">可用节点</div><div class="metric-value mint">{{ onlineCount }}</div></div>
    <div class="metric"><div class="metric-label">国家</div><div class="metric-value">{{ countries.length }}</div></div>
    <div class="metric"><div class="metric-label">城市</div><div class="metric-value">{{ cityCount }}</div></div>
  </div>

  <div class="section">
    <div class="filter-bar">
      <input class="filter-search" :value="search" @input="updateSearch(($event.target as HTMLInputElement).value)" placeholder="搜索 ID、国家、城市、网络、IP 或 ASN" />
      <select :value="country" @change="updateCountry(($event.target as HTMLSelectElement).value)">
        <option value="">全部国家</option>
        <option v-for="item in countries" :key="item" :value="item">{{ item }}</option>
      </select>
      <select :value="status" @change="updateStatus(($event.target as HTMLSelectElement).value)">
        <option value="">全部状态</option>
        <option value="online">在线</option>
        <option value="offline">离线</option>
      </select>
    </div>

    <div class="section-head probe-list-head">
      <h2 class="section-title">节点列表</h2>
      <span class="muted">{{ loading ? '正在读取 Globalping 节点…' : `显示 ${filtered.length} 个匹配节点${updatedAt ? ` · 更新于 ${formatDate(updatedAt)}` : ''}` }}</span>
    </div>

    <div class="panel table-wrap">
      <table v-if="visible.length">
        <thead>
          <tr><th>状态</th><th>节点 ID</th><th>国家</th><th>城市</th><th>网络</th><th>ASN</th><th>Resolver</th></tr>
        </thead>
        <tbody>
          <tr v-for="probe in visible" :key="probe.id">
            <td><span class="probe-status" :class="probe.online ? 'online' : 'offline'"><i class="status-dot" />{{ probe.online ? '在线' : '离线' }}</span></td>
            <td class="mono">{{ probe.id }}</td>
            <td>{{ probe.countryCode }}</td>
            <td>{{ probe.city }}</td>
            <td>{{ probe.network || '—' }}</td>
            <td class="mono">{{ probe.asn || '—' }}</td>
            <td class="mono">{{ probe.resolvers.length ? probe.resolvers.join(', ') : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <Empty v-else :title="loading ? '正在读取节点' : probes.length ? '没有匹配节点' : '暂无节点数据'" :note="loading ? '正在从 Globalping 获取完整探针列表。' : probes.length ? '调整搜索或筛选条件。' : 'Globalping 没有返回可显示的探针。'" />
    </div>

    <div v-if="filtered.length" class="pagination">
      <button class="button small ghost" type="button" :disabled="currentPage <= 1" @click="page = Math.max(1, page - 1)">上一页</button>
      <span class="muted">第 {{ currentPage }} / {{ pageCount }} 页</span>
      <button class="button small ghost" type="button" :disabled="currentPage >= pageCount" @click="page = Math.min(pageCount, page + 1)">下一页</button>
    </div>
  </div>
</template>
