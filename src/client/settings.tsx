import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { PageHead } from './components';
import type { AdminSettings, User } from './types';

type Notify = (message: string, error?: boolean) => void;

export function SettingsView({ settings, user, setSettings, notify }: { settings: AdminSettings; user: User; setSettings: (settings: AdminSettings) => void; notify: Notify }): JSX.Element {
  const [entry, setEntry] = useState<{ type: 'dashboard' | 'status'; slug?: string }>({ type: 'dashboard' });
  const [pages, setPages] = useState<Array<{ slug: string; title: string }>>([]);
  const [username, setUsername] = useState(user.username);
  const [adminTheme, setAdminTheme] = useState(settings.theme);
  const [heartbeatPosition, setHeartbeatPosition] = useState(settings.heartbeatPosition);
  const [timeDisplay, setTimeDisplay] = useState(settings.timeDisplay);
  const [retention, setRetention] = useState(String(settings.historyRetentionDays));
  const [maxMonitors, setMaxMonitors] = useState(String(settings.maxMonitors));
  const [maxNodes, setMaxNodes] = useState(String(settings.maxNodesPerMonitor));
  const [maxJobs, setMaxJobs] = useState(String(settings.maxJobsPerTick));
  const [globalpingToken, setGlobalpingToken] = useState('');
  const [tokenDirty, setTokenDirty] = useState(false);

  useEffect(() => {
    api<{ entry: typeof entry; pages: Array<{ slug: string; title: string }> }>('/api/settings/entry-page')
      .then((data) => { setEntry(data.entry); setPages(data.pages || []); })
      .catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取入口设置', true));
  }, [notify]);

  const updateAdminSettings = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await api<{ settings: AdminSettings }>('/api/settings/admin', { method: 'PATCH', body: JSON.stringify({ theme: adminTheme, heartbeatPosition, timeDisplay }) });
      setSettings(data.settings);
      notify('后台设置已更新');
    } catch (reason) { notify(reason instanceof Error ? reason.message : '保存失败', true); }
  };

  const updateSystemSettings = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body: Record<string, unknown> = { historyRetentionDays: Number(retention), maxMonitors: Number(maxMonitors), maxNodesPerMonitor: Number(maxNodes), maxJobsPerTick: Number(maxJobs) };
      if (tokenDirty) body.globalpingToken = globalpingToken;
      const data = await api<{ settings: AdminSettings }>('/api/settings/admin', { method: 'PATCH', body: JSON.stringify(body) });
      setSettings(data.settings);
      setGlobalpingToken('');
      setTokenDirty(false);
      notify('探测配额已更新');
    } catch (reason) { notify(reason instanceof Error ? reason.message : '保存失败', true); }
  };

  const updateUsername = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User }>('/api/auth/username', { method: 'POST', body: JSON.stringify({ username, currentPassword: data.get('currentPassword') }) });
      notify('用户名已更新');
      event.currentTarget.reset();
      setUsername(result.user.username);
    } catch (reason) { notify(reason instanceof Error ? reason.message : '更新失败', true); }
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword'), confirmPassword: data.get('confirmPassword') }) });
      notify('密码已更新，请重新登录');
      window.setTimeout(() => { window.location.href = '/admin'; }, 700);
    } catch (reason) { notify(reason instanceof Error ? reason.message : '更新失败', true); }
  };

  const updateEntry = async (value: string) => {
    try {
      const payload = value === 'dashboard' ? { type: 'dashboard' } : { type: 'status', slug: value };
      const result = await api<{ entry: typeof entry }>('/api/settings/entry-page', { method: 'PATCH', body: JSON.stringify(payload) });
      setEntry(result.entry);
      notify('入口页面已更新');
    } catch (reason) { notify(reason instanceof Error ? reason.message : '更新失败', true); }
  };

  const clearAll = async () => {
    if (!window.confirm('清理所有监控的历史记录？')) return;
    try { await api('/api/history', { method: 'DELETE' }); notify('全部历史已清理'); } catch (reason) { notify(reason instanceof Error ? reason.message : '清理失败', true); }
  };

  return <>
    <PageHead kicker="Workspace" title="系统设置" note="管理入口页面、管理员密码和当前部署的探测配置。" />
    <div className="split">
      <section className="panel" style={{ padding: 20 }}><div className="section-head"><h2 className="section-title">入口页面</h2></div><div className="radio-list"><label className="radio-option"><input type="radio" checked={entry.type === 'dashboard'} onChange={() => updateEntry('dashboard')} />仪表盘</label>{pages.map((page) => <label className="radio-option" key={page.slug}><input type="radio" checked={entry.type === 'status' && entry.slug === page.slug} onChange={() => updateEntry(page.slug)} />状态页面 - {page.title}</label>)}</div></section>
      <section className="panel" style={{ padding: 20 }}><div className="section-head"><h2 className="section-title">修改用户名</h2></div><form onSubmit={updateUsername}><div className="field"><label>新用户名</label><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={64} required /></div><div className="field" style={{ marginTop: 15 }}><label>当前密码</label><input name="currentPassword" type="password" autoComplete="current-password" minLength={8} maxLength={128} required /></div><div className="form-actions"><button className="button primary" type="submit">更新用户名</button></div></form></section>
    </div>
    <div className="section"><div className="split">
      <section className="panel" style={{ padding: 20 }}><div className="section-head"><h2 className="section-title">后台外观</h2></div><form onSubmit={updateAdminSettings}><div className="field"><label>主题</label><select value={adminTheme} onChange={(event) => setAdminTheme(event.target.value as AdminSettings['theme'])}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div><div className="field" style={{ marginTop: 15 }}><label>心跳栏位置</label><select value={heartbeatPosition} onChange={(event) => setHeartbeatPosition(event.target.value as AdminSettings['heartbeatPosition'])}><option value="top">监控信息上方</option><option value="bottom">监控信息下方</option></select></div><div className="field" style={{ marginTop: 15 }}><label>时间显示</label><select value={timeDisplay} onChange={(event) => setTimeDisplay(event.target.value as AdminSettings['timeDisplay'])}><option value="relative">相对时间</option><option value="absolute">具体时间</option></select></div><div className="form-actions"><button className="button primary" type="submit">保存外观</button></div></form></section>
      <section className="panel" style={{ padding: 20 }}><div className="section-head"><h2 className="section-title">系统配额</h2></div><form onSubmit={updateSystemSettings}><div className="form-grid"><div className="field"><label>监控上限</label><input value={maxMonitors} onChange={(event) => setMaxMonitors(event.target.value)} type="number" min="1" max="1000" required /></div><div className="field"><label>每个监控节点上限</label><input value={maxNodes} onChange={(event) => setMaxNodes(event.target.value)} type="number" min="1" max="20" required /></div><div className="field"><label>每轮调度任务上限</label><input value={maxJobs} onChange={(event) => setMaxJobs(event.target.value)} type="number" min="1" max="100" required /></div><div className="field"><label>历史保留天数</label><input value={retention} onChange={(event) => setRetention(event.target.value)} type="number" min="0" max="3650" required /></div><div className="field full"><label>Globalping Token</label><input value={globalpingToken} onChange={(event) => { setGlobalpingToken(event.target.value); setTokenDirty(true); }} type="password" autoComplete="new-password" placeholder={settings.globalpingTokenConfigured ? '已配置，留空表示不修改' : '未配置，可选'} /><p className="page-note">当前状态：{settings.globalpingTokenConfigured ? '已配置' : '未配置'}。Token 保存在 D1 中。</p></div></div><div className="form-actions"><button className="button primary" type="submit">保存配额</button><button className="button ghost danger" type="button" onClick={clearAll}>立即清理历史</button></div></form></section>
    </div></div>
    <div className="section"><section className="panel" style={{ padding: 20 }}><div className="section-head"><h2 className="section-title">修改密码</h2></div><form onSubmit={updatePassword}><div className="field"><label>当前密码</label><input name="currentPassword" type="password" autoComplete="current-password" minLength={8} maxLength={128} required /></div><div className="field" style={{ marginTop: 15 }}><label>新密码</label><input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div><div className="field" style={{ marginTop: 15 }}><label>重复新密码</label><input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></div><div className="form-actions"><button className="button primary" type="submit">更新密码</button></div></form></section></div>
    <div className="section"><section className="panel"><div className="info-list"><div className="info-row"><span className="info-key">探测服务</span><span className="info-value">Worker + Check-Host + Globalping</span></div><div className="info-row"><span className="info-key">调度频率</span><span className="info-value">每分钟运行一次，按监控频率筛选</span></div><div className="info-row"><span className="info-key">状态判定</span><span className="info-value">多数探测失败才宕机</span></div><div className="info-row"><span className="info-key">登录账号</span><span className="info-value">{user.username}</span></div></div></section></div>
  </>;
}
