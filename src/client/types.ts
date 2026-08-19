export type MonitorStatus = 'up' | 'degraded' | 'down' | 'unknown' | 'paused';
export type ThemeMode = 'light' | 'dark' | 'auto';

export interface User {
  id: string;
  username: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ProbeNode {
  id: string;
  countryCode: string;
  countryName: string;
  city: string;
}

export interface GlobalpingLocation {
  country: string;
  city?: string;
  probes?: number;
}

export interface Heartbeat {
  id: string;
  status: Exclude<MonitorStatus, 'paused'>;
  availability: number | null;
  checkedAt: string;
}

export interface Monitor {
  id: string;
  name: string;
  type: 'http' | 'tcp' | 'ping';
  provider: 'worker' | 'globalping';
  httpMethod: 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  targetUrl: string | null;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  expectedStatusCodes: number[];
  responseKeyword: string | null;
  timeoutSeconds: number;
  intervalSeconds: number;
  host: string | null;
  port: number | null;
  enabled: number;
  currentStatus: MonitorStatus;
  lastCheckedAt: string | null;
  nodes: ProbeNode[];
  globalpingLocations: GlobalpingLocation[];
  tags?: Tag[];
  history?: Heartbeat[];
}

export interface StatusPageGroup {
  id?: string;
  name: string;
  sortOrder?: number;
  monitorIds: string[];
}

export interface StatusPage {
  id: string;
  slug: string;
  title: string;
  description: string;
  footer: string;
  refreshSeconds: number;
  theme: ThemeMode;
  showTags: number;
  showPoweredBy: number;
  lastHeartbeatOnly: number;
  rssTitle: string;
  customCss: string;
  enabled: number;
  groups: StatusPageGroup[];
  monitorIds: string[];
}

export interface AdminSettings {
  theme: ThemeMode;
  heartbeatPosition: 'top' | 'bottom';
  timeDisplay: 'relative' | 'absolute';
  historyRetentionDays: number;
  maxMonitors: number;
  maxNodesPerMonitor: number;
  maxJobsPerTick: number;
  globalpingTokenConfigured: boolean;
}

export interface NotificationChannel {
  id: string;
  type: 'pushplus' | 'qqbot';
  name: string;
  defaultEnabled: number;
  tokenConfigured: boolean;
  appId: string | null;
  appSecretConfigured: boolean;
  botSecretConfigured: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface QQNotificationUser {
  id: string;
  openid: string;
  nickname: string | null;
  source: 'manual' | 'websocket';
  enabled: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export type QQGatewayStatusName = 'stopped' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface QQGatewayStatus {
  status: QQGatewayStatusName;
  channelId: string | null;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

export interface MonitorNotificationBinding {
  channelId: string;
  name: string;
  type: 'pushplus' | 'qqbot';
  defaultEnabled: number;
  enabled: number;
}

export interface MonitorNotificationRule {
  enabled: number;
  notifyOnDegraded: number;
  notifyOnDown: number;
  notifyOnRecovery: number;
  failureThreshold: number;
}

export interface MonitorNotificationSettings {
  channels: MonitorNotificationBinding[];
  rule: MonitorNotificationRule;
}

export interface CheckResult {
  nodeId: string;
  success: number;
  latencyMs: number | null;
  statusCode: number | null;
  message: string | null;
  checkedAt: string;
  node?: ProbeNode | null;
}

export interface PublicMonitor {
  id: string;
  name: string;
  status: MonitorStatus;
  enabled: boolean;
  availability: number | null;
  lastCheckedAt: string | null;
  history: Heartbeat[];
  tags?: Tag[];
}

export interface PublicGroup {
  id?: string;
  name: string;
  sortOrder?: number;
  monitors: PublicMonitor[];
}

export interface PublicPage {
  title: string;
  slug: string;
  description?: string;
  footer?: string;
  refreshSeconds?: number;
  theme?: ThemeMode;
  showTags?: number;
  showPoweredBy?: number;
  lastHeartbeatOnly?: number;
  customCss?: string;
}
