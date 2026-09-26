import { createRouter, createWebHistory } from "vue-router";

import EmptyLayout from "./layouts/EmptyLayout.vue";
import Layout from "./layouts/Layout.vue";
import Dashboard from "./pages/Dashboard.vue";
import DashboardHome from "./pages/DashboardHome.vue";
import Details from "./pages/Details.vue";
import EditMonitor from "./pages/EditMonitor.vue";
import List from "./pages/List.vue";
const Settings = () => import("./pages/Settings.vue");
import Setup from "./pages/Setup.vue";
import StatusPage from "./pages/StatusPage.vue";
import Entry from "./pages/Entry.vue";
import ManageStatusPage from "./pages/ManageStatusPage.vue";
import AddStatusPage from "./pages/AddStatusPage.vue";
import NotFound from "./pages/NotFound.vue";
import UnsupportedFeature from "./pages/UnsupportedFeature.vue";

// Settings - Sub Pages
import Appearance from "./components/settings/Appearance.vue";
import General from "./components/settings/General.vue";
const Notifications = () => import("./components/settings/Notifications.vue");
import Tags from "./components/settings/Tags.vue";
import About from "./components/settings/About.vue";

const routes = [
    {
        path: "/",
        component: Entry,
    },
    {
        // If it is "/dashboard", the active link is not working
        // If it is "", it overrides the "/" unexpectedly
        // Give a random name to solve the problem.
        path: "/empty",
        component: Layout,
        children: [
            {
                path: "",
                component: Dashboard,
                children: [
                    {
                        name: "DashboardHome",
                        path: "/dashboard",
                        component: DashboardHome,
                        children: [
                            {
                                path: "/dashboard/:id",
                                component: EmptyLayout,
                                children: [
                                    {
                                        path: "",
                                        component: Details,
                                    },
                                    {
                                        path: "/edit/:id",
                                        component: EditMonitor,
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        path: "/add",
                        component: EditMonitor,
                        children: [
                            {
                                path: "/clone/:id",
                                component: EditMonitor,
                            },
                        ],
                    },
                    {
                        path: "/list",
                        component: List,
                    },
                    {
                        path: "/settings",
                        component: Settings,
                        children: [
                            {
                                path: "general",
                                component: General,
                            },
                            {
                                path: "appearance",
                                component: Appearance,
                            },
                            {
                                path: "notifications",
                                component: Notifications,
                            },
                            {
                                path: "reverse-proxy",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "tags",
                                component: Tags,
                            },
                            {
                                path: "monitor-history",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "docker-hosts",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "remote-browsers",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "security",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "api-keys",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "proxies",
                                component: UnsupportedFeature,
                            },
                            {
                                path: "about",
                                component: About,
                            },
                        ],
                    },
                    {
                        path: "/manage-status-page",
                        component: ManageStatusPage,
                    },
                    {
                        path: "/add-status-page",
                        component: AddStatusPage,
                    },
                    {
                        path: "/maintenance",
                        component: UnsupportedFeature,
                    },
                    {
                        path: "/add-maintenance",
                        component: UnsupportedFeature,
                    },
                    {
                        path: "/maintenance/edit/:id",
                        component: UnsupportedFeature,
                    },
                    {
                        path: "/maintenance/clone/:id",
                        component: UnsupportedFeature,
                    },
                ],
            },
        ],
    },
    {
        path: "/setup",
        component: Setup,
    },
    {
        path: "/setup-database",
        component: UnsupportedFeature,
    },
    {
        path: "/status-page",
        component: StatusPage,
    },
    {
        path: "/status",
        component: StatusPage,
    },
    {
        path: "/status/:slug",
        component: StatusPage,
    },
    {
        path: "/:pathMatch(.*)*",
        component: NotFound,
    },
];

export const router = createRouter({
    linkActiveClass: "active",
    history: createWebHistory(),
    routes,
});
