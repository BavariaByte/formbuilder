<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { X, ChevronRight, Loader, AlertCircle } from 'lucide-vue-next';
import { useGraphStore, useEditorStore } from '@/store';
import { importPlaybook, extractGlobalConfig } from '@/engine/importer';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();

const emit = defineEmits<{
  close: [];
  loaded: [];
}>();

const graphStore = useGraphStore();
const editorStore = useEditorStore();

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TemplateMeta {
  id: string;      // filename without .json
  name: string;
  desc: string;
  rawData: Record<string, any>;
}

// ─── State ─────────────────────────────────────────────────────────────────────

const templates = ref<TemplateMeta[]>([]);
const fetchError = ref<string | null>(null);
const isFetching = ref(true);

const selectedId = ref<string | null>(null);
const isLoading = ref(false);
const loadError = ref<string | null>(null);

const selected = computed(() => templates.value.find(t => t.id === selectedId.value) ?? null);
const canLoad = computed(() => selected.value !== null && !isLoading.value);

// ─── Discovery: fetch directory listing then each file ─────────────────────────

onMounted(async () => {
  const base = `${import.meta.env.BASE_URL}template_playbooks/`;
  try {
    const listRes = await fetch(base);
    if (!listRes.ok) throw new Error(t('modals.template.listingError', { status: listRes.status }));

    const listing: Array<{ name: string; type: string }> = await listRes.json();
    const jsonFiles = listing.filter(e => e.type === 'file' && e.name.endsWith('.json'));

    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        const res = await fetch(`${base}${entry.name}`);
        if (!res.ok) throw new Error(t('modals.template.fileUnreadable', { name: entry.name }));
        const data = await res.json();
        return {
          id: entry.name.replace(/\.json$/, ''),
          name: data.name ?? entry.name,
          desc: data.desc ?? '',
          rawData: data,
        } satisfies TemplateMeta;
      })
    );

    templates.value = results;
  } catch (e) {
    fetchError.value = (e as Error).message;
  } finally {
    isFetching.value = false;
  }
});

// ─── Load selected template ─────────────────────────────────────────────────────

async function handleLoad() {
  if (!selected.value) return;
  isLoading.value = true;
  loadError.value = null;
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve)); // wait for browser to paint overlay

  localStorage.removeItem('formbuilder-state');

  const { name: _n, desc: _d, ...playbookData } = selected.value.rawData;

  const result = importPlaybook(JSON.stringify(playbookData));

  if (!result.success) {
    loadError.value = result.errors.join('\n');
    isLoading.value = false;
    return;
  }

  if (result.state) {
    graphStore.setImporting(true);
    graphStore.reset();
    for (const [, node] of result.state.nodes) graphStore.addNode(node);
    for (const edge of result.state.edges) graphStore.addEdge(edge);

    const config = extractGlobalConfig(playbookData as any);
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
      ...config.calculation,
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

  editorStore.clearSelection();

  // Close modal first, then trigger canvas rebuild so destroyEditor() doesn't block the modal close
  isLoading.value = false;
  emit('loaded');
  await nextTick();

  if (result.state) {
    graphStore.signalImport();
    graphStore.setImporting(false);
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">

      <!-- Header -->
      <div class="modal-header">
        <div>
          <h2>{{ t('modals.template.title') }}</h2>
          <p class="subtitle">{{ t('modals.template.subtitle') }}</p>
        </div>
        <button class="btn-close" @click="emit('close')">
          <X :size="18" />
        </button>
      </div>

      <!-- Body -->
      <div class="modal-body">

        <!-- Import loading overlay -->
        <div v-if="isLoading" class="import-loading-overlay">
          <div class="import-spinner" />
          <span>{{ t('modals.import.buildingCanvas') }}</span>
        </div>

        <!-- Loading skeleton -->
        <div v-if="isFetching" class="state-info">
          <Loader :size="20" class="spin" />
          <span>{{ t('modals.template.loading') }}</span>
        </div>

        <!-- Fetch error -->
        <div v-else-if="fetchError" class="state-info error">
          <AlertCircle :size="20" />
          <span>{{ fetchError }}</span>
        </div>

        <!-- Empty folder -->
        <div v-else-if="templates.length === 0" class="state-info muted">
          <span>{{ t('modals.template.noTemplates') }}</span>
        </div>

        <!-- Template list -->
        <div v-else class="template-list">
          <button
            v-for="tpl in templates"
            :key="tpl.id"
            class="template-card"
            :class="{ selected: selectedId === tpl.id }"
            @click="selectedId = tpl.id; loadError = null"
            @dblclick="handleLoad"
          >
            <span class="card-name">{{ tpl.name }}</span>
            <span class="card-desc">{{ tpl.desc }}</span>
          </button>
        </div>

        <!-- Load error -->
        <div v-if="loadError" class="load-error">
          <AlertCircle :size="14" />
          {{ loadError }}
        </div>

      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <span class="hint">{{ t('modals.template.dblClickHint') }}</span>
        <div class="actions">
          <button class="btn-cancel" @click="emit('close')">{{ t('modals.template.cancel') }}</button>
          <button class="btn-load" :disabled="!canLoad" @click="handleLoad">
            <Loader v-if="isLoading" :size="14" class="spin" />
            <ChevronRight v-else :size="14" />
            {{ isLoading ? t('modals.template.loadingBtn') : t('modals.template.load') }}
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Overlay ──────────────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

/* ── Modal ────────────────────────────────────────────────────────────────── */
.modal {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 680px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  position: relative;
}

/* ── Header ───────────────────────────────────────────────────────────────── */
.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 1rem;
  background: var(--color-header-bg);
  flex-shrink: 0;
}

.modal-header h2 {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-header-text);
  margin-bottom: 0.15rem;
}

.subtitle {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.55);
}

.btn-close {
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: var(--radius-sm);
  color: rgba(255,255,255,0.75);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.btn-close:hover {
  background: rgba(255,255,255,0.2);
  color: #fff;
}

/* ── Body ─────────────────────────────────────────────────────────────────── */
.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
}

/* State messages */
.state-info {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 2rem;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.state-info.error { color: var(--color-error); }
.state-info.muted { color: var(--color-text-muted); }

/* ── Template list ────────────────────────────────────────────────────────── */
.template-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

/* ── Card ─────────────────────────────────────────────────────────────────── */
.template-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 1rem 1.1rem;
  background: var(--color-bg-tertiary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  color: inherit;
}

.template-card:hover {
  border-color: var(--color-grey-400);
  box-shadow: var(--shadow-sm);
}

.template-card.selected {
  border-color: var(--color-accent);
  background: rgba(var(--color-accent-rgb), 0.06);
}

.card-name {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.card-desc {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Load error */
.load-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.75rem;
  padding: 0.6rem 0.8rem;
  background: rgba(var(--color-error-rgb), 0.06);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--color-error);
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.5rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  flex-shrink: 0;
}

.hint {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.btn-cancel {
  padding: 0.45rem 1rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-cancel:hover {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.btn-load {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 1.1rem;
  background: var(--color-accent);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-night);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.btn-load:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-load:disabled {
  background: var(--color-grey-300);
  color: var(--color-grey-500);
  cursor: not-allowed;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }

.import-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
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

@media (max-width: 480px) {
  .template-list { grid-template-columns: 1fr; }
  .hint { display: none; }
}
</style>
