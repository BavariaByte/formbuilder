<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useGraphStore, useValidationStore } from '@/store';
import { exportPlaybook, downloadJson, type ExportContext } from '@/engine/exporter';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();

const emit = defineEmits<{
  close: [];
}>();

// Stores
const graphStore = useGraphStore();
const validationStore = useValidationStore();

const { canExport } = storeToRefs(validationStore);

// State
const jsonOutput = ref('');
const unreachableNodes = ref<string[]>([]);
const copied = ref(false);
const prettyPrint = ref(true);

const translationWarnings = computed(() => {
  return validationStore.warnings.filter(w => w.message.startsWith('Missing translations'));
});

// Generate JSON preview
onMounted(async () => {
  generatePreview();
});

function generatePreview() {
  const context: ExportContext = {
    nodes: graphStore.nodes,
    edges: graphStore.edges,
    meta: graphStore.meta,
    i18n: graphStore.i18n,
    form: graphStore.form,
    runtime: graphStore.runtime,
    variables: graphStore.variables,
    calculation: graphStore.calculation,
    flow: graphStore.flow,
    version: graphStore.version,
    schemaId: graphStore.schemaId,
    schemaHash: graphStore.schemaHash,
  };

  const result = exportPlaybook(context, { prettyPrint: prettyPrint.value });
  
  if (result.success && result.json) {
    jsonOutput.value = result.json;
    unreachableNodes.value = result.unreachableNodes;
  }
}

// Download JSON
function handleDownload() {
  if (!jsonOutput.value) return;
  
  const filename = `${graphStore.meta.id || 'playbook'}.json`;
  downloadJson(jsonOutput.value, filename);
  emit('close');
}

// Copy to clipboard
async function handleCopy() {
  if (!jsonOutput.value) return;
  
  try {
    await navigator.clipboard.writeText(jsonOutput.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch (e) {
    console.error('Failed to copy:', e);
  }
}

// Watch prettyPrint toggle
function togglePrettyPrint() {
  prettyPrint.value = !prettyPrint.value;
  generatePreview();
}

</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal modal-wide">
      <div class="modal-header">
        <h2>{{ t('modals.export.title') }}</h2>
        <button class="btn-close" @click="emit('close')">×</button>
      </div>

      <div class="modal-body">
        <!-- Translation Warning -->
        <div v-if="translationWarnings.length > 0" class="warning-box">
          <strong>⚠️ {{ t('modals.export.missingTranslations') }}</strong>
          <ul>
            <li v-for="w in translationWarnings" :key="w.id">
              {{ w.message }}
            </li>
          </ul>
        </div>


        <!-- Options -->
        <div class="options">
          <label class="checkbox-option">
            <input type="checkbox" :checked="prettyPrint" @change="togglePrettyPrint" />
            <span>{{ t('modals.export.prettyPrint') }}</span>
          </label>
        </div>

        <!-- JSON Preview -->
        <div class="json-preview">
          <div class="preview-header">
            <span>{{ t('modals.export.preview') }}</span>
            <span class="file-size">{{ (jsonOutput.length / 1024).toFixed(1) }} KB</span>
          </div>
          <pre><code>{{ jsonOutput }}</code></pre>
        </div>
      </div>

      <div class="modal-footer">
        <button class="secondary" @click="emit('close')">{{ t('modals.export.cancel') }}</button>
        <button class="secondary" @click="handleCopy">
          {{ copied ? t('modals.export.copied') : t('modals.export.copy') }}
        </button>
        <button @click="handleDownload" :disabled="!canExport">
          {{ t('modals.export.download') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.modal-wide {
  max-width: 800px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  font-size: 1.125rem;
  font-weight: 600;
}

.btn-close {
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  font-size: 1.5rem;
  color: var(--color-text-muted);
}

.btn-close:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.warning-box {
  padding: 1rem;
  background: rgba(var(--color-warning-rgb), 0.1);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  margin-bottom: 1rem;
}

.warning-box strong {
  display: block;
  color: var(--color-amber-deep);
  margin-bottom: 0.25rem;
}

.warning-box p {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.warning-box ul {
  font-size: 0.75rem;
  font-family: var(--font-mono);
  padding-left: 1.5rem;
  margin: 0;
}

.options {
  margin-bottom: 1rem;
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.checkbox-option input {
  width: auto;
}

.checkbox-option span {
  font-size: 0.875rem;
}

.json-preview {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--color-bg-tertiary);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.file-size {
  color: var(--color-text-muted);
}

.json-preview pre {
  max-height: 400px;
  overflow: auto;
  margin: 0;
  padding: 1rem;
  background: var(--color-bg-primary);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  line-height: 1.4;
}

.json-preview code {
  color: var(--color-text-primary);
}
</style>
