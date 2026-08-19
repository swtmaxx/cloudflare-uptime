import type { CSSProperties } from 'react';
import type { Heartbeat, MonitorStatus, Tag } from './types';

export const statusLabel = (value: string): string => ({
  up: '正常',
  degraded: '部分异常',
  down: '宕机',
  unknown: '待探测',
  paused: '已暂停',
}[value] || '未知');

export const typeLabel = (value: string): string => value === 'tcp' ? 'TCP' : value === 'ping' ? 'Ping' : 'HTTP';
export const providerLabel = (value: string): string => value === 'globalping' ? 'Globalping' : 'Worker';
export const formatMs = (value: number | null | undefined): string => value === null || value === undefined ? '—' : `${value} ms`;
export const formatDate = (value: string | null | undefined): string => value
  ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '暂无';
export const formatDateOnly = (value: string | null | undefined): string => value
  ? `${new Date(value).getFullYear()}/${new Date(value).getMonth() + 1}/${new Date(value).getDate()}`
  : '暂无';
export const availabilityClass = (value: number | null | undefined): string => value === null || value === undefined ? 'unknown' : value >= 99.9 ? 'good' : value >= 95 ? 'warn' : 'bad';

export function formatAdminDate(value: string | null | undefined, timeDisplay: 'relative' | 'absolute' = 'relative'): string {
  if (!value) return '暂无';
  if (timeDisplay === 'absolute') return formatDate(value);
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function safeMarkdown(value: string | undefined): string {
  const escape = (input: string) => input.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
  return escape(value || '').split('\n').map((line) => line
    .replace(/^###\s+(.+)$/, '<strong>$1</strong>')
    .replace(/^##\s+(.+)$/, '<strong>$1</strong>')
    .replace(/^#\s+(.+)$/, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  ).join('<br>');
}

export function monitorTagStyle(tag: Tag): CSSProperties {
  return { '--tag-color': tag.color } as CSSProperties;
}

export function globalpingKey(location: { country: string; city?: string }): string {
  return `${location.country}|${location.city || ''}`.toLowerCase();
}

export function heartbeatStatus(successes: number, failures: number): Exclude<MonitorStatus, 'paused'> {
  if (successes === 0 && failures === 0) return 'unknown';
  if (failures > successes) return 'down';
  if (failures > 0) return 'degraded';
  return 'up';
}

export function paddedHeartbeats(history: Heartbeat[] = [], onlyLast = false): Array<Heartbeat | null> {
  const visible = history.slice(onlyLast ? -1 : -90);
  const total = onlyLast ? 1 : 90;
  return [...Array(Math.max(0, total - visible.length)).fill(null), ...visible];
}
