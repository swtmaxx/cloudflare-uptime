export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  QQ_GATEWAY: DurableObjectNamespace;
}

export type MonitorType = 'http' | 'tcp' | 'ping';
export type MonitorProvider = 'worker' | 'globalping';
export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type MonitorStatus = 'up' | 'degraded' | 'down' | 'unknown' | 'paused';
export type JobState = 'pending' | 'completed' | 'provider_error' | 'expired';
export type ThemeMode = 'light' | 'dark' | 'auto';
export type TimeDisplay = 'relative' | 'absolute';
export type HeartbeatPosition = 'top' | 'bottom';
export type NotificationEventType = 'degraded' | 'down' | 'recovery';
export type NotificationChannelType = 'pushplus' | 'qqbot';

export interface GlobalpingLocation {
  country: string;
  city?: string;
}

export interface ProbeNode {
  id: string;
  provider: MonitorProvider;
  countryCode: string;
  countryName: string;
  city: string;
  ip: string | null;
  asn: string | null;
  enabled: number;
  lastSeenAt: string;
}

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  provider: MonitorProvider;
  httpMethod: HttpMethod;
  targetUrl: string | null;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  expectedStatusCodes: number[];
  responseKeyword: string | null;
  timeoutSeconds: number;
  host: string | null;
  port: number | null;
  intervalSeconds: number;
  enabled: number;
  currentStatus: MonitorStatus;
  lastStartedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  nodes: ProbeNode[];
  globalpingLocations: GlobalpingLocation[];
  tags?: Tag[];
  history?: HeartbeatSummary[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface HeartbeatSummary {
  id: string;
  status: Exclude<MonitorStatus, 'paused'>;
  availability: number | null;
  checkedAt: string;
}

export interface CheckJob {
  id: string;
  monitorId: string;
  requestId: string | null;
  provider: MonitorProvider;
  state: JobState;
  errorMessage: string | null;
  createdAt: string;
  nextPollAt: string | null;
  expiresAt: string;
  completedAt: string | null;
  pollCount: number;
}

export interface CheckResult {
  id: string;
  jobId: string;
  monitorId: string;
  nodeId: string;
  success: number;
  latencyMs: number | null;
  statusCode: number | null;
  message: string | null;
  resolvedIp: string | null;
  checkedAt: string;
  node: ProbeNode | null;
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
  createdAt: string;
  updatedAt: string;
  groups: StatusPageGroup[];
}

export interface StatusPageGroup {
  id: string;
  name: string;
  sortOrder: number;
  monitorIds: string[];
}

export interface MonitorInput {
  name: string;
  type: MonitorType;
  provider?: MonitorProvider;
  httpMethod?: HttpMethod;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  expectedStatusCodes?: number[];
  responseKeyword?: string;
  timeoutSeconds?: number;
  intervalSeconds?: number;
  url?: string;
  host?: string;
  port?: number;
  globalpingLocations?: GlobalpingLocation[];
  tagIds?: string[];
  enabled?: boolean;
}

export interface SystemSettings {
  maxMonitors: number;
  maxNodesPerMonitor: number;
  maxJobsPerTick: number;
  historyRetentionDays: number;
  globalpingTokenConfigured: boolean;
}

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
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

export interface MonitorNotificationRule {
  enabled: number;
  notifyOnDegraded: number;
  notifyOnDown: number;
  notifyOnRecovery: number;
  failureThreshold: number;
}

export interface MonitorNotificationBinding {
  channelId: string;
  name: string;
  type: NotificationChannelType;
  defaultEnabled: number;
  enabled: number;
}
