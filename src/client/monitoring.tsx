import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { Modal, TagChip } from './components';
import { defaultNotificationRule, NotificationBindingsPanel, NotificationEditor } from './notifications';
import type { GlobalpingLocation, Monitor, MonitorNotificationBinding, MonitorNotificationRule, MonitorNotificationSettings, NotificationChannel, Tag } from './types';
import { globalpingKey } from './utils';

type Notify = (message: string, error?: boolean) => void;
type Provider = 'worker' | 'globalping';
type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface MonitorFormProps {
  monitor: Monitor | null;
  tags: Tag[];
  notify: Notify;
  onClose: () => void;
  onSaved: () => void;
}

export function MonitorForm({ monitor, tags, notify, onClose, onSaved }: MonitorFormProps): JSX.Element {
  const [name, setName] = useState(monitor?.name || '');
  const [type, setType] = useState<'http' | 'tcp'>(monitor?.type || 'http');
  const [provider, setProvider] = useState<Provider>(monitor?.provider || 'worker');
  const [httpMethod, setHttpMethod] = useState<HttpMethod>(monitor?.httpMethod || 'GET');
  const [url, setUrl] = useState(monitor?.targetUrl || '');
  const [host, setHost] = useState(monitor?.host || '');
  const [port, setPort] = useState(String(monitor?.port || ''));
  const [intervalMinutes, setIntervalMinutes] = useState(String(Math.max(1, Math.round((monitor?.intervalSeconds || 60) / 60))));
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(monitor?.timeoutSeconds || 10));
  const [requestHeaders, setRequestHeaders] = useState(JSON.stringify(monitor?.requestHeaders || {}, null, 2));
  const [requestBody, setRequestBody] = useState(monitor?.requestBody || '');
  const [expectedStatusCodes, setExpectedStatusCodes] = useState((monitor?.expectedStatusCodes || []).join(', '));
  const [responseKeyword, setResponseKeyword] = useState(monitor?.responseKeyword || '');
  const [enabled, setEnabled] = useState(monitor?.enabled !== 0);
  const [tagIds, setTagIds] = useState<string[]>(monitor?.tags?.map((tag) => tag.id) || []);
  const [locations, setLocations] = useState<GlobalpingLocation[]>(monitor?.globalpingLocations || []);
  const [knownLocations, setKnownLocations] = useState<GlobalpingLocation[]>([]);
  const [notificationBindings, setNotificationBindings] = useState<MonitorNotificationBinding[]>([]);
  const [notificationRule, setNotificationRule] = useState<MonitorNotificationRule>({ ...defaultNotificationRule });
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationEditorOpen, setNotificationEditorOpen] = useState(false);
  const [notificationEditorChannel, setNotificationEditorChannel] = useState<NotificationChannel | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveGlobalping = type === 'http' && provider === 'globalping';
  const effectiveWorker = provider === 'worker';

  useEffect(() => {
    if (!effectiveGlobalping || knownLocations.length) return;
    api<{ locations: GlobalpingLocation[] }>('/api/globalping/locations')
      .then((data) => setKnownLocations(data.locations || []))
      .catch((reason) => notify(reason instanceof Error ? reason.message : '无法读取 Globalping 位置', true));
  }, [effectiveGlobalping, knownLocations.length, notify]);

  useEffect(() => {
    if (type === 'tcp' && provider === 'globalping') setProvider('worker');
  }, [type, provider]);

  const loadNotificationSettings = async () => {
    setNotificationLoading(true);
    try {
      if (monitor) {
        const data = await api<MonitorNotificationSettings>(`/api/monitors/${monitor.id}/notifications`);
        setNotificationBindings(data.channels || []);
        setNotificationRule(data.rule || { ...defaultNotificationRule });
      } else {
        const data = await api<{ channels: NotificationChannel[] }>('/api/notifications');
        setNotificationBindings((data.channels || []).map((channel) => ({ channelId: channel.id, name: channel.name, type: channel.type, defaultEnabled: channel.defaultEnabled, enabled: channel.defaultEnabled })));
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '无法读取通知配置', true);
    } finally {
      setNotificationLoading(false);
    }
  };

  useEffect(() => { loadNotificationSettings(); }, [monitor?.id]);

  const toggle = (values: string[], value: string, setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const selectedLocation = (location: GlobalpingLocation) => locations.some((item) => globalpingKey(item) === globalpingKey(location));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    let headers: Record<string, string>;
    let statuses: number[];
    try {
      const parsed = requestHeaders.trim() ? JSON.parse(requestHeaders) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求头必须是 JSON 对象');
      headers = parsed as Record<string, string>;
      statuses = expectedStatusCodes.trim()
        ? [...new Set(expectedStatusCodes.split(/[,\s]+/).filter(Boolean).map(Number))]
        : [];
      if (statuses.some((value) => !Number.isInteger(value) || value < 100 || value > 599)) throw new Error('成功状态码格式不正确');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'HTTP 高级参数格式不正确', true);
      setBusy(false);
      return;
    }
    const payload: Record<string, unknown> = {
      name,
      type,
      provider,
      httpMethod: type === 'http' ? httpMethod : 'GET',
      intervalMinutes: Number(intervalMinutes),
      timeoutSeconds: Number(timeoutSeconds),
      requestHeaders: type === 'http' && effectiveWorker ? headers : {},
      requestBody: type === 'http' && effectiveWorker ? requestBody : '',
      expectedStatusCodes: type === 'http' && effectiveWorker ? statuses : [],
      responseKeyword: type === 'http' && effectiveWorker ? responseKeyword : '',
      globalpingLocations: effectiveGlobalping ? locations : [],
      tagIds,
      enabled,
    };
    if (type === 'http') payload.url = url;
    else {
      payload.host = host;
      payload.port = Number(port);
    }
    try {
      const result = await api<{ monitor: Monitor }>(monitor ? `/api/monitors/${monitor.id}` : '/api/monitors', { method: monitor ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      await api(`/api/monitors/${result.monitor.id}/notifications`, {
        method: 'PUT',
        body: JSON.stringify({
          bindings: notificationBindings.map((binding) => ({ channelId: binding.channelId, enabled: binding.enabled === 1 })),
          rule: {
            enabled: notificationRule.enabled === 1,
            notifyOnDegraded: notificationRule.notifyOnDegraded === 1,
            notifyOnDown: notificationRule.notifyOnDown === 1,
            notifyOnRecovery: notificationRule.notifyOnRecovery === 1,
            failureThreshold: notificationRule.failureThreshold,
          },
        }),
      });
      notify(monitor ? '监控已更新' : '监控已创建');
      onSaved();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '保存失败', true);
      setBusy(false);
    }
  };

  const mergedLocations = [...new Map([...knownLocations, ...locations].map((location) => [globalpingKey(location), location])).values()];
  return <>
    <Modal onClose={onClose} className="monitor-modal">
      <div className="modal-head"><div><div className="page-kicker">Monitor setup</div><h2>{monitor ? '编辑监控' : '新建监控'}</h2></div></div>
      <form onSubmit={submit}>
        <div className="monitor-form-layout">
          <div>
            <div className="form-grid">
              <div className="field full"><label>名称</label><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="例如：主站健康检查" /></div>
              <div className="field full"><label>标签</label><div className="check-row">{tags.length ? tags.map((tag) => <label className="check-option" key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggle(tagIds, tag.id, setTagIds)} /><TagChip tag={tag} /></label>) : <span className="muted">还没有标签，可在监控管理中创建。</span>}</div></div>
              <div className="field"><label>类型</label><select value={type} onChange={(event) => setType(event.target.value as 'http' | 'tcp')}><option value="http">HTTP / HTTPS</option><option value="tcp">TCP 端口</option></select></div>
              <div className="field"><label>检查频率（分钟）</label><input value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} type="number" min="1" max="60" required /></div>
              <div className="field"><label>探测服务</label><select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="worker">Worker（本地）</option><option value="globalping">Globalping（多地区）</option></select></div>
              {type === 'http' ? <div className="field"><label>HTTP 方法</label><select value={httpMethod} onChange={(event) => setHttpMethod(event.target.value as HttpMethod)}>{(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((method) => <option key={method} value={method}>{method}</option>)}</select></div> : <div className="field"><label>连接超时（秒）</label><input value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} type="number" min="1" max="30" required /></div>}
              {type === 'http' ? <div className="field full"><label>URL</label><input value={url} onChange={(event) => setUrl(event.target.value)} type="url" maxLength={2048} placeholder="https://example.com/health" required /></div> : <><div className="field"><label>主机</label><input value={host} onChange={(event) => setHost(event.target.value)} maxLength={253} placeholder="db.example.com" required /></div><div className="field"><label>端口</label><input value={port} onChange={(event) => setPort(event.target.value)} type="number" min="1" max="65535" placeholder="443" required /></div></>}
              {type === 'http' && effectiveWorker ? <>
                <div className="field"><label>请求超时（秒）</label><input value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} type="number" min="1" max="30" required /></div>
                <div className="field"><label>成功状态码</label><input value={expectedStatusCodes} onChange={(event) => setExpectedStatusCodes(event.target.value)} placeholder="留空表示 200-399" /></div>
                <div className="field full"><label>请求头（JSON）</label><textarea value={requestHeaders} onChange={(event) => setRequestHeaders(event.target.value)} rows={4} placeholder={'{"Authorization":"Bearer ..."}'} /></div>
                <div className="field full"><label>请求体</label><textarea value={requestBody} onChange={(event) => setRequestBody(event.target.value)} rows={4} placeholder="POST / PUT / PATCH 请求体，可填写 JSON 或文本" /></div>
                <div className="field full"><label>响应关键字</label><input value={responseKeyword} onChange={(event) => setResponseKeyword(event.target.value)} maxLength={1000} placeholder="响应正文必须包含的文本，可留空" /></div>
              </> : null}
              {effectiveGlobalping ? <div className="field full"><label>Globalping 探测位置（最多由系统设置限制）</label><div className="node-picker">{mergedLocations.length ? mergedLocations.map((location) => <label className="node-option" key={globalpingKey(location)}><input type="checkbox" checked={selectedLocation(location)} onChange={() => setLocations(selectedLocation(location) ? locations.filter((item) => globalpingKey(item) !== globalpingKey(location)) : [...locations, { country: location.country, ...(location.city ? { city: location.city } : {}) }])} /><span><strong>{location.country} · {location.city || '全境'}</strong><div className="node-meta">{location.probes || 1} 个在线探针，按位置随机选择</div></span></label>) : <div className="notice warning">暂无可用 Globalping 位置，请稍后刷新重试。</div>}</div></div> : null}
              <div className="field full"><label className="node-option" style={{ padding: 0, border: 0 }}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>创建后立即启用</span></label></div>
            </div>
          </div>
          <NotificationBindingsPanel channels={notificationBindings} rule={notificationRule} onBindingsChange={setNotificationBindings} onRuleChange={setNotificationRule} onManage={() => { setNotificationEditorChannel(null); setNotificationEditorOpen(true); }} onEdit={async (channelId) => { try { const data = await api<{ channels: NotificationChannel[] }>('/api/notifications'); const channel = data.channels.find((item) => item.id === channelId); if (!channel) { notify('通知配置不存在', true); return; } setNotificationEditorChannel(channel); setNotificationEditorOpen(true); } catch (reason) { notify(reason instanceof Error ? reason.message : '无法读取通知配置', true); } }} />
        </div>
        <div className="notice" style={{ marginTop: 18 }}>{effectiveWorker ? 'Worker 直接从 Cloudflare 发起 HTTP 或 TCP 检查，适合 API 和端口可用性。' : 'Globalping 按国家和城市规则随机选择在线探针。'} </div>
        <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || notificationLoading}>{notificationLoading ? '读取通知…' : monitor ? '保存修改' : '创建监控'}</button></div>
      </form>
    </Modal>
    {notificationEditorOpen ? <NotificationEditor channel={notificationEditorChannel} notify={notify} onClose={() => setNotificationEditorOpen(false)} onSaved={() => { setNotificationEditorOpen(false); loadNotificationSettings(); }} /> : null}
  </>;
}

export function TagManager({ tags, setTags, notify, onClose }: { tags: Tag[]; setTags: (tags: Tag[]) => void; notify: Notify; onClose: () => void }): JSX.Element {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#5ee0b2');
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({});
  const refresh = async () => { const data = await api<{ tags: Tag[] }>('/api/tags'); setTags(data.tags || []); };
  const create = async (event: FormEvent) => { event.preventDefault(); try { await api('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }); await refresh(); setName(''); setColor('#5ee0b2'); notify('标签已创建'); } catch (reason) { notify(reason instanceof Error ? reason.message : '创建失败', true); } };
  const update = async (tag: Tag) => { const draft = drafts[tag.id] || { name: tag.name, color: tag.color }; try { await api(`/api/tags/${tag.id}`, { method: 'PATCH', body: JSON.stringify(draft) }); await refresh(); notify('标签已更新'); } catch (reason) { notify(reason instanceof Error ? reason.message : '更新失败', true); } };
  const remove = async (tag: Tag) => { if (!window.confirm('删除这个标签？监控本身不会被删除。')) return; try { await api(`/api/tags/${tag.id}`, { method: 'DELETE' }); await refresh(); notify('标签已删除'); } catch (reason) { notify(reason instanceof Error ? reason.message : '删除失败', true); } };
  return <Modal onClose={onClose}><div className="modal-head"><div><div className="page-kicker">Monitor labels</div><h2>管理标签</h2></div></div><div>{tags.length ? tags.map((tag) => { const draft = drafts[tag.id] || { name: tag.name, color: tag.color }; return <div className="info-row" key={tag.id}><span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}><input value={draft.name} maxLength={40} onChange={(event) => setDrafts({ ...drafts, [tag.id]: { ...draft, name: event.target.value } })} /><TagChip tag={{ ...tag, ...draft }} /></span><span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><input value={draft.color} type="color" onChange={(event) => setDrafts({ ...drafts, [tag.id]: { ...draft, color: event.target.value } })} /><button className="button small" type="button" onClick={() => update(tag)}>保存</button><button className="button small ghost danger" type="button" onClick={() => remove(tag)}>删除</button></span></div>; }) : <div className="empty">还没有标签</div>}</div><form className="form-grid" style={{ marginTop: 18 }} onSubmit={create}><div className="field"><label>新标签</label><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="例如：生产环境" required /></div><div className="field"><label>颜色</label><input value={color} onChange={(event) => setColor(event.target.value)} type="color" /></div><div className="field full"><div className="form-actions"><button className="button primary" type="submit">创建标签</button></div></div></form></Modal>;
}
