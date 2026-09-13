<script setup lang="ts">
import PageHead from '../../components/PageHead.vue';
import type { AdminSettings, User } from '../../types';

defineProps<{ settings: AdminSettings; user: User }>();
</script>

<template>
  <PageHead kicker="About" title="关于" note="当前部署使用的运行时、探测服务和存储边界。" />

  <div class="about-grid">
    <div class="about-item"><strong>Pulseboard</strong><span>Cloudflare Worker 上的可用性监控控制台与公开状态页。</span></div>
    <div class="about-item"><strong>Worker + D1</strong><span>单 Worker 提供 API、调度和页面；D1 保存监控、心跳、标签和状态页配置。</span></div>
    <div class="about-item"><strong>Worker + Globalping</strong><span>支持 HTTP、TCP 端口和 Globalping Ping 检查，当前调度间隔为 1 分钟。</span></div>
  </div>

  <section class="section">
    <div class="panel">
      <div class="info-list">
        <div class="info-row"><span class="info-key">公开页面</span><span class="info-value">/status/&lt;slug&gt;</span></div>
        <div class="info-row"><span class="info-key">RSS</span><span class="info-value">/status/&lt;slug&gt;/rss.xml</span></div>
        <div class="info-row"><span class="info-key">当前账号</span><span class="info-value">{{ user.username }}</span></div>
        <div class="info-row"><span class="info-key">历史策略</span><span class="info-value">{{ settings.historyRetentionDays === 0 ? '永久保留' : `${settings.historyRetentionDays} 天` }}</span></div>
      </div>
    </div>
  </section>
</template>
