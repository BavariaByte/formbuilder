<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useGraphStore, useEditorStore } from '@/store';
import { importPlaybook, importPlaybookFromFile, extractGlobalConfig } from '@/engine/importer';
import type { ImportWarning } from '@/types/editor';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();

const emit = defineEmits<{
  close: [];
}>();

// Stores
const graphStore = useGraphStore();
const editorStore = useEditorStore();

// State
const jsonInput = ref('');
const importing = ref(false);
const error = ref<string | null>(null);
const warnings = ref<ImportWarning[]>([]);

// Handle text import
async function handleImport() {
  if (!jsonInput.value.trim()) {
    error.value = t('modals.import.errorEmpty');
    return;
  }

  importing.value = true;
  error.value = null;
  warnings.value = [];
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve)); // wait for browser to paint overlay

  const result = importPlaybook(jsonInput.value);

  if (!result.success) {
    error.value = result.errors.join('\n');
    importing.value = false;
    return;
  }

  if (result.state) {
    // Set importing flag BEFORE adding nodes to prevent nodeCount watcher from triggering
    graphStore.setImporting(true);
    graphStore.reset();

    for (const [, node] of result.state.nodes) {
      graphStore.addNode(node);
    }

    for (const edge of result.state.edges) {
      graphStore.addEdge(edge);
    }

    const parsed = JSON.parse(jsonInput.value);
    const config = extractGlobalConfig(parsed);

    graphStore.meta = config.meta;
    graphStore.i18n = config.i18n;
    graphStore.form = config.form;
    graphStore.runtime = config.runtime;
    graphStore.variables = config.variables;
    graphStore.calculation = {
      checkboxOptionOrder: 'definition',
      onDivZero: 'skip',
      rounding: 2,
      effectOrder: 'action-option',
      ...config.calculation
    };
    graphStore.flow = {
      routingPriority: 'options-first',
      ...config.flow,
      end: 'submit',
    };
    graphStore.version = config.version || '';
    graphStore.schemaId = config.schemaId;
    graphStore.schemaHash = config.schemaHash;

    editorStore.setCurrentLocale(config.i18n.defaultLocale || 'de-DE');

    if (config.nodePositions) {
      editorStore.setPendingPositions(config.nodePositions);
    }
  }

  warnings.value = result.warnings;
  importing.value = false;

  if (warnings.value.length === 0) {
    emit('close');
  }

  // Trigger canvas rebuild AFTER modal is closed so destroyEditor() doesn't block the modal close
  await nextTick();
  if (result.state) {
    graphStore.signalImport();
    graphStore.setImporting(false);
  }
}

// Handle file upload
async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
    error.value = t('modals.import.invalidFile');
    input.value = '';
    return;
  }

  importing.value = true;
  error.value = null;

  const result = await importPlaybookFromFile(file);

  if (!result.success) {
    error.value = result.errors.join('\n');
    importing.value = false;
    return;
  }

  const text = await file.text();
  jsonInput.value = text;
  await handleImport();
}

// Close with warnings
function closeWithWarnings() {
  emit('close');
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ t('modals.import.title') }}</h2>
        <button class="btn-close" @click="emit('close')">×</button>
      </div>

      <div class="modal-body">
        <!-- Loading Overlay -->
        <div v-if="importing" class="import-loading-overlay">
          <div class="import-spinner" />
          <span>{{ t('modals.import.importing') }}</span>
        </div>

        <!-- File Upload -->
        <div class="upload-section">
          <label class="upload-label">
            <input type="file" accept=".json" @change="handleFileUpload" hidden />
            <span class="upload-icon">📁</span>
            <span>{{ t('modals.import.chooseFile') }}</span>
          </label>
          <span class="or-divider">{{ t('modals.import.orPaste') }}</span>
        </div>

        <!-- Text Input -->
        <div class="field">
          <textarea
            v-model="jsonInput"
            placeholder='{"type": "form-definition", ...}'
            rows="12"
            :disabled="importing"
          />
        </div>

        <!-- Error -->
        <div v-if="error" class="error-box">
          <strong>{{ t('modals.import.errorTitle') }}</strong>
          <pre>{{ error }}</pre>
        </div>

        <!-- Warnings -->
        <div v-if="warnings.length > 0" class="warnings-box">
          <strong>{{ t('modals.import.warningsTitle') }}</strong>
          <ul>
            <li v-for="(warning, i) in warnings" :key="i">
              {{ warning.message }}
            </li>
          </ul>
          <button @click="closeWithWarnings">{{ t('modals.import.continueAnyway') }}</button>
        </div>
      </div>

      <div class="modal-footer">
        <button class="secondary" @click="emit('close')">{{ t('modals.import.cancel') }}</button>
        <button 
          :disabled="!jsonInput.trim() || importing"
          @click="handleImport"
        >
          {{ importing ? t('modals.import.importing') : t('modals.import.import') }}
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
  position: relative;
  overflow: hidden;
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

.upload-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.upload-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--color-bg-tertiary);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.upload-label:hover {
  border-color: var(--color-accent);
  background: rgba(var(--color-accent-rgb), 0.08);
}

.upload-icon {
  font-size: 1.25rem;
}

.or-divider {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.field textarea {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  resize: vertical;
}

.error-box {
  margin-top: 1rem;
  padding: 1rem;
  background: rgba(var(--color-error-rgb), 0.08);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
}

.error-box strong {
  display: block;
  color: var(--color-error);
  margin-bottom: 0.5rem;
}

.error-box pre {
  font-size: 0.75rem;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
}

.warnings-box {
  margin-top: 1rem;
  padding: 1rem;
  background: rgba(var(--color-warning-rgb), 0.1);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
}

.warnings-box strong {
  display: block;
  color: var(--color-amber-deep);
  margin-bottom: 0.5rem;
}

.warnings-box ul {
  font-size: 0.75rem;
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.warnings-box button {
  margin-top: 0.5rem;
}

.import-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  border-radius: var(--radius-lg);
  z-index: 10;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 500;
}

.import-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
