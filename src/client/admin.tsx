import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { Empty, HeartbeatBar, Modal, PageHead, StatusBadge, TagList } from './components';
import { MonitorForm, TagManager } from './monitoring';
import { SettingsView } from './settings';
import { StatusPagesView } from './status-pages';
import { NotificationsView } from './notifications';
import type { AdminSettings, CheckResult, GlobalpingProbe, Monitor, StatusPage, Tag, User } from './types';
import { formatAdminDate, formatDate, formatMs, providerLabel, statusLabel, typeLabel } from './utils';

type View = 'overview' | 'monitors' | 'history' | 'globalping' | 'notifications' | 'status-pages' | 'settings' | 'about';
type Notify = (message: string, error?: boolean) => void;

function Brand(): JSX.Element {
  return <div className="brand"><div className="brand-mark">P</div><div className="brand-copy"><div className="brand-name">Pulseboard</div><div className="brand-sub">uptime control room</div></div></div>;
}

function AuthPage({ setup, onAuthenticated }: { setup: boolean; onAuthenticated: (user: User) => void }): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ user: User }>(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      onAuthenticated(result.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '请求失败'); setBusy(false); }
  };
  return <main className="auth-page"><section className="auth-box"><Brand /><h1 className="auth-title">{setup ? '建立管理员' : '登录控制台'}</h1><p className="auth-note">{setup ? '首次使用，请创建一个管理员账号。账号只保存在你的 D1 数据库中。' : '登录后管理监控和公开状态页。'}</p>{error ? <div className="notice warning" style={{ marginBottom: 16 }}>{error}</div> : null}<form onSubmit={submit}><div className="field"><label>用户名</label><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={64} /></div><div className="field"><label>密码</label><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={8} /></div><button className="button primary" type="submit" disabled={busy}>{setup ? '创建并进入' : '登录控制台'}</button></form></section></main>;
}

function Toast({ message, error }: { message: string; error: boolean }): JSX.Element | null {
  if (!message) return null;
  return <div className={`toast${error ? ' error' : ''}`}>{message}</div>;
}

function Shell({ user, view, setView, onLogout, onRefresh, children }: { user: User; view: View; setView: (view: View) => void; onLogout: () => void; onRefresh: () => void; children: ReactNode }): JSX.Element {
  const nav: Array<[View, string, string]> = [['overview', '◉', '总览'], ['monitors', '◌', '监控管理'], ['history', '▤', '检查记录'], ['globalping', '⌁', 'Globalping 节点'], ['notifications', '✦', '通知设置'], ['status-pages', '□', '公开状态页'], ['settings', '⚙', '系统设置'], ['about', 'ⓘ', '关于']];
  return <div className="app-shell"><aside className="sidebar"><Brand /><div className="nav-label">Workspace</div><nav className="nav">{nav.map(([id, glyph, label]) => <button className={`nav-button ${view === id ? 'active' : ''}`} key={id} type="button" onClick={() => setView(id)}><span className="nav-glyph">{glyph}</span><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="user-line"><span>{user.username}</span><button className="button text-button" type="button" onClick={onLogout}>退出</button></div><div>Worker + Globalping</div></div></aside><main className="main"><header className="topbar"><span className="topbar-title">单 Worker · D1 · 可用性监控</span><div className="topbar-actions"><span className="muted">每分钟调度</span><button className="button small ghost" type="button" onClick={onRefresh}>刷新</button></div></header><div className="content">{children}</div></main></div>;
}

function OverviewView({ onNavigate, notify }: { onNavigate: (view: View) => void; notify: Notify }): JSX.Element {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Array<Record<string, any>>>([]);
  useEffect(() => { api<{ monitors: Monitor[]; counts: Record<string, number>; recentResults: Array<Record<string, any>> }>('/api/dashboard').then((data) => { setMonitors(data.monitors); setCounts(data.counts); setRecent(data.recentResults || []); }).catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取总览', true)); }, [notify]);
  return <><PageHead kicker="Control room" title="运行总览" note="查看所有监控的最新状态和最近一次地区探测。" /><div className="metric-grid"><div className="metric"><div className="metric-label">正常</div><div className="metric-value mint">{counts.up || 0}</div></div><div className="metric"><div className="metric-label">部分异常</div><div className="metric-value amber">{counts.degraded || 0}</div></div><div className="metric"><div className="metric-label">宕机</div><div className="metric-value red">{counts.down || 0}</div></div><div className="metric"><div className="metric-label">已暂停</div><div className="metric-value">{counts.paused || 0}</div></div></div><section className="section"><div className="section-head"><h2 className="section-title">监控状态</h2><button className="button small" type="button" onClick={() => onNavigate('monitors')}>管理监控</button></div><div className="panel table-wrap">{monitors.length ? <table><thead><tr><th>监控</th><th>类型</th><th>状态</th><th>探测范围</th><th>最近检查</th><th /></tr></thead><tbody>{monitors.map((monitor) => <tr key={monitor.id}><td><div className="monitor-name">{monitor.name}</div><div className="target">{monitor.targetUrl || (monitor.type === 'tcp' ? `${monitor.host}:${monitor.port}` : monitor.host || '—')}</div><TagList tags={monitor.tags} /></td><td><span className="tag">{typeLabel(monitor.type)}</span> <span className="tag">{providerLabel(monitor.provider)}</span></td><td><StatusBadge status={monitor.enabled ? monitor.currentStatus : 'paused'} /></td><td>{monitor.provider === 'worker' ? '本地 Worker' : `${monitor.provider === 'globalping' ? monitor.globalpingLocations.length : monitor.nodes.length} 个位置`}</td><td>{formatDate(monitor.lastCheckedAt)}</td><td><div className="actions"><button className="button small ghost" type="button" onClick={() => onNavigate('history')}>记录</button></div></td></tr>)}</tbody></table> : <Empty title="还没有监控" note="创建第一个 HTTP、TCP 或 Ping 监控开始使用。" />}</div></section><section className="section"><div className="section-head"><h2 className="section-title">最近探测</h2><span className="muted">按节点记录</span></div><div className="panel table-wrap">{recent.length ? <table><thead><tr><th>监控</th><th>地区</th><th>结果</th><th>耗时</th><th>状态码</th><th>时间</th></tr></thead><tbody>{recent.map((result, index) => <tr key={`${result.monitor_id}-${result.checked_at}-${index}`}><td className="monitor-name">{result.monitor_name}</td><td>{result.country_name} · {result.city}</td><td><StatusBadge status={result.success ? 'up' : 'down'} /></td><td>{formatMs(result.latency_ms)}</td><td>{result.status_code || '—'}</td><td>{formatDate(result.checked_at)}</td></tr>)}</tbody></table> : <Empty title="暂无检查记录" note="任务完成后，节点结果会显示在这里。" />}</div></section></>;
}

function HistoryView({ notify }: { notify: Notify }): JSX.Element {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monitorId, setMonitorId] = useState('');
  const [results, setResults] = useState<CheckResult[]>([]);
  useEffect(() => { api<{ monitors: Monitor[] }>('/api/monitors').then((data) => { setMonitors(data.monitors); setMonitorId((current) => current || data.monitors[0]?.id || ''); }).catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取监控', true)); }, [notify]);
  useEffect(() => { if (!monitorId) return; api<{ results: CheckResult[] }>(`/api/monitors/${monitorId}/results?limit=250`).then((data) => setResults(data.results)).catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取历史', true)); }, [monitorId, notify]);
  const clear = async (all: boolean) => { if (!window.confirm(all ? '清理所有监控的历史记录？' : '清理当前监控的全部历史记录？')) return; try { await api(all ? '/api/history' : `/api/monitors/${monitorId}/history`, { method: 'DELETE' }); setResults([]); notify(all ? '全部历史已清理' : '当前监控历史已清理'); } catch (reason) { notify(reason instanceof Error ? reason.message : '清理失败', true); } };
  const monitor = monitors.find((item) => item.id === monitorId);
  return <><PageHead kicker="Check history" title="检查记录" note="查看每个探测节点的原始结果；系统不会单独创建故障事件。" action={<button className="button small ghost danger" type="button" onClick={() => clear(true)}>清理全部历史</button>} /><div className="filter-bar"><select value={monitorId} onChange={(event) => setMonitorId(event.target.value)}><option value="">选择监控</option>{monitors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="button small ghost danger" type="button" disabled={!monitorId} onClick={() => clear(false)}>清理当前监控</button></div><div className="panel table-wrap">{monitor ? results.length ? <table><thead><tr><th>节点</th><th>结果</th><th>耗时</th><th>状态码</th><th>说明</th><th>时间</th></tr></thead><tbody>{results.map((item, index) => <tr key={`${item.nodeId}-${item.checkedAt}-${index}`}><td>{item.node ? `${item.node.countryName} · ${item.node.city}` : item.nodeId}</td><td><StatusBadge status={item.success ? 'up' : 'down'} /></td><td>{formatMs(item.latencyMs)}</td><td>{item.statusCode || '—'}</td><td>{item.message || '—'}</td><td>{formatDate(item.checkedAt)}</td></tr>)}</tbody></table> : <Empty title="暂无记录" note="下一次探测任务完成后会显示结果。" /> : <Empty title="暂无监控" note="创建监控后会产生检查记录。" />}</div></>;
}

function GlobalpingProbesView({ notify }: { notify: Notify }): JSX.Element {
  const [probes, setProbes] = useState<GlobalpingProbe[]>([]);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const load = useCallback(() => {
    setLoading(true);
    api<{ probes: GlobalpingProbe[]; updatedAt: string }>('/api/globalping/probes')
      .then((data) => { setProbes(data.probes || []); setUpdatedAt(data.updatedAt || null); setPage(1); })
      .catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取 Globalping 节点', true))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const countries = useMemo(() => [...new Set(probes.map((probe) => probe.countryCode))].sort(), [probes]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return probes.filter((probe) => {
      const matchesSearch = !needle || [probe.id, probe.countryCode, probe.city, probe.network || '', probe.asn || '', probe.ip || '', ...probe.resolvers]
        .some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesSearch && (!country || probe.countryCode === country) && (!status || (status === 'online' ? probe.online : !probe.online));
    });
  }, [probes, search, country, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const onlineCount = probes.filter((probe) => probe.online).length;
  const cityCount = new Set(probes.map((probe) => `${probe.countryCode}\u0000${probe.city}`)).size;
  const updateSearch = (value: string) => { setSearch(value); setPage(1); };
  const updateCountry = (value: string) => { setCountry(value); setPage(1); };
  const updateStatus = (value: string) => { setStatus(value); setPage(1); };

  return <><PageHead kicker="Globalping" title="探测节点" note="查看 Globalping 当前公开的全部可用探针。" action={<button className="button small ghost" type="button" onClick={load} disabled={loading}>{loading ? '读取中…' : '刷新节点'}</button>} /><div className="metric-grid probe-metric-grid"><div className="metric"><div className="metric-label">全部节点</div><div className="metric-value">{probes.length}</div></div><div className="metric"><div className="metric-label">可用节点</div><div className="metric-value mint">{onlineCount}</div></div><div className="metric"><div className="metric-label">国家</div><div className="metric-value">{countries.length}</div></div><div className="metric"><div className="metric-label">城市</div><div className="metric-value">{cityCount}</div></div></div><div className="section"><div className="filter-bar"><input className="filter-search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="搜索 ID、国家、城市、网络、IP 或 ASN" /><select value={country} onChange={(event) => updateCountry(event.target.value)}><option value="">全部国家</option>{countries.map((item) => <option value={item} key={item}>{item}</option>)}</select></div><div className="section-head probe-list-head"><h2 className="section-title">节点列表</h2><span className="muted">{loading ? '正在读取 Globalping 节点…' : `显示 ${filtered.length} 个匹配节点${updatedAt ? ` · 更新于 ${formatDate(updatedAt)}` : ''}`}</span></div><div className="panel table-wrap">{visible.length ? <table><thead><tr><th>状态</th><th>节点 ID</th><th>国家</th><th>城市</th><th>网络</th><th>ASN</th><th>Resolver</th></tr></thead><tbody>{visible.map((probe) => <tr key={probe.id}><td><span className={`probe-status ${probe.online ? 'online' : 'offline'}`}><i className="status-dot" />{probe.online ? '在线' : '离线'}</span></td><td className="mono">{probe.id}</td><td>{probe.countryCode}</td><td>{probe.city}</td><td>{probe.network || '—'}</td><td className="mono">{probe.asn || '—'}</td><td className="mono">{probe.resolvers.length ? probe.resolvers.join(', ') : '—'}</td></tr>)}</tbody></table> : <Empty title={loading ? '正在读取节点' : probes.length ? '没有匹配节点' : '暂无节点数据'} note={loading ? '正在从 Globalping 获取完整探针列表。' : probes.length ? '调整搜索或筛选条件。' : 'Globalping 没有返回可显示的探针。'} />}</div>{filtered.length ? <div className="pagination"><button className="button small ghost" type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span className="muted">第 {currentPage} / {pageCount} 页</span><button className="button small ghost" type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button></div> : null}</div></>;
}

function AboutView({ settings, user }: { settings: AdminSettings; user: User }): JSX.Element {
  return <><PageHead kicker="About" title="关于" note="当前部署使用的运行时、探测服务和存储边界。" /><div className="about-grid"><div className="about-item"><strong>Pulseboard</strong><span>Cloudflare Worker 上的可用性监控控制台与公开状态页。</span></div><div className="about-item"><strong>Worker + D1</strong><span>单 Worker 提供 API、调度和页面；D1 保存监控、心跳、标签和状态页配置。</span></div><div className="about-item"><strong>Worker + Globalping</strong><span>支持 HTTP、TCP 端口和 Globalping Ping 检查，当前调度间隔为 1 分钟。</span></div></div><section className="section"><div className="panel"><div className="info-list"><div className="info-row"><span className="info-key">公开页面</span><span className="info-value">/status/&lt;slug&gt;</span></div><div className="info-row"><span className="info-key">RSS</span><span className="info-value">/status/&lt;slug&gt;/rss.xml</span></div><div className="info-row"><span className="info-key">当前账号</span><span className="info-value">{user.username}</span></div><div className="info-row"><span className="info-key">历史策略</span><span className="info-value">{settings.historyRetentionDays === 0 ? '永久保留' : `${settings.historyRetentionDays} 天`}</span></div></div></div></section></>;
}

export function AdminApp(): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('overview');
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [toast, setToast] = useState({ message: '', error: false });
  const notify: Notify = (message, error = false) => { setToast({ message, error }); window.setTimeout(() => setToast({ message: '', error: false }), 3600); };
  const loadStatus = async () => { try { const data = await api<{ setupRequired: boolean; authenticated: boolean; user: User | null }>('/api/auth/status'); setSetupRequired(data.setupRequired); setUser(data.user); } catch (reason) { notify(reason instanceof Error ? reason.message : '无法连接数据库', true); } finally { setLoading(false); } };
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { if (!user) return; api<{ settings: AdminSettings }>('/api/settings/admin').then((data) => setSettings(data.settings)).catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取设置', true)); }, [user]);
  if (loading) return <main className="auth-page"><section className="auth-box"><Brand /><p className="auth-note">正在连接控制台...</p></section></main>;
  if (setupRequired) return <AuthPage setup onAuthenticated={(next) => { setUser(next); setSetupRequired(false); }} />;
  if (!user) return <AuthPage setup={false} onAuthenticated={setUser} />;
  if (!settings) return <main className="auth-page"><section className="auth-box"><Brand /><p className="auth-note">正在读取后台设置...</p></section></main>;
  const refresh = () => { if (view === 'settings') setSettings(null); else setView(view); window.location.reload(); };
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); setSettings(null); };
  let content: JSX.Element;
  if (view === 'overview') content = <OverviewView onNavigate={setView} notify={notify} />;
  else if (view === 'monitors') content = <MonitorView settings={settings} notify={notify} />;
  else if (view === 'history') content = <HistoryView notify={notify} />;
  else if (view === 'globalping') content = <GlobalpingProbesView notify={notify} />;
  else if (view === 'notifications') content = <NotificationsView notify={notify} />;
  else if (view === 'status-pages') content = <StatusPagesView notify={notify} />;
  else if (view === 'settings') content = <SettingsView settings={settings} user={user} setSettings={setSettings} notify={notify} />;
  else content = <AboutView settings={settings} user={user} />;
  return <><Shell user={user} view={view} setView={setView} onLogout={logout} onRefresh={refresh}>{content}</Shell><Toast message={toast.message} error={toast.error} /></>;
}

interface MonitorViewProps { settings: AdminSettings; notify: Notify; }

function MonitorView({ settings, notify }: MonitorViewProps): JSX.Element {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [tagId, setTagId] = useState('');
  const [modal, setModal] = useState<'monitor' | 'tags' | null>(null);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const load = async () => { try { const monitorData = await api<{ monitors: Monitor[]; tags: Tag[] }>('/api/monitors?includeHistory=1'); setMonitors(monitorData.monitors); setTags(monitorData.tags || []); } catch (reason) { notify(reason instanceof Error ? reason.message : '无法读取监控', true); } };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => monitors.filter((monitor) => { const currentStatus = monitor.enabled ? monitor.currentStatus : 'paused'; const needle = search.toLocaleLowerCase(); return (!needle || [monitor.name, monitor.targetUrl || '', monitor.host || '', ...(monitor.tags || []).map((item) => item.name)].some((value) => value.toLocaleLowerCase().includes(needle))) && (!status || currentStatus === status) && (!tagId || (monitor.tags || []).some((tag) => tag.id === tagId)); }), [monitors, search, status, tagId]);
  const action = async (path: string, options: RequestInit, message: string) => { try { await api(path, options); notify(message); await load(); } catch (reason) { notify(reason instanceof Error ? reason.message : '操作失败', true); } };
  return <><PageHead kicker="Monitors" title="监控管理" note="每个监控每分钟发起一次检查，可按监控选择 Worker 或 Globalping。" action={<button className="button primary" type="button" onClick={() => { setEditing(null); setModal('monitor'); }}>＋ 新建监控</button>} /><div className="filter-bar"><input className="filter-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、地址或标签" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="up">正常</option><option value="degraded">部分异常</option><option value="down">宕机</option><option value="unknown">待探测</option><option value="paused">已暂停</option></select><select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">全部标签</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select><button className="button small ghost" type="button" onClick={() => setModal('tags')}>管理标签</button></div><div className="panel table-wrap">{filtered.length ? <table><thead><tr><th>监控 / 最近心跳</th><th>类型</th><th>状态</th><th>探测范围</th><th>最近检查</th><th /></tr></thead><tbody>{filtered.map((monitor) => <tr key={monitor.id}><td><div className="monitor-name">{monitor.name}</div><div className="target">{monitor.targetUrl || (monitor.type === 'tcp' ? `${monitor.host}:${monitor.port}` : monitor.host || '—')}</div><TagList tags={monitor.tags} /><div className="heartbeat-cell"><HeartbeatBar history={monitor.history} timeDisplay={settings.timeDisplay} /></div></td><td><span className="tag">{typeLabel(monitor.type)}</span> <span className="tag">{providerLabel(monitor.provider)}</span></td><td><StatusBadge status={monitor.enabled ? monitor.currentStatus : 'paused'} /></td><td>{monitor.provider === 'globalping' ? `${monitor.globalpingLocations.length} 个位置` : '本地 Worker'}</td><td>{formatAdminDate(monitor.lastCheckedAt, settings.timeDisplay)}</td><td><div className="actions"><button className="button small" type="button" onClick={() => action(`/api/monitors/${monitor.id}/check-now`, { method: 'POST' }, '检查任务已提交')}>立即检查</button><button className="button small ghost" type="button" onClick={() => { setEditing(monitor); setModal('monitor'); }}>编辑</button><button className="button small ghost" type="button" onClick={() => action(`/api/monitors/${monitor.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !monitor.enabled }) }, monitor.enabled ? '监控已暂停' : '监控已启用')}>{monitor.enabled ? '暂停' : '启用'}</button><button className="button small ghost" type="button" onClick={() => { if (window.confirm('清理这个监控的全部历史记录？')) action(`/api/monitors/${monitor.id}/history`, { method: 'DELETE' }, '历史记录已清理'); }}>清理历史</button><button className="button small ghost danger" type="button" onClick={() => { if (window.confirm('删除这个监控及其历史记录？')) action(`/api/monitors/${monitor.id}`, { method: 'DELETE' }, '监控已删除'); }}>删除</button></div></td></tr>)}</tbody></table> : <Empty title="没有匹配的监控" note="调整搜索或筛选条件。" />}</div>{modal === 'monitor' ? <MonitorForm monitor={editing} tags={tags} maxNodesPerMonitor={settings.maxNodesPerMonitor} notify={notify} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} /> : null}{modal === 'tags' ? <TagManager tags={tags} setTags={setTags} notify={notify} onClose={() => setModal(null)} /> : null}</>;
}
