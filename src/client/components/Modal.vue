<script setup lang="ts">
withDefaults(defineProps<{ wide?: boolean; className?: string }>(), { wide: false, className: '' });
const emit = defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <div class="modal-layer" data-modal>
    <section :class="`modal${wide ? ' status-editor-modal' : ''}${className ? ` ${className}` : ''}`">
      <button class="close" type="button" aria-label="关闭" @click="emit('close')">×</button>
      <slot />
    </section>
  </div>
</template>
