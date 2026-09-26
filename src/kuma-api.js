/*
 * The upstream Kuma UI speaks in socket events and SQLite-shaped objects.
 * This adapter keeps that public shape while talking to the Worker REST API.
 */

export const SUPPORTED_MONITOR_TYPES = ["http", "keyword", "port", "ping"];

export function unsupported(message = "当前 Worker 版本暂不支持") {
    return { ok: false, msg: message, msgi18n: false, unsupported: true };
}

function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function request(path, options = {}) {
    const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {}),
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || data.msg || `Request failed (${response.status})`);
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

export function statusToNumber(status, active = true) {
    if (!active || status === "paused") return -1;
    if (status === "up") return 1;
    if (status === "down") return 0;
    if (status === "degraded") return 2;
    return -1;
}

export function numberToStatus(status) {
    if (Number(status) === 1) return "up";
    if (Number(status) === 0) return "down";
    if (Number(status) === 2) return "degraded";
    return "unknown";
}

function acceptedCodes(codes) {
    if (!Array.isArray(codes)) return [];
    return codes.map((code) => String(code)).filter((code) => /^\d{3}$/.test(code));
}

function monitorType(raw) {
    if (raw.type === "tcp") return "port";
    if (raw.type === "http" && raw.responseKeyword) return "keyword";
    return raw.type || "http";
}

function tagValue(tag) {
    return {
        id: tag.id,
        name: tag.name,
        value: tag.value || "",
        color: tag.color || "#5cdd8b",
    };
}

export function heartbeatFromResult(result, monitorId) {
    const status = result.success ? 1 : 0;
    return {
        id: result.id,
        monitorID: monitorId || result.monitorId,
        status,
        time: result.checkedAt,
        ping: result.latencyMs == null ? null : result.latencyMs,
        duration: result.latencyMs == null ? 0 : result.latencyMs,
        msg: result.message || (result.success ? "OK" : "检查失败"),
        important: !result.success,
        statusCode: result.statusCode,
        nodeID: result.nodeId,
    };
}

export function heartbeatFromSummary(summary, monitorId) {
    return {
        id: summary.id,
        monitorID: monitorId,
        status: statusToNumber(summary.status),
        time: summary.checkedAt,
        ping: null,
        duration: 0,
        msg: summary.status === "up" ? "OK" : summary.status === "degraded" ? "部分探测异常" : summary.status === "down" ? "检查失败" : "暂无数据",
        important: summary.status === "down",
        availability: summary.availability,
    };
}

export function toKumaMonitor(raw) {
    const active = Boolean(raw.enabled);
    const type = monitorType(raw);
    const tags = (raw.tags || []).map(tagValue);
    const history = (raw.history || []).map((item) => heartbeatFromSummary(item, raw.id));
    const childrenIDs = Array.isArray(raw.childrenIDs) ? raw.childrenIDs : [];
    const url = raw.targetUrl || "";
    const hostname = raw.host || (() => {
        try { return new URL(url).hostname; } catch { return ""; }
    })();
    return {
        ...raw,
        id: String(raw.id),
        type,
        originalType: raw.type,
        active,
        enabled: active,
        status: statusToNumber(raw.currentStatus, active),
        url,
        hostname,
        port: raw.port == null ? undefined : String(raw.port),
        method: raw.httpMethod || "GET",
        httpMethod: raw.httpMethod || "GET",
        headers: JSON.stringify(raw.requestHeaders || {}, null, 4),
        body: raw.requestBody || "",
        accepted_statuscodes: acceptedCodes(raw.expectedStatusCodes),
        keyword: raw.responseKeyword || "",
        responsecheck: raw.responseKeyword ? "keyword" : null,
        responseKeyword: raw.responseKeyword || "",
        interval: Number(raw.intervalSeconds || 60),
        retryInterval: Number(raw.intervalSeconds || 60),
        timeout: Number(raw.timeoutSeconds || 10),
        provider: raw.provider || "worker",
        globalpingLocations: raw.globalpingLocations || [],
        tags,
        notificationIDList: {},
        parent: null,
        childrenIDs,
        path: [],
        pathName: raw.name || "",
        weight: 0,
        forceInactive: false,
        monitorInterval: Number(raw.intervalSeconds || 60),
        heartbeatList: history,
        history,
        lastHeartbeat: history.at(-1) || null,
        lastCheckedAt: raw.lastCheckedAt || null,
        description: raw.description || null,
        pushToken: null,
        screenshot: null,
    };
}

export function toMonitorMap(monitors = []) {
    const map = {};
    for (const raw of monitors) {
        const monitor = toKumaMonitor(raw);
        map[monitor.id] = monitor;
    }
    return map;
}

export function toMonitorInput(monitor) {
    const source = asObject(monitor);
    let type = source.type;
    if (type === "keyword") type = "http";
    if (type === "port") type = "tcp";
    if (!SUPPORTED_MONITOR_TYPES.includes(source.type) || !["http", "tcp", "ping"].includes(type)) {
        return null;
    }
    const headers = source.headers || source.requestHeaders || "{}";
    let requestHeaders = {};
    if (typeof headers === "string") {
        try { requestHeaders = asObject(JSON.parse(headers)); } catch { requestHeaders = {}; }
    } else requestHeaders = asObject(headers);
    const accepted = Array.isArray(source.accepted_statuscodes) ? source.accepted_statuscodes : source.expectedStatusCodes;
    const expectedStatusCodes = Array.isArray(accepted)
        ? accepted.flatMap((value) => {
            const text = String(value);
            const match = text.match(/^(\d{3})-(\d{3})$/);
            if (!match) return /^\d{3}$/.test(text) ? [Number(text)] : [];
            const start = Number(match[1]);
            const end = Math.min(Number(match[2]), start + 99);
            return Array.from({ length: end - start + 1 }, (_, index) => start + index);
        })
        : [];
    const interval = Math.max(60, Number(source.interval || source.intervalSeconds || 60));
    const input = {
        name: String(source.name || "未命名监控").trim(),
        type,
        provider: source.provider === "globalping" ? "globalping" : "worker",
        intervalMinutes: Math.max(1, Math.min(60, Math.round(interval / 60))),
        timeoutSeconds: Math.max(1, Math.min(30, Number(source.timeout || source.timeoutSeconds || 10))),
        enabled: source.active !== false && source.enabled !== false,
        tagIds: (source.tags || []).map((tag) => String(tag.id)).filter(Boolean),
    };
    if (type === "http") {
        input.url = String(source.url || source.targetUrl || "").trim();
        input.httpMethod = source.method || source.httpMethod || "GET";
        input.requestHeaders = requestHeaders;
        input.requestBody = source.body || source.requestBody || "";
        input.responseKeyword = type === "http" && (source.type === "keyword" || source.responsecheck === "keyword")
            ? String(source.keyword || source.responseKeyword || "")
            : String(source.responseKeyword || "");
        input.expectedStatusCodes = expectedStatusCodes;
        input.globalpingLocations = source.globalpingLocations || [];
    } else if (type === "tcp") {
        input.host = String(source.hostname || source.host || "").trim();
        input.port = Number(source.port);
        input.provider = "worker";
    } else {
        input.host = String(source.hostname || source.host || "").trim();
        input.globalpingLocations = source.globalpingLocations || [];
        input.provider = "globalping";
    }
    return input;
}

export function toKumaNotification(channel) {
    return {
        id: String(channel.id),
        name: channel.name,
        isDefault: Boolean(channel.defaultEnabled),
        active: true,
        type: channel.type === "qqbot" ? "qqbot" : "PushPlus",
        tokenConfigured: Boolean(channel.tokenConfigured),
        userCount: channel.userCount || 0,
        ...(channel.appId ? { appId: channel.appId } : {}),
    };
}

export function toKumaStatusPage(page, monitors = []) {
    const byId = new Map(monitors.map((monitor) => [String(monitor.id), monitor]));
    const groups = (page.groups || []).map((group) => ({
        id: group.id,
        name: group.name,
        monitorList: (group.monitorIds || []).map((id) => byId.get(String(id))).filter(Boolean),
    }));
    return {
        ...page,
        slug: page.slug,
        title: page.title,
        description: page.description || "",
        footerText: page.footer || "",
        autoRefreshInterval: page.refreshSeconds || 300,
        showTags: page.showTags !== 0,
        showPoweredBy: page.showPoweredBy !== 0,
        showOnlyLastHeartbeat: page.lastHeartbeatOnly === 1,
        customCSS: page.customCss || "",
        published: Boolean(page.enabled),
        icon: "/icon.svg",
        domainNameList: [],
        groups,
        monitorList: groups.flatMap((group) => group.monitorList),
    };
}

export function publicMonitorToKuma(monitor) {
    const history = (monitor.history || []).map((item) => heartbeatFromSummary(item, monitor.id));
    if (monitor.nodes?.length) {
        return {
            ...monitor,
            id: String(monitor.id),
            active: Boolean(monitor.enabled),
            type: monitor.type === "tcp" ? "port" : monitor.type,
            status: statusToNumber(monitor.status, monitor.enabled),
            tags: (monitor.tags || []).map(tagValue),
            heartbeatList: history,
            lastHeartbeat: history.at(-1) || null,
            url: "",
            hostname: "",
            path: [],
            pathName: monitor.name,
            parent: null,
            childrenIDs: [],
        };
    }
    return toKumaMonitor({ ...monitor, history });
}
