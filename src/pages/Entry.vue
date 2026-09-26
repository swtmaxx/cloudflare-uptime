<template>
    <div>
        <StatusPage v-if="statusPageSlug" :override-slug="statusPageSlug" />
    </div>
</template>

<script>
import StatusPage from "./StatusPage.vue";

export default {
    components: {
        StatusPage,
    },
    data() {
        return {
            statusPageSlug: null,
        };
    },
    async mounted() {
        try {
            const status = await fetch("/api/auth/status", { credentials: "same-origin" });
            const data = await status.json().catch(() => ({}));
            if (data.setupRequired) {
                this.$router.push("/setup");
                return;
            }
            this.statusPageSlug = "home";
            this.$root.forceStatusPageTheme = true;
        } catch (e) {
            console.error("Cannot load the public status page", e);
        }
    },
};
</script>
