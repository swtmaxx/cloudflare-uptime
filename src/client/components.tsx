import { useEffect, useState, type ReactNode } from 'react';
import type { Heartbeat, MonitorStatus, PublicMonitor, Tag } from './types';
import {
  availabilityClass,
  formatAdminDate,
  formatDate,
  formatDateOnly,
  monitorTagStyle,
  paddedHeartbeats,
  safeMarkdown,
  statusLabel,
} from './utils';

export function StatusBadge({ status }: { status: MonitorStatus }): JSX.Element {
  return <span className={`status ${status}`}><i className="status-dot" />{statusLabel(status)}</span>;
}

export function TagChip({ tag }: { tag: Tag }): JSX.Element {
  return <span className="tag tag-chip" style={monitorTagStyle(tag)}>{tag.name}</span>;
}

export function TagList({ tags = [] }: { tags?: Tag[] }): JSX.Element | null {
  if (!tags.length) return null;
  return <div className="monitor-tags">{tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}</div>;
}

export function HeartbeatBar({ history = [], onlyLast = false, timeDisplay = 'relative' }: { history?: Heartbeat[]; onlyLast?: boolean; timeDisplay?: 'relative' | 'absolute' }): JSX.Element {
  return <>
    <div className="heartbeat-bar" aria-label={onlyLast ? '最后一次检查记录' : '最近 90 次心跳'}>
      {paddedHeartbeats(history, onlyLast).map((item, index) => <span key={`${item?.id || 'empty'}-${index}`} className={item?.status || 'unknown'} title={item ? `${statusLabel(item.status)} · ${formatAdminDate(item.checkedAt, timeDisplay)}` : '尚未检查'} />)}
    </div>
    <div className="heartbeat-caption">{history.length ? `最近 ${history.length} 次 · ${formatAdminDate(history[history.length - 1].checkedAt, timeDisplay)}` : '尚未产生心跳'}</div>
  </>;
}

export function PageHead({ kicker, title, note, action }: { kicker: string; title: string; note?: string; action?: ReactNode }): JSX.Element {
  return <div className="page-head"><div><div className="page-kicker">{kicker}</div><h1>{title}</h1>{note ? <p className="page-note">{note}</p> : null}</div>{action}</div>;
}

export function Empty({ title, note, action }: { title: string; note: string; action?: ReactNode }): JSX.Element {
  return <div className="empty"><strong>{title}</strong><span>{note}</span>{action ? <div style={{ marginTop: 16 }}>{action}</div> : null}</div>;
}

export function Modal({ children, wide = false, className = '', onClose }: { children: ReactNode; wide?: boolean; className?: string; onClose: () => void }): JSX.Element {
  return <div className="modal-layer" data-modal>
    <section className={`modal${wide ? ' status-editor-modal' : ''}${className ? ` ${className}` : ''}`}>
      <button className="close" type="button" aria-label="关闭" onClick={onClose}>×</button>
      {children}
    </section>
  </div>;
}

export function Markdown({ value, className = 'markdown-preview' }: { value?: string; className?: string }): JSX.Element | null {
  if (!value) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: safeMarkdown(value) }} />;
}

export function PublicMonitorCard({ monitor, showTags = true, lastHeartbeatOnly = false }: { monitor: PublicMonitor; showTags?: boolean; lastHeartbeatOnly?: boolean }): JSX.Element {
  const status = monitor.enabled ? monitor.status : 'paused';
  const availability = monitor.availability === null || monitor.availability === undefined ? '暂无数据' : `总可用率: ${Number(monitor.availability).toFixed(2)}%`;
  return <article className="public-monitor">
    <div className="public-monitor-head">
      <div className="public-monitor-name"><span className={`public-state-icon ${status === 'paused' ? 'unknown' : status}`}>{status === 'down' ? '!' : status === 'unknown' || status === 'paused' ? '?' : '✓'}</span><span>{monitor.name}</span></div>
      <div className={`public-availability ${availabilityClass(monitor.availability)}`}>{availability}</div>
    </div>
    {showTags ? <TagList tags={monitor.tags} /> : null}
    <div className="public-history" aria-label={lastHeartbeatOnly ? '最后一次检查记录' : '最近 90 次检查记录'}>
      {paddedHeartbeats(monitor.history || [], lastHeartbeatOnly).map((item, index) => {
        const availabilityText = item?.availability === null || item?.availability === undefined ? null : Number(item.availability).toFixed(1);
        const title = item ? `${availabilityText === null ? statusLabel(item.status) : `${availabilityText}%`} 于 ${formatDateOnly(item.checkedAt)}` : '尚未检查';
        return <span key={`${item?.id || 'empty'}-${index}`} className={`public-history-cell ${item?.status || 'unknown'}`} title={title} />;
      })}
    </div>
  </article>;
}

export function ThemeToggle({ onChange }: { onChange: () => void }): JSX.Element {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches)); }, []);
  const label = dark ? '切换到浅色' : '切换到深色';
  return <button className="public-theme-toggle" type="button" title={label} aria-label={label} onClick={() => { setDark(!dark); onChange(); }}>{dark ? '☼' : '◐'}</button>;
}

export function PublicPreview({ title, description, footer, monitors, theme, showTags, lastHeartbeatOnly, showPoweredBy, customCss }: {
  title: string;
  description?: string;
  footer?: string;
  monitors: PublicMonitor[];
  theme: string;
  showTags: boolean;
  lastHeartbeatOnly: boolean;
  showPoweredBy: boolean;
  customCss?: string;
}): JSX.Element {
  return <>
    <style>{customCss || ''}</style>
    <main className="public-page preview-public" data-preview-theme={theme}>
      <header className="public-head"><div><h1 className="public-title">{title || '服务状态'}</h1><Markdown value={description} /></div><span className="muted">预览</span></header>
      <div className="public-list">{monitors.length ? monitors.map((monitor) => <PublicMonitorCard key={monitor.id} monitor={monitor} showTags={showTags} lastHeartbeatOnly={lastHeartbeatOnly} />) : <Empty title="暂无公开监控" note="添加监控到状态页分组。" />}</div>
      <Markdown value={footer} className="markdown-preview public-footer" />
      {showPoweredBy ? <div className="muted" style={{ marginTop: 18, fontSize: 11 }}>Powered by Pulseboard</div> : null}
    </main>
  </>;
}
