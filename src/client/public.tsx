import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Empty, Markdown, PublicMonitorCard, ThemeToggle } from './components';
import type { PublicGroup, PublicMonitor, PublicPage } from './types';
import { formatDate } from './utils';

interface PublicResponse {
  page: PublicPage;
  groups?: PublicGroup[];
  monitors: PublicMonitor[];
  generatedAt: string;
}

function applyPublicTheme(configured: string): void {
  const saved = localStorage.getItem('public-theme');
  const theme = saved === 'light' || saved === 'dark' ? saved : configured;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function PublicPageView({ slug }: { slug: string | null }): JSX.Element {
  const [data, setData] = useState<PublicResponse | null>(null);
  const [error, setError] = useState('');
  const endpoint = slug ? `/api/public/status/${encodeURIComponent(slug)}` : '/api/public/home';

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const result = await api<PublicResponse>(endpoint);
        if (!active) return;
        setData(result);
        applyPublicTheme(result.page.theme || 'auto');
        const seconds = Math.min(Math.max(Number(result.page.refreshSeconds) || 300, 30), 86400);
        timer = window.setTimeout(load, seconds * 1000);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : '状态页不存在');
      }
    };
    load();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [endpoint]);

  const groups = useMemo(() => {
    if (!data) return [];
    return data.groups?.length ? data.groups : [{ name: '服务', monitors: data.monitors }];
  }, [data]);

  if (error) return <main className="public-page"><div className="public-inner"><div className="notice warning">{error}</div></div></main>;
  if (!data) return <main className="public-page"><div className="public-inner"><div className="empty">正在读取状态页...</div></div></main>;

  const page = data.page;
  const showTags = page.showTags !== 0;
  const lastHeartbeatOnly = page.lastHeartbeatOnly === 1;
  return <>
    <style>{page.customCss || ''}</style>
    <main className="public-page">
      <div className="public-inner">
        <header className="public-head">
          <div><h1 className="public-title">{page.title}</h1><Markdown value={page.description} /></div>
          <div className="public-head-actions"><div className="public-updated">更新于<br />{formatDate(data.generatedAt)}</div>{slug ? <a className="public-rss-link" href={`/status/${encodeURIComponent(slug)}/rss.xml`} target="_blank" rel="noreferrer">RSS</a> : null}<ThemeToggle onChange={() => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('public-theme', next); document.documentElement.dataset.theme = next; }} /></div>
        </header>
        {groups.length ? groups.map((group) => <section className="public-group" key={group.id || group.name}><h2 className="public-group-title">{group.name}</h2><div className="public-list">{group.monitors.length ? group.monitors.map((monitor) => <PublicMonitorCard key={monitor.id} monitor={monitor} showTags={showTags} lastHeartbeatOnly={lastHeartbeatOnly} />) : <Empty title="暂无公开监控" note="管理员还没有把监控加入这个分组。" />}</div></section>) : <Empty title="暂无公开监控" note="管理员还没有把监控加入这个状态页。" />}
        <Markdown value={page.footer} className="markdown-preview public-footer" />
        {page.showPoweredBy !== 0 ? <div className="public-powered">Powered by Pulseboard · <a href="/admin">管理员入口</a></div> : null}
      </div>
    </main>
  </>;
}
