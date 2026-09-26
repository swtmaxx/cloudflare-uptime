import { useToast } from "vue-toastification";
import Favico from "favico.js";
import mitt from "mitt";

import { DOWN, MAINTENANCE, PENDING, UP } from "../util.ts";
import { getToastSuccessTimeout, getToastErrorTimeout } from "../util-frontend.js";
import { logout as authLogout } from "../auth-client";
import {
    heartbeatFromResult,
    heartbeatFromSummary,
    request,
    toKumaMonitor,
    toKumaNotification,
    toKumaStatusPage,
    toMonitorInput,
    toMonitorMap,
    unsupported,
} from "../kuma-api.js";
import { RealtimeClient, onRealtimeEvent } from "../client/realtime";

const toast = useToast();
const favicon = new Favico({ animation: "none" });
let socket;
let realtime;
let realtimeUnsubscribe;

function callbackFrom(args) {
    const last = args.at(-1);
    return typeof last === "function" ? { callback: last, values: args.slice(0, -1) } : { callback: () => {}, values: args };
}

function responseOk(data = {}, fallback = "操作成功") {
    return { ok: true, msg: data.msg || fallback, msgi18n: false, ...data };
}

function responseError(error) {
    return { ok: false, msg: error?.message || "请求失败", msgi18n: false, status: error?.status };
}

function mapSettings(settings = {}) {
    return {
        ...settings,
        entryPage: "dashboard",
        checkUpdate: false,
        searchEngineIndex: false,
        keepDataPeriodDays: settings.historyRetentionDays ?? 30,
        heartbeatBar: "normal",
        styleElapsedTime: "no-line",
    };
}

class KumaSocket {
    constructor(root) {
        this.root = root;
        this.handlers = new Map();
        this.connected = false;
    }

    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(handler);
        return this;
    }

    off(event, handler) {
        this.handlers.get(event)?.delete(handler);
        return this;
    }

    emitLocal(event, ...args) {
        for (const handler of this.handlers.get(event) || []) handler(...args);
    }

    connect() {
        if (this.connected) return;
        this.connected = true;
        this.root.socket.connected = true;
        this.root.socket.firstConnect = false;
        this.emitLocal("connect");
    }

    disconnect() {
        this.connected = false;
        this.root.socket.connected = false;
        this.emitLocal("disconnect");
    }

    async emit(event, ...args) {
        const { callback, values } = callbackFrom(args);
        try {
            const result = await this.handle(event, values);
            callback(result);
            return result;
        } catch (error) {
            const result = responseError(error);
            callback(result);
            return result;
        }
    }

    async handle(event, values) {
        switch (event) {
            case "needSetup": return (await request("/api/auth/status")).setupRequired;
            case "getMonitorList": return this.getMonitorList();
            case "getMonitor": return this.getMonitor(values[0]);
            case "add": return this.addMonitor(values[0]);
            case "editMonitor": return this.editMonitor(values[0]);
            case "deleteMonitor": return this.deleteMonitor(values[0]);
            case "pauseMonitor": return this.setMonitorEnabled(values[0], false);
            case "resumeMonitor": return this.setMonitorEnabled(values[0], true);
            case "getMonitorBeats": return this.getMonitorBeats(values[0]);
            case "getMonitorChartData": return this.getMonitorChartData(values[0]);
            case "clearEvents":
            case "clearHeartbeats": return this.clearMonitorHistory(values[0]);
            case "clearStatistics": return this.clearMonitorHistory();
            case "monitorImportantHeartbeatListCount": return this.importantHeartbeatCount(values[0]);
            case "monitorImportantHeartbeatListPaged": return this.importantHeartbeatPaged(values[0], values[1], values[2]);
            case "getTags": return this.getTags();
            case "addTag": return this.addTag(values[0]);
            case "editTag": return this.editTag(values[0]);
            case "deleteTag": return this.deleteTag(values[0]);
            case "addMonitorTag":
            case "deleteMonitorTag": return this.changeMonitorTag(event, values);
            case "getStatusPage": return this.getStatusPage(values[0]);
            case "addStatusPage": return this.addStatusPage(values[0], values[1]);
            case "saveStatusPage": return this.saveStatusPage(values);
            case "deleteStatusPage": return this.deleteStatusPage(values[0]);
            case "getSettings": return this.getSettings();
            case "setSettings": return this.setSettings(values[0]);
            case "getNotificationList": return this.getNotificationList();
            case "addNotification": return values[1] ? this.editNotification({ ...values[0], id: values[1] }) : this.addNotification(values[0], values[1]);
            case "editNotification": return this.editNotification(values[0]);
            case "deleteNotification": return this.deleteNotification(values[0]);
            case "testNotification": return this.testNotification(values[0]);
            default: return unsupported();
        }
    }

    async getMonitorList() {
        const data = await request("/api/monitors?includeHistory=1");
        const monitorList = toMonitorMap(data.monitors || []);
        this.root.monitorList = monitorList;
        this.root.monitorTypeList = {
            http: { name: "HTTP(s)", supportsConditions: false },
            keyword: { name: "HTTP(s) - Keyword", supportsConditions: false },
            port: { name: "TCP Port", supportsConditions: false },
            ping: { name: "Ping", supportsConditions: false },
        };
        this.root.heartbeatList = Object.fromEntries(Object.values(monitorList).map((monitor) => [monitor.id, monitor.history || []]));
        await this.loadStatusPages();
        return responseOk({ monitorList }, "监控列表已更新");
    }

    async getMonitor(id) {
        const data = await request(`/api/monitors/${encodeURIComponent(String(id))}`);
        const monitor = toKumaMonitor(data.monitor);
        this.root.monitorList[monitor.id] = monitor;
        const results = await request(`/api/monitors/${encodeURIComponent(monitor.id)}/results?limit=90`).catch(() => ({ results: [] }));
        this.root.heartbeatList[monitor.id] = (results.results || []).reverse().map((result) => heartbeatFromResult(result, monitor.id));
        return responseOk({ monitor });
    }

    async addMonitor(source) {
        const input = toMonitorInput(source);
        if (!input) return unsupported("此监控类型暂未接入 Worker");
        const data = await request("/api/monitors", { method: "POST", body: JSON.stringify(input) });
        const monitor = toKumaMonitor(data.monitor);
        this.root.monitorList[monitor.id] = monitor;
        this.root.heartbeatList[monitor.id] = [];
        return responseOk({ monitorID: monitor.id, monitor, msg: "监控已创建" });
    }

    async editMonitor(source) {
        const id = String(source?.id || "");
        if (!id) return responseError(new Error("缺少监控 ID"));
        const input = toMonitorInput(source);
        if (!input) return unsupported("此监控类型暂未接入 Worker");
        const data = await request(`/api/monitors/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
        const monitor = toKumaMonitor(data.monitor);
        this.root.monitorList[monitor.id] = monitor;
        return responseOk({ monitor, msg: "监控已保存" });
    }

    async deleteMonitor(id) {
        await request(`/api/monitors/${encodeURIComponent(String(id))}`, { method: "DELETE" });
        delete this.root.monitorList[String(id)];
        delete this.root.heartbeatList[String(id)];
        return responseOk({}, "监控已删除");
    }

    async setMonitorEnabled(id, enabled) {
        const data = await request(`/api/monitors/${encodeURIComponent(String(id))}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
        const monitor = toKumaMonitor(data.monitor);
        this.root.monitorList[monitor.id] = monitor;
        return responseOk({ monitor }, enabled ? "监控已恢复" : "监控已暂停");
    }

    async getMonitorBeats(id) {
        const monitorId = String(id);
        const data = await request(`/api/monitors/${encodeURIComponent(monitorId)}/results?limit=90`);
        const list = (data.results || []).reverse().map((result) => heartbeatFromResult(result, monitorId));
        this.root.heartbeatList[monitorId] = list;
        return list;
    }

    async getMonitorChartData(id) {
        const list = await this.getMonitorBeats(id);
        return { ok: true, data: list, monitorID: String(id) };
    }

    async clearMonitorHistory(id) {
        const path = id ? `/api/monitors/${encodeURIComponent(String(id))}/history` : "/api/history";
        await request(path, { method: "DELETE" });
        if (id) this.root.heartbeatList[String(id)] = [];
        else this.root.heartbeatList = {};
        return responseOk({}, "历史记录已清除");
    }

    importantHeartbeats(id) {
        const ids = id ? [String(id)] : Object.keys(this.root.heartbeatList);
        return ids.flatMap((monitorId) => this.root.heartbeatList[monitorId] || []).filter((beat) => beat.important || beat.status === DOWN).sort((a, b) => new Date(b.time) - new Date(a.time));
    }

    importantHeartbeatCount(id) { return { ok: true, count: this.importantHeartbeats(id).length }; }
    importantHeartbeatPaged(id, offset = 0, limit = 25) {
        const start = Number(offset) || 0;
        return { ok: true, data: this.importantHeartbeats(id).slice(start, start + (Number(limit) || 25)) };
    }

    async getTags() {
        const data = await request("/api/tags");
        return responseOk({ tags: data.tags || [] });
    }

    async addTag(tag) {
        const data = await request("/api/tags", { method: "POST", body: JSON.stringify({ name: tag?.name, color: tag?.color }) });
        return responseOk({ tag: data.tag, msg: "标签已创建" });
    }

    async editTag(tag) {
        const data = await request(`/api/tags/${encodeURIComponent(String(tag?.id))}`, { method: "PATCH", body: JSON.stringify({ name: tag?.name, color: tag?.color }) });
        return responseOk({ tag: data.tag, msg: "标签已保存" });
    }

    async deleteTag(id) {
        await request(`/api/tags/${encodeURIComponent(String(id))}`, { method: "DELETE" });
        return responseOk({}, "标签已删除");
    }

    async changeMonitorTag(event, values) {
        const tagId = String(values[0]);
        const monitorId = String(values[1]);
        const monitor = this.root.monitorList[monitorId];
        if (!monitor) return responseError(new Error("监控不存在"));
        const tags = new Set((monitor.tags || []).map((tag) => String(tag.id)));
        if (event === "addMonitorTag") tags.add(tagId); else tags.delete(tagId);
        return this.editMonitor({ ...monitor, tags: [...tags].map((id) => ({ id })) });
    }

    async loadStatusPages(updateRoot = true) {
        const data = await request("/api/status-pages");
        const pages = (data.pages || []).map((page) => ({ ...page, icon: "/icon.svg", monitorList: [] }));
        if (updateRoot) {
            this.root.statusPageList = pages;
            this.root.statusPageListLoaded = true;
        }
        return pages;
    }

    async getStatusPage(slug) {
        const data = await request(`/api/public/status/${encodeURIComponent(String(slug))}`);
        const monitors = (data.monitors || []).map((monitor) => toKumaMonitor({ ...monitor, currentStatus: monitor.status, enabled: monitor.enabled ? 1 : 0, history: monitor.history || [] }));
        const publicGroupList = (data.groups || []).map((group) => ({
            name: group.name,
            monitorList: group.monitors.map((monitor) => toKumaMonitor({ ...monitor, currentStatus: monitor.status, enabled: monitor.enabled ? 1 : 0, history: monitor.history || [] })),
        }));
        return responseOk({ config: toKumaStatusPage(data.page, monitors), publicGroupList });
    }

    async addStatusPage(title, slug) {
        const data = await request("/api/status-pages", { method: "POST", body: JSON.stringify({ title, slug, groups: [{ name: "服务", monitorIds: [] }] }) });
        await this.loadStatusPages();
        return responseOk({ slug: data.page?.slug || slug, msg: "状态页已创建" });
    }

    async saveStatusPage(values) {
        const [slug, config, image, groups] = values;
        void image;
        const pages = await this.loadStatusPages(false);
        const page = pages.find((item) => item.slug === slug);
        if (!page) return responseError(new Error("状态页不存在"));
        const normalizedGroups = (groups || []).map((group) => ({ name: group.name, monitorIds: (group.monitorList || []).map((monitor) => String(monitor.id)) }));
        const data = await request(`/api/status-pages/${encodeURIComponent(String(page.id))}`, {
            method: "PATCH",
            body: JSON.stringify({
                title: config.title,
                slug: config.slug,
                description: config.description,
                footer: config.footerText,
                refreshSeconds: Number(config.autoRefreshInterval) || 300,
                theme: config.theme,
                showTags: Boolean(config.showTags),
                showPoweredBy: Boolean(config.showPoweredBy),
                lastHeartbeatOnly: Boolean(config.showOnlyLastHeartbeat),
                rssTitle: config.rssTitle || "",
                customCss: config.customCSS || "",
                groups: normalizedGroups.length ? normalizedGroups : [{ name: "服务", monitorIds: [] }],
            }),
        });
        await this.loadStatusPages();
        return responseOk({ publicGroupList: groups || [], config: toKumaStatusPage(data.page, []) });
    }

    async deleteStatusPage(slug) {
        const pages = await this.loadStatusPages(false);
        const page = pages.find((item) => item.slug === slug);
        if (!page) return responseError(new Error("状态页不存在"));
        await request(`/api/status-pages/${encodeURIComponent(String(page.id))}`, { method: "DELETE" });
        await this.loadStatusPages();
        return responseOk({}, "状态页已删除");
    }

    async getSettings() {
        const data = await request("/api/settings/admin");
        return responseOk({ data: mapSettings(data.settings) });
    }

    async setSettings(settings) {
        const body = {
            theme: settings.theme || settings.userTheme || "auto",
            heartbeatPosition: settings.heartbeatPosition || "bottom",
            timeDisplay: settings.timeDisplay || "relative",
            historyRetentionDays: Number(settings.historyRetentionDays ?? settings.keepDataPeriodDays ?? 30),
            maxMonitors: Number(settings.maxMonitors || 50),
            maxNodesPerMonitor: Number(settings.maxNodesPerMonitor || 5),
            maxJobsPerTick: Number(settings.maxJobsPerTick || 20),
        };
        const data = await request("/api/settings/admin", { method: "PATCH", body: JSON.stringify(body) });
        return responseOk({ data: mapSettings(data.settings), msg: "设置已保存" });
    }

    async getNotificationList() {
        const data = await request("/api/notifications");
        const notificationList = (data.channels || []).map(toKumaNotification);
        this.root.notificationList = notificationList;
        return responseOk({ notificationList });
    }

    async addNotification(notification, monitorId) {
        const type = notification.type === "qqbot" ? "qqbot" : "pushplus";
        const body = {
            type,
            name: notification.name || notification.title || "通知",
            defaultEnabled: Boolean(notification.isDefault || notification.active),
            applyToExisting: false,
            ...(type === "qqbot"
                ? { appId: notification.appId, appSecret: notification.appSecret, botSecret: notification.botSecret }
                : { token: notification.pushPlusSendKey || notification.pushPlusToken || notification.token }),
        };
        const data = await request("/api/notifications", { method: "POST", body: JSON.stringify(body) });
        const item = toKumaNotification(data.channel);
        if (monitorId) await this.bindNotification(monitorId, item.id, true);
        await this.getNotificationList();
        return responseOk({ notificationID: item.id, notification: item, msg: "通知已创建" });
    }

    async editNotification(notification) {
        const body = {
            name: notification.name,
            defaultEnabled: Boolean(notification.isDefault || notification.active),
            ...(notification.type === "qqbot"
                ? { appId: notification.appId, appSecret: notification.appSecret, botSecret: notification.botSecret }
                : { token: notification.pushPlusSendKey || notification.pushPlusToken || notification.token }),
        };
        const data = await request(`/api/notifications/${encodeURIComponent(String(notification.id))}`, { method: "PATCH", body: JSON.stringify(body) });
        await this.getNotificationList();
        return responseOk({ notification: toKumaNotification(data.channel), msg: "通知已保存" });
    }

    async deleteNotification(id) {
        await request(`/api/notifications/${encodeURIComponent(String(id))}`, { method: "DELETE" });
        await this.getNotificationList();
        return responseOk({}, "通知已删除");
    }

    async testNotification(notification) {
        const body = notification?.type === "qqbot"
            ? { type: "qqbot", appId: notification.appId, appSecret: notification.appSecret, botSecret: notification.botSecret, openid: notification.openid }
            : { type: "pushplus", token: notification?.pushPlusSendKey || notification?.pushPlusToken || notification?.token };
        await request("/api/notifications/test", { method: "POST", body: JSON.stringify(body) });
        return responseOk({}, "测试通知已发送");
    }

    async bindNotification(monitorId, channelId, enabled) {
        const current = await request(`/api/monitors/${encodeURIComponent(String(monitorId))}/notifications`);
        const bindings = (current.bindings || []).map((item) => ({ channelId: item.channelId, enabled: Boolean(item.enabled) }));
        const existing = bindings.find((item) => item.channelId === channelId);
        if (existing) existing.enabled = enabled;
        else bindings.push({ channelId, enabled });
        await request(`/api/monitors/${encodeURIComponent(String(monitorId))}/notifications`, { method: "PUT", body: JSON.stringify({ bindings, rule: current.rule }) });
    }
}

export default {
    data() {
        return {
            info: { version: FRONTEND_VERSION, latestVersion: FRONTEND_VERSION, runtime: { platform: "cloudflare" }, isContainer: false },
            socket: { firstConnect: true, connected: false, connectCount: 0, initedSocketIO: false },
            username: null,
            remember: localStorage.remember !== "0",
            allowLoginDialog: false,
            loggedIn: false,
            monitorList: {},
            monitorTypeList: {},
            maintenanceList: [],
            apiKeyList: [],
            heartbeatList: {},
            avgPingList: {},
            uptimeList: {},
            tlsInfoList: {},
            domainInfoList: {},
            notificationList: [],
            dockerHostList: [],
            remoteBrowserList: [],
            statusPageListLoaded: false,
            statusPageList: [],
            proxyList: [],
            connectionErrorMsg: "无法连接到实时服务，正在重试…",
            showReverseProxyGuide: false,
            cloudflared: { cloudflareTunnelToken: "", installed: null, running: false, message: "", errorMessage: "", currentPassword: "" },
            faviconUpdateDebounce: null,
            emitter: mitt(),
        };
    },

    created() {
        socket = new KumaSocket(this);
        this.initSocketIO();
        window.addEventListener("kuma-auth-changed", this.onAuthChanged);
    },

    beforeUnmount() {
        window.removeEventListener("kuma-auth-changed", this.onAuthChanged);
        realtimeUnsubscribe?.();
        realtime?.close();
        socket?.disconnect();
    },

    methods: {
        async onAuthChanged(event) {
            const user = event.detail;
            if (!user) {
                this.loggedIn = false;
                this.username = null;
                this.allowLoginDialog = true;
                socket?.disconnect();
                return;
            }
            this.loggedIn = true;
            this.username = user.username;
            this.allowLoginDialog = false;
            await this.startRealtime();
        },

        async initSocketIO(bypass = false) {
            if (!bypass && (/^\/$/.test(location.pathname) || /^\/status/.test(location.pathname))) return;
            if (this.socket.initedSocketIO && !bypass) return;
            this.socket.initedSocketIO = true;
            try {
                const status = await request("/api/auth/status");
                if (status.setupRequired) {
                    if (location.pathname !== "/setup") this.$router.push("/setup");
                    return;
                }
                if (status.authenticated) {
                    this.loggedIn = true;
                    this.username = status.user?.username || null;
                    this.allowLoginDialog = false;
                    await this.startRealtime();
                } else {
                    this.loggedIn = false;
                    this.allowLoginDialog = true;
                }
            } catch (error) {
                this.socket.connected = false;
                this.socket.firstConnect = false;
                this.connectionErrorMsg = error.message;
            }
        },

        async startRealtime() {
            socket?.connect();
            await socket?.emit("getMonitorList").catch(() => {});
            await socket?.emit("getNotificationList").catch(() => {});
            realtimeUnsubscribe?.();
            realtimeUnsubscribe = onRealtimeEvent((event) => this.onRealtimeEvent(event));
            realtime?.close();
            realtime = new RealtimeClient((state) => {
                this.socket.connected = state === "connected";
                this.socket.firstConnect = false;
                if (state === "disconnected") this.connectionErrorMsg = "实时连接已断开，正在重试…";
            });
            realtime.connect();
        },

        async onRealtimeEvent(event) {
            const before = { ...this.lastHeartbeatList };
            if (event.scope === "status-pages") await socket.loadStatusPages();
            else if (event.scope === "settings") await socket.emit("getSettings").catch(() => {});
            else if (event.monitorId) await socket.getMonitor(event.monitorId);
            else await socket.getMonitorList();
            for (const [monitorID, heartbeat] of Object.entries(this.lastHeartbeatList)) {
                if (heartbeat && (!before[monitorID] || before[monitorID].id !== heartbeat.id)) this.handleHeartbeat(heartbeat);
            }
        },

        handleHeartbeat(data) {
            this.emitter.emit("newImportantHeartbeat", data);
            const monitor = this.monitorList[data.monitorID];
            if (!monitor || !data.important) return;
            if (data.status === DOWN) toast.error(`[${monitor.name}] [DOWN] ${data.msg}`, { timeout: getToastErrorTimeout() });
            else if (data.status === UP) toast.success(`[${monitor.name}] [Up] ${data.msg}`, { timeout: getToastSuccessTimeout() });
            else toast(`[${monitor.name}] ${data.msg}`);
        },

        storage() { return this.remember ? localStorage : sessionStorage; },
        getSocket() { return socket; },
        applyTranslation(msg) { return msg && typeof msg === "object" ? this.$t(msg.key, msg.values) : this.$t(msg); },
        toastRes(res) {
            if (!res) return;
            const msg = res.msgi18n ? this.applyTranslation(res.msg) : res.msg;
            res.ok ? toast.success(msg) : toast.error(msg);
        },
        toastSuccess(msg) { toast.success(this.$t(msg)); },
        toastError(msg) { toast.error(this.$t(msg)); },

        async logout() {
            await authLogout();
            this.loggedIn = false;
            this.username = null;
            this.allowLoginDialog = true;
            socket?.disconnect();
            realtime?.close();
            this.clearData();
            this.$router.push("/dashboard");
        },

        clearData() { this.heartbeatList = {}; },
        assignMonitorUrlParser(data) { return data; },
    },

    computed: {
        usernameFirstChar() { return typeof this.username === "string" && this.username.length ? this.username.charAt(0).toUpperCase() : "U"; },
        lastHeartbeatList() {
            const result = {};
            for (const [monitorID, list] of Object.entries(this.heartbeatList)) result[monitorID] = list?.at(-1);
            return result;
        },
        statusList() {
            const result = {};
            for (const [monitorID, beat] of Object.entries(this.lastHeartbeatList)) {
                if (!beat) result[monitorID] = { text: this.$t("Unknown"), color: "secondary" };
                else if (beat.status === UP) result[monitorID] = { text: this.$t("Up"), color: "primary" };
                else if (beat.status === DOWN) result[monitorID] = { text: this.$t("Down"), color: "danger" };
                else if (beat.status === PENDING) result[monitorID] = { text: this.$t("Pending"), color: "warning" };
                else if (beat.status === MAINTENANCE) result[monitorID] = { text: this.$t("statusMaintenance"), color: "maintenance" };
                else result[monitorID] = { text: this.$t("Unknown"), color: "secondary" };
            }
            return result;
        },
        stats() {
            const result = { active: 0, up: 0, down: 0, maintenance: 0, pending: 0, unknown: 0, pause: 0 };
            for (const [monitorID, monitor] of Object.entries(this.monitorList)) {
                if (!monitor.active) { result.pause++; continue; }
                result.active++;
                const status = this.lastHeartbeatList[monitorID]?.status;
                if (status === UP) result.up++;
                else if (status === DOWN) result.down++;
                else if (status === PENDING) result.pending++;
                else if (status === MAINTENANCE) result.maintenance++;
                else result.unknown++;
            }
            return result;
        },
        frontendVersion() { return FRONTEND_VERSION; },
        isFrontendBackendVersionMatched() { return true; },
    },

    watch: {
        "stats.down"(to, from) {
            if (to !== from) {
                clearTimeout(this.faviconUpdateDebounce);
                this.faviconUpdateDebounce = setTimeout(() => favicon.badge(to), 1000);
            }
        },
        remember() { localStorage.remember = this.remember ? "1" : "0"; },
        "$route.fullPath"() { this.initSocketIO(); },
    },
};

export function reconnectSocket() {
    socket?.disconnect();
    socket?.connect();
}
