import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { Empty, Modal, PageHead } from './components';
import type {
  MonitorNotificationBinding,
  MonitorNotificationRule,
  NotificationChannel,
} from './types';

type Notify = (message: string, error?: boolean) => void;

const defaultRule: MonitorNotificationRule = {
  enabled: 1,
  notifyOnDegraded: 0,
  notifyOnDown: 1,
  notifyOnRecovery: 1,
  failureThreshold: 3,
};

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
  const [name, setName] = useState(channel?.name || 'PushPlus 通知');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [defaultEnabled, setDefaultEnabled] = useState(channel?.defaultEnabled === 1);
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api(channel ? `/api/notifications/${channel.id}` : '/api/notifications', {
        method: channel ? 'PATCH' : 'POST',
        body: JSON.stringify({
          type: 'pushplus',
          name,
          token,
          defaultEnabled,
          applyToExisting,
        }),
      });
      notify(channel ? 'PushPlus 通知已更新' : 'PushPlus 通知已创建');
      onSaved();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '保存通知失败', true);
      setBusy(false);
    }
  };

  const test = async () => {
    if (!channel && !token.trim()) {
      notify('请输入 PushPlus Token', true);
      return;
    }
    setBusy(true);
    try {
      await api('/api/notifications/test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'pushplus',
          ...(channel ? { channelId: channel.id } : {}),
          ...(token.trim() ? { token } : {}),
          ...(name.trim() ? { name } : {}),
        }),
      });
      notify('测试通知已发送');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '测试通知失败', true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!channel || !window.confirm('删除这个 PushPlus 通知？已绑定的监控会同时解除绑定。')) return;
    setBusy(true);
    try {
      await api(`/api/notifications/${channel.id}`, { method: 'DELETE' });
      notify('PushPlus 通知已删除');
      onSaved();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '删除通知失败', true);
      setBusy(false);
    }
  };

  return <Modal onClose={onClose} className="notification-modal">
    <div className="modal-head"><div><div className="page-kicker">PushPlus notification</div><h2>{channel ? '编辑通知' : '设置通知'}</h2></div></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field full"><label>通知类型</label><select value="pushplus" disabled><option value="pushplus">PushPlus（推送加）</option></select></div>
        <div className="field full"><label>显示名称</label><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></div>
        <div className="field full"><label>发送密钥</label><div className="secret-input"><input value={token} onChange={(event) => setToken(event.target.value)} type={showToken ? 'text' : 'password'} placeholder={channel?.tokenConfigured ? '已保存，留空保持不变' : '输入 PushPlus Token'} maxLength={512} required={!channel} /><button className="secret-toggle" type="button" title={showToken ? '隐藏发送密钥' : '显示发送密钥'} aria-label={showToken ? '隐藏发送密钥' : '显示发送密钥'} onClick={() => setShowToken(!showToken)}>{showToken ? '隐藏' : '显示'}</button></div></div>
      </div>
      <p className="field-note">测试不会保存当前输入；编辑已有渠道时留空 Token 将使用已保存密钥。更多信息：<a href="https://www.pushplus.plus/" target="_blank" rel="noreferrer">https://www.pushplus.plus/</a></p>
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
  return <div className="panel notification-list">{channels.length ? channels.map((channel) => <div className="notification-row" key={channel.id}><div><div className="monitor-name">{channel.name}</div><div className="target">PushPlus（推送加） · 发送密钥已保存 · {channel.defaultEnabled ? '新监控默认开启' : '新监控默认关闭'}</div></div><div className="actions"><button className="button small ghost" type="button" disabled={busyId === channel.id} onClick={() => test(channel)}>测试</button><button className="button small" type="button" onClick={() => onEdit(channel)}>编辑</button></div></div>) : <Empty title="还没有通知配置" note="创建一个 PushPlus 通知，再绑定到需要提醒的监控。" action={<button className="button primary" type="button" onClick={onCreate}>＋ 设置 PushPlus</button>} />}</div>;
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
  return <><PageHead kicker="Notifications" title="通知设置" note="配置 PushPlus，并在每个监控中选择需要接收通知的渠道。" action={<button className="button primary" type="button" onClick={() => { setEditing(null); setEditorOpen(true); }}>＋ 设置 PushPlus</button>} /><NotificationList channels={channels} notify={notify} onCreate={() => { setEditing(null); setEditorOpen(true); }} onEdit={(channel) => { setEditing(channel); setEditorOpen(true); }} />{editorOpen ? <NotificationEditor channel={editing} notify={notify} onClose={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); load(); }} /> : null}</>;
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
  onEdit: (channel: NotificationChannel) => void;
}): JSX.Element {
  const toggleChannel = (channelId: string) => onBindingsChange(channels.map((channel) => channel.channelId === channelId ? { ...channel, enabled: channel.enabled ? 0 : 1 } : channel));
  return <aside className="notification-panel"><div className="section-head"><h3 className="section-title">通知</h3><button className="button small ghost" type="button" onClick={onManage}>设置通知</button></div>{channels.length ? <div className="notification-binding-list">{channels.map((channel) => <div className="notification-binding" key={channel.channelId}><label className="toggle-option"><input type="checkbox" checked={channel.enabled === 1} onChange={() => toggleChannel(channel.channelId)} /><span>{channel.name}</span></label><span className="notification-binding-actions"><span className="muted">PushPlus</span><button className="button small ghost" type="button" onClick={() => onEdit({ id: channel.channelId, name: channel.name, type: 'pushplus', defaultEnabled: channel.defaultEnabled, tokenConfigured: true, createdAt: '', updatedAt: '' })}>编辑</button></span></div>)}</div> : <div className="notice">还没有 PushPlus 配置，请先点击“设置通知”。</div>}<div className="notification-rule-grid"><label className="toggle-option"><input type="checkbox" checked={rule.enabled === 1} onChange={(event) => onRuleChange({ ...rule, enabled: event.target.checked ? 1 : 0 })} /><span>启用通知</span></label><label className="toggle-option"><input type="checkbox" checked={rule.notifyOnDegraded === 1} onChange={(event) => onRuleChange({ ...rule, notifyOnDegraded: event.target.checked ? 1 : 0 })} /><span>部分异常</span></label><label className="toggle-option"><input type="checkbox" checked={rule.notifyOnDown === 1} onChange={(event) => onRuleChange({ ...rule, notifyOnDown: event.target.checked ? 1 : 0 })} /><span>宕机</span></label><label className="toggle-option"><input type="checkbox" checked={rule.notifyOnRecovery === 1} onChange={(event) => onRuleChange({ ...rule, notifyOnRecovery: event.target.checked ? 1 : 0 })} /><span>恢复</span></label><div className="field"><label>连续异常次数</label><input type="number" min={1} max={10} value={rule.failureThreshold} onChange={(event) => onRuleChange({ ...rule, failureThreshold: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} /></div></div><p className="field-note">达到连续异常次数后发送一次，同一状态不会重复推送；恢复正常时发送恢复通知。</p></aside>;
}

export const defaultNotificationRule = defaultRule;
