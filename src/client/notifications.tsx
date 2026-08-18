import * as QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { Empty, Modal, PageHead } from './components';
import type {
  MonitorNotificationBinding,
  MonitorNotificationRule,
  NotificationChannel,
  QQNotificationUser,
} from './types';

type Notify = (message: string, error?: boolean) => void;
type NotificationType = 'pushplus' | 'qqbot';

const defaultRule: MonitorNotificationRule = {
  enabled: 1,
  notifyOnDegraded: 0,
  notifyOnDown: 1,
  notifyOnRecovery: 1,
  failureThreshold: 3,
};

function channelLabel(type: NotificationType): string {
  return type === 'qqbot' ? 'QQ 官方机器人' : 'PushPlus（推送加）';
}

function channelKicker(type: NotificationType): string {
  return type === 'qqbot' ? 'QQ bot notification' : 'PushPlus notification';
}

function channelSummary(channel: NotificationChannel): string {
  if (channel.type === 'qqbot') {
    return `${channelLabel(channel.type)} · AppID ${channel.appId || '未配置'} · ${channel.userCount} 个启用用户`;
  }
  return `${channelLabel(channel.type)} · 发送密钥已保存`;
}

export function NotificationEditor({
  channel,
  notify,
  onClose,
  onSaved,
}: {
  channel: NotificationChannel | null;
  notify: Notify;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [type, setType] = useState<NotificationType>(channel?.type || 'pushplus');
  const [name, setName] = useState(channel?.name || 'PushPlus 通知');
  const [token, setToken] = useState('');
  const [appId, setAppId] = useState(channel?.appId || '');
  const [appSecret, setAppSecret] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [defaultEnabled, setDefaultEnabled] = useState(channel?.defaultEnabled === 1);
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [users, setUsers] = useState<QQNotificationUser[]>([]);
  const [openid, setOpenid] = useState('');
  const [testOpenid, setTestOpenid] = useState('');
  const [userNickname, setUserNickname] = useState('');
  const [link, setLink] = useState('');
  const [qrData, setQrData] = useState('');
  const [busy, setBusy] = useState(false);
  const [userBusy, setUserBusy] = useState(false);

  const qq = type === 'qqbot';

  useEffect(() => {
    setType(channel?.type || 'pushplus');
    setName(channel?.name || 'PushPlus 通知');
    setToken('');
    setAppId(channel?.appId || '');
    setAppSecret('');
    setDefaultEnabled(channel?.defaultEnabled === 1);
    setApplyToExisting(false);
    setLink('');
    setQrData('');
    setOpenid('');
    setTestOpenid('');
    setUserNickname('');
    setUsers([]);
  }, [channel?.id, channel?.type]);

  const loadUsers = async () => {
    if (!channel || channel.type !== 'qqbot') return;
    try {
      const data = await api<{ users: QQNotificationUser[] }>(`/api/notifications/${channel.id}/qq/users`);
      setUsers(data.users || []);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '无法读取 QQ 用户', true);
    }
  };

  useEffect(() => { loadUsers(); }, [channel?.id, channel?.type]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        name,
        defaultEnabled,
        applyToExisting,
      };
      if (type === 'pushplus') {
        payload.token = token;
      } else {
        payload.appId = appId;
        if (appSecret.trim()) payload.appSecret = appSecret;
      }
      await api(channel ? `/api/notifications/${channel.id}` : '/api/notifications', {
        method: channel ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      notify(channel ? `${channelLabel(type)}已更新` : `${channelLabel(type)}已创建`);
      onSaved();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '保存通知失败', true);
      setBusy(false);
    }
  };

  const test = async () => {
    if (!channel && type === 'pushplus' && !token.trim()) {
      notify('请输入 PushPlus Token', true);
      return;
    }
    if (!channel && type === 'qqbot' && !testOpenid.trim()) {
      notify('未保存 QQ 配置时，请填写测试 OpenID', true);
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        ...(channel ? { channelId: channel.id } : {}),
        ...(name.trim() ? { name } : {}),
      };
      if (type === 'pushplus') {
        if (token.trim()) payload.token = token;
      } else {
        if (appId.trim()) payload.appId = appId;
        if (appSecret.trim()) payload.appSecret = appSecret;
        if (testOpenid.trim()) payload.openid = testOpenid;
      }
      await api('/api/notifications/test', { method: 'POST', body: JSON.stringify(payload) });
      notify('测试通知已发送');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '测试通知失败', true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!channel || !window.confirm(`删除这个${channelLabel(channel.type)}？已绑定的监控会同时解除绑定。`)) return;
    setBusy(true);
    try {
      await api(`/api/notifications/${channel.id}`, { method: 'DELETE' });
      notify(`${channelLabel(channel.type)}已删除`);
      onSaved();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '删除通知失败', true);
      setBusy(false);
    }
  };

  const addUser = async () => {
    if (!channel || channel.type !== 'qqbot') return;
    setUserBusy(true);
    try {
      await api(`/api/notifications/${channel.id}/qq/users`, {
        method: 'POST',
        body: JSON.stringify({ openid, nickname: userNickname }),
      });
      setOpenid('');
      setUserNickname('');
      await loadUsers();
      notify('QQ 用户已添加');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '添加 QQ 用户失败', true);
    } finally {
      setUserBusy(false);
    }
  };

  const toggleUser = async (user: QQNotificationUser) => {
    if (!channel || channel.type !== 'qqbot') return;
    setUserBusy(true);
    try {
      await api(`/api/notifications/${channel.id}/qq/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: user.enabled !== 1 }),
      });
      await loadUsers();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '更新 QQ 用户失败', true);
    } finally {
      setUserBusy(false);
    }
  };

  const deleteUser = async (user: QQNotificationUser) => {
    if (!channel || channel.type !== 'qqbot' || !window.confirm('删除这个 QQ 用户？')) return;
    setUserBusy(true);
    try {
      await api(`/api/notifications/${channel.id}/qq/users/${user.id}`, { method: 'DELETE' });
      await loadUsers();
      notify('QQ 用户已删除');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '删除 QQ 用户失败', true);
    } finally {
      setUserBusy(false);
    }
  };

  const createLink = async () => {
    if (!channel || channel.type !== 'qqbot') return;
    setBusy(true);
    try {
      const data = await api<{ url: string }>(`/api/notifications/${channel.id}/qq/link`, { method: 'POST' });
      setLink(data.url);
      setQrData(await QRCode.toDataURL(data.url, { width: 240, margin: 1 }));
      notify('QQ 添加二维码已生成');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '生成 QQ 添加链接失败', true);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify('添加链接已复制');
    } catch {
      notify('复制失败，请手动复制链接', true);
    }
  };

  const webhookUrl = channel && channel.type === 'qqbot'
    ? `${window.location.origin}/api/notifications/${channel.id}/qq/webhook`
    : '';

  return <Modal onClose={onClose} className={qq ? 'notification-modal qq-notification-modal' : 'notification-modal'}>
    <div className="modal-head"><div><div className="page-kicker">{channelKicker(type)}</div><h2>{channel ? '编辑通知' : '设置通知'}</h2></div></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field full"><label>通知类型</label><select value={type} disabled={Boolean(channel)} onChange={(event) => { const next = event.target.value as NotificationType; setType(next); setName(next === 'qqbot' ? 'QQ 机器人通知' : 'PushPlus 通知'); }}><option value="pushplus">PushPlus（推送加）</option><option value="qqbot">QQ 官方机器人</option></select></div>
        <div className="field full"><label>显示名称</label><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></div>
        {type === 'pushplus' ? <div className="field full"><label>发送密钥</label><div className="secret-input"><input value={token} onChange={(event) => setToken(event.target.value)} type={showToken ? 'text' : 'password'} placeholder={channel?.tokenConfigured ? '已保存，留空保持不变' : '输入 PushPlus Token'} maxLength={512} required={!channel} /><button className="secret-toggle" type="button" title={showToken ? '隐藏发送密钥' : '显示发送密钥'} aria-label={showToken ? '隐藏发送密钥' : '显示发送密钥'} onClick={() => setShowToken(!showToken)}>{showToken ? '隐藏' : '显示'}</button></div></div> : <>
          <div className="field full"><label>QQ AppID</label><input value={appId} onChange={(event) => setAppId(event.target.value)} maxLength={128} placeholder="开放平台中的 AppID" required /></div>
          <div className="field full"><label>QQ AppSecret</label><div className="secret-input"><input value={appSecret} onChange={(event) => setAppSecret(event.target.value)} type={showAppSecret ? 'text' : 'password'} placeholder={channel?.appSecretConfigured ? '已保存，留空保持不变' : '输入开放平台中的 AppSecret'} maxLength={512} required={!channel} /><button className="secret-toggle" type="button" title={showAppSecret ? '隐藏 AppSecret' : '显示 AppSecret'} aria-label={showAppSecret ? '隐藏 AppSecret' : '显示 AppSecret'} onClick={() => setShowAppSecret(!showAppSecret)}>{showAppSecret ? '隐藏' : '显示'}</button></div></div>
        </>}
      </div>
      <p className="field-note">{type === 'pushplus' ? <>测试不会保存当前输入；编辑已有渠道时留空 Token 将使用已保存密钥。更多信息：<a href="https://www.pushplus.plus/" target="_blank" rel="noreferrer">https://www.pushplus.plus/</a></> : <>QQ 使用官方机器人 Open Platform，只发送私聊纯文本。AppSecret 同时用于获取 Access Token 和 Webhook 签名；控制台中的 Token 不需要填写。</>}</p>
      {qq ? <div className="qq-management">
        <div className="qq-link-panel">
          <div className="section-head"><div><h3 className="section-title">扫码添加用户</h3><p className="field-note">先保存 QQ 配置，再生成官方添加链接。用户扫码后仍需在 QQ 中确认。</p></div><button className="button small ghost" type="button" disabled={!channel || busy} onClick={createLink}>生成二维码</button></div>
          {qrData ? <div className="qq-qr-result"><img className="qq-qr" src={qrData} alt="QQ 机器人添加二维码" /><div className="qq-link-copy"><textarea readOnly value={link} rows={3} /><button className="button small" type="button" onClick={copyLink}>复制添加链接</button></div></div> : <div className="notice">保存后可以在这里生成 QQ 官方添加二维码。</div>}
        </div>
        {channel ? <div className="qq-link-panel"><div className="section-head"><div><h3 className="section-title">Webhook 地址</h3><p className="field-note">把这个地址填写到 QQ 开放平台的回调配置，并订阅 GROUP_AND_C2C_EVENT。</p></div><button className="button small ghost" type="button" onClick={async () => { try { await navigator.clipboard.writeText(webhookUrl); notify('Webhook 地址已复制'); } catch { notify('复制失败，请手动复制地址', true); } }}>复制</button></div><input className="webhook-url" readOnly value={webhookUrl} /></div> : null}
        {channel ? <div className="qq-link-panel"><div className="section-head"><div><h3 className="section-title">QQ 用户</h3><p className="field-note">Webhook 收到 FRIEND_ADD 或 C2C_MESSAGE_CREATE 后会自动加入；也可以手动填写 OpenID。</p></div></div><div className="qq-user-add"><input value={openid} onChange={(event) => setOpenid(event.target.value)} placeholder="QQ OpenID" maxLength={128} required /><input value={userNickname} onChange={(event) => setUserNickname(event.target.value)} placeholder="备注（可选）" maxLength={80} /><button className="button small" type="button" disabled={userBusy} onClick={addUser}>添加</button></div><div className="qq-user-list">{users.length ? users.map((user) => <div className="qq-user-row" key={user.id}><div className="qq-user-main"><strong>{user.nickname || '未命名用户'}</strong><span>{user.openid}</span></div><div className="qq-user-actions"><span className="muted">{user.source === 'webhook' ? 'Webhook' : '手动'} · {user.enabled ? '启用' : '停用'}</span><button className="button small ghost" type="button" disabled={userBusy} onClick={() => toggleUser(user)}>{user.enabled ? '停用' : '启用'}</button><button className="button small ghost danger" type="button" disabled={userBusy} onClick={() => deleteUser(user)}>删除</button></div></div>) : <div className="empty">还没有 QQ 用户</div>}</div></div> : null}
        <div className="field full"><label>测试 OpenID（可选）</label><input value={testOpenid} onChange={(event) => setTestOpenid(event.target.value)} maxLength={128} placeholder={channel ? '留空则发送给所有启用用户' : '未保存配置时必填'} /></div>
      </div> : null}
      <div className="notification-options">
        <label className="toggle-option"><input type="checkbox" checked={defaultEnabled} onChange={(event) => setDefaultEnabled(event.target.checked)} /><span>默认开启</span></label>
        <p>新的监控将默认启用此通知，仍然可以在每个监控中单独关闭。</p>
        <label className="toggle-option"><input type="checkbox" checked={applyToExisting} onChange={(event) => setApplyToExisting(event.target.checked)} /><span>应用到所有现有监控</span></label>
        <p>保存时将此通知绑定到所有现有监控，并按默认开启状态设置。</p>
      </div>
      <div className="form-actions notification-actions"><button className="button ghost danger" type="button" disabled={!channel || busy} onClick={remove}>删除</button><span className="form-action-right"><button className="button ghost" type="button" disabled={busy} onClick={test}>测试</button><button className="button primary" type="submit" disabled={busy}>{channel ? '保存' : '创建'}</button></span></div>
    </form>
  </Modal>;
}

function NotificationList({ channels, notify, onEdit, onCreate }: { channels: NotificationChannel[]; notify: Notify; onEdit: (channel: NotificationChannel) => void; onCreate: () => void }): JSX.Element {
  const [busyId, setBusyId] = useState('');
  const test = async (channel: NotificationChannel) => {
    setBusyId(channel.id);
    try {
      await api(`/api/notifications/${channel.id}/test`, { method: 'POST' });
      notify('测试通知已发送');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '测试通知失败', true);
    } finally {
      setBusyId('');
    }
  };
  return <div className="panel notification-list">{channels.length ? channels.map((channel) => <div className="notification-row" key={channel.id}><div><div className="monitor-name">{channel.name}</div><div className="target">{channelSummary(channel)} · {channel.defaultEnabled ? '新监控默认开启' : '新监控默认关闭'}</div></div><div className="actions"><button className="button small ghost" type="button" disabled={busyId === channel.id} onClick={() => test(channel)}>测试</button><button className="button small" type="button" onClick={() => onEdit(channel)}>编辑</button></div></div>) : <Empty title="还没有通知配置" note="创建 PushPlus 或 QQ 官方机器人通知，再绑定到需要提醒的监控。" action={<button className="button primary" type="button" onClick={onCreate}>＋ 设置通知</button>} />}</div>;
}

export function NotificationsView({ notify }: { notify: Notify }): JSX.Element {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const load = async () => {
    try {
      const data = await api<{ channels: NotificationChannel[] }>('/api/notifications');
      setChannels(data.channels || []);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '无法读取通知配置', true);
    }
  };
  useEffect(() => { load(); }, []);
  return <><PageHead kicker="Notifications" title="通知设置" note="配置 PushPlus 或 QQ 官方机器人，并在每个监控中选择需要接收通知的渠道。" action={<button className="button primary" type="button" onClick={() => { setEditing(null); setEditorOpen(true); }}>＋ 设置通知</button>} /><NotificationList channels={channels} notify={notify} onCreate={() => { setEditing(null); setEditorOpen(true); }} onEdit={(channel) => { setEditing(channel); setEditorOpen(true); }} />{editorOpen ? <NotificationEditor channel={editing} notify={notify} onClose={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); load(); }} /> : null}</>;
}

export function NotificationBindingsPanel({
  channels,
  rule,
  onBindingsChange,
  onRuleChange,
  onManage,
  onEdit,
}: {
  channels: MonitorNotificationBinding[];
  rule: MonitorNotificationRule;
  onBindingsChange: (channels: MonitorNotificationBinding[]) => void;
  onRuleChange: (rule: MonitorNotificationRule) => void;
  onManage: () => void;
  onEdit: (channelId: string) => void;
}): JSX.Element {
  const toggleChannel = (channelId: string) => onBindingsChange(channels.map((channel) => channel.channelId === channelId ? { ...channel, enabled: channel.enabled ? 0 : 1 } : channel));
  return <aside className="notification-panel"><div className="section-head"><h3 className="section-title">通知</h3><button className="button small ghost" type="button" onClick={onManage}>设置通知</button></div>{channels.length ? <div className="notification-binding-list">{channels.map((channel) => <div className="notification-binding" key={channel.channelId}><label className="toggle-option"><input type="checkbox" checked={channel.enabled === 1} onChange={() => toggleChannel(channel.channelId)} /><span>{channel.name}</span></label><span className="notification-binding-actions"><span className="muted">{channelLabel(channel.type)}</span><button className="button small ghost" type="button" onClick={() => onEdit(channel.channelId)}>编辑</button></span></div>)}</div> : <div className="notice">还没有通知配置，请先点击“设置通知”。</div>}<div className="notification-rule-grid"><label className="toggle-option"><input type="checkbox" checked={rule.enabled === 1} onChange={(event) => onRuleChange({ ...rule, enabled: event.target.checked ? 1 : 0 })} /><span>启用通知</span></label><label className="toggle-option"><input type="checkbox" checked={rule.notifyOnDegraded === 1} onChange={(event) => onRuleChange({ ...rule, notifyOnDegraded: event.target.checked ? 1 : 0 })} /><span>部分异常</span></label><label className="toggle-option"><input type="checkbox" checked={rule.notifyOnDown === 1} onChange={(event) => onRuleChange({ ...rule, notifyOnDown: event.target.checked ? 1 : 0 })} /><span>宕机</span></label><label className="toggle-option"><input type="checkbox" checked={rule.notifyOnRecovery === 1} onChange={(event) => onRuleChange({ ...rule, notifyOnRecovery: event.target.checked ? 1 : 0 })} /><span>恢复</span></label><div className="field"><label>连续异常次数</label><input type="number" min={1} max={10} value={rule.failureThreshold} onChange={(event) => onRuleChange({ ...rule, failureThreshold: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} /></div></div><p className="field-note">达到连续异常次数后发送一次，同一状态不会重复推送；恢复正常时发送恢复通知。</p></aside>;
}

export const defaultNotificationRule = defaultRule;
