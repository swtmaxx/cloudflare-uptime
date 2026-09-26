<template>
    <div class="mb-3">
        <label for="qq-app-id" class="form-label">QQ AppID</label>
        <input id="qq-app-id" v-model="$parent.notification.appId" class="form-control" required />
        <label for="qq-app-secret" class="form-label mt-3">QQ AppSecret</label>
        <HiddenInput id="qq-app-secret" v-model="$parent.notification.appSecret" :required="true" />
        <label for="qq-openid" class="form-label mt-3">测试 OpenID</label>
        <input id="qq-openid" v-model="$parent.notification.openid" class="form-control" />
    </div>
</template>

<script>
import HiddenInput from "../HiddenInput.vue";

export default {
    components: { HiddenInput },
};
</script>
