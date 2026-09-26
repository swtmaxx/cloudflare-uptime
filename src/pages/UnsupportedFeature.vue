<template>
    <div class="shadow-box unsupported-feature">
        <font-awesome-icon icon="ban" size="3x" class="mb-3 text-secondary" />
        <h1>{{ title }}</h1>
        <p>当前 Worker 版本暂不支持此功能。</p>
        <button type="button" class="btn btn-primary" @click="$router.back()">返回</button>
    </div>
</template>

<script>
export default {
    props: {
        title: {
            type: String,
            default: "功能暂不可用",
        },
    },
};
</script>

<style scoped>
.unsupported-feature {
    min-height: 280px;
    text-align: center;
    padding: 64px 24px;
}
</style>
