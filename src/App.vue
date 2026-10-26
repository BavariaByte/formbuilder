<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useGraphStore, useEditorStore, useValidationStore } from '@/store';
import EditorCanvas from '@/components/editor/EditorCanvas.vue';
import Toolbar from '@/components/editor/Toolbar.vue';
import Inspector from '@/components/inspector/Inspector.vue';
import GlobalPanels from '@/components/panels/GlobalPanels.vue';
import ProblemsPanel from '@/components/problems/ProblemsPanel.vue';
import ImportModal from '@/components/modals/ImportModal.vue';
import ExportModal from '@/components/modals/ExportModal.vue';
import TemplateModal from '@/components/modals/TemplateModal.vue';
import { validateGraph } from '@/engine/validator';
import { useAppI18n, persistUiLocale } from '@/composables/useAppI18n';

// Stores
const graphStore = useGraphStore();
const editorStore = useEditorStore();
const validationStore = useValidationStore();

const { t } = useAppI18n();
const { uiLocale } = storeToRefs(editorStore);

function setUiLocale(locale: 'de' | 'en') {
  if (uiLocale.value === locale) return;
  editorStore.setUiLocale(locale);
  persistUiLocale(locale);
}

// Refs
const { showProblemsPanel, showInspector, showImportModal, showExportModal, showTemplateModal } = storeToRefs(editorStore);

// Track if the template modal was opened on first load (so cancel → empty graph)
const isFirstLoad = ref(false);
const { nodes, edges, variables } = storeToRefs(graphStore);
const { errorCount, warningCount, canExport } = storeToRefs(validationStore);

// Editor canvas ref
const editorCanvasRef = ref<InstanceType<typeof EditorCanvas> | null>(null);



// Initialize graph on mount - restore from session or show template picker
onMounted(() => {
  if (!restoreFromSession()) {
    isFirstLoad.value = true;
    editorStore.openTemplateModal();
  }
});

function handleTemplateClose() {
  editorStore.closeTemplateModal();
  // If user cancelled on first load, initialise an empty graph so the canvas isn't empty
  if (isFirstLoad.value) {
    graphStore.initializeEmptyGraph();
    isFirstLoad.value = false;
  }
}

function handleTemplateLoaded() {
  editorStore.closeTemplateModal();
  isFirstLoad.value = false;
}

// Real-time validation
watch(
  [nodes, edges, variables, () => graphStore.meta, () => graphStore.form, () => graphStore.runtime],
  () => {
    const issues = validateGraph({
      nodes: nodes.value,
      edges: edges.value,
      variables: variables.value,
      meta: graphStore.meta,
      form: graphStore.form,
      runtime: graphStore.runtime,
      i18n: graphStore.i18n,
      flowStart: graphStore.flow.start,
    });
    validationStore.setIssues(issues);
  },
  { deep: true }
);

// Auto-Save (survives page reload and tab close)
const SESSION_KEY = 'formbuilder-state';
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function saveToSession() {
  try {
    const state = {
      nodes: Array.from(nodes.value.entries()),
      edges: edges.value,
      meta: graphStore.meta,
      i18n: graphStore.i18n,
      form: graphStore.form,
      runtime: graphStore.runtime,
      variables: variables.value,
      calculation: graphStore.calculation,
      flow: graphStore.flow,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

function isDefaultEmptyState(state: { nodes: [string, unknown][]; edges: unknown[]; variables: unknown[] }): boolean {
  const nodeEntries = state.nodes ?? [];
  if (nodeEntries.length !== 2) return false;
  const nodeIds = nodeEntries.map(([id]) => id);
  if (!nodeIds.includes('__start__') || !nodeIds.includes('__end__')) return false;
  if ((state.edges ?? []).length > 0) return false;
  if ((state.variables ?? []).length > 0) return false;
  return true;
}

function restoreFromSession(): boolean {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return false;

    const state = JSON.parse(saved);

    // Treat a cached default empty graph as if nothing was saved → open template picker
    if (isDefaultEmptyState(state)) return false;

    // Restore nodes
    graphStore.nodes.clear();
    for (const [id, node] of state.nodes) {
      graphStore.nodes.set(id, node);
    }
    
    // Restore edges
    graphStore.edges.splice(0, graphStore.edges.length, ...state.edges);
    
    // Restore global config
    Object.assign(graphStore.meta, state.meta);
    Object.assign(graphStore.i18n, state.i18n);
    Object.assign(graphStore.form, state.form);
    Object.assign(graphStore.runtime, state.runtime);
    graphStore.variables.splice(0, graphStore.variables.length, ...state.variables);
    const { routingPriority: legacyRp, ...savedCalc } = state.calculation || {};
    graphStore.calculation = {
      checkboxOptionOrder: 'definition',
      onDivZero: 'skip',
      rounding: 2,
      effectOrder: 'action-option',
      ...savedCalc
    };
    graphStore.flow = {
      end: 'submit',
      routingPriority: 'options-first',
      ...(legacyRp && !state.flow?.routingPriority ? { routingPriority: legacyRp } : {}),
      ...state.flow
    };

    return true;
  } catch (e) {
    console.warn('Failed to restore session:', e);
    return false;
  }
}

// Auto-save watcher (debounced)
watch(
  [nodes, edges, variables, () => graphStore.meta, () => graphStore.flow, () => graphStore.runtime, () => graphStore.calculation],
  () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveToSession, 500);
  },
  { deep: true }
);

// Keyboard shortcuts
function handleKeydown(event: KeyboardEvent) {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }

  if (
    editorStore.showImportModal ||
    editorStore.showExportModal ||
    editorStore.showTemplateModal ||
    editorStore.showVariableDeleteConfirm
  ) {
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    const selectedIds = Array.from(editorStore.selectedNodeIds);
    for (const id of selectedIds) {
      if (id !== '__start__' && id !== '__end__') {
        graphStore.removeNode(id);
      }
    }
    editorStore.clearSelection();
    event.preventDefault();
  }

  if (event.ctrlKey && event.key === 'i') {
    editorStore.openImportModal();
    event.preventDefault();
  }

  if (event.ctrlKey && event.key === 'e') {
    if (canExport.value) {
      editorStore.openExportModal();
    }
    event.preventDefault();
  }

  if (event.key === 'Escape') {
    editorStore.clearSelection();
    event.preventDefault();
  }
}

// Toolbar zoom handlers
function handleZoomIn() {
  editorCanvasRef.value?.zoomIn();
}

function handleZoomOut() {
  editorCanvasRef.value?.zoomOut();
}

function handleResetZoom() {
  editorCanvasRef.value?.resetZoom();
}

function handleReLayout() {
  editorCanvasRef.value?.reLayout();
}

// Layout classes
const mainLayoutClass = computed(() => ({
  'show-inspector': showInspector.value,
  'show-problems': showProblemsPanel.value,
}));
</script>

<template>
  <div class="app" @keydown="handleKeydown" tabindex="0">
    <!-- Header -->
    <header class="app-header">
      <div class="app-logo">
        <img src="@/assets/logo-light.svg" alt="girp" class="logo-img" />
        <span class="logo-wordmark">Guided Incident Response</span>
      </div>
      <div class="app-status">
        <!-- UI Language Toggle -->
        <div class="lang-toggle">
          <button class="lang-btn" :class="{ active: uiLocale === 'de' }" @click="setUiLocale('de')" :title="t('toolbar.switchLanguage')">DE</button>
          <button class="lang-btn" :class="{ active: uiLocale === 'en' }" @click="setUiLocale('en')" :title="t('toolbar.switchLanguage')">EN</button>
        </div>

        <span v-if="errorCount > 0" class="status-badge error" @click="showProblemsPanel = true">
          {{ errorCount }} {{ errorCount !== 1 ? t('app.errors') : t('app.error') }}
        </span>
        <span v-if="warningCount > 0" class="status-badge warning" @click="showProblemsPanel = true">
          {{ warningCount }} {{ warningCount !== 1 ? t('app.warnings') : t('app.warning') }}
        </span>
        <span v-if="errorCount === 0 && warningCount === 0" class="status-badge success" @click="showProblemsPanel = true">
          {{ t('app.valid') }}
        </span>
      </div>
    </header>

    <!-- Toolbar -->
    <Toolbar 
      @zoom-in="handleZoomIn"
      @zoom-out="handleZoomOut"
      @reset-zoom="handleResetZoom"
      @re-layout="handleReLayout"
    />

    <!-- Main Content -->
    <main class="app-main" :class="mainLayoutClass">
      <!-- Left Panel: Global Settings -->
      <aside class="panel-left">
        <GlobalPanels />
      </aside>

      <!-- Center: Canvas -->
      <div class="canvas-container">
        <EditorCanvas ref="editorCanvasRef" />
      </div>

      <!-- Right Panel: Inspector -->
      <aside v-if="showInspector" class="panel-right">
        <Inspector />
      </aside>
    </main>

    <!-- Bottom Panel: Problems -->
    <transition name="slide-up">
      <div v-if="showProblemsPanel" class="panel-bottom">
        <ProblemsPanel />
      </div>
    </transition>

    <!-- Modals -->
    <TemplateModal
      v-if="showTemplateModal"
      @close="handleTemplateClose"
      @loaded="handleTemplateLoaded"
    />
    <ImportModal v-if="showImportModal" @close="editorStore.closeImportModal()" />
    <ExportModal v-if="showExportModal" @close="editorStore.closeExportModal()" />
  </div>
</template>

<style>
/* CSS Variables - GIRP corporate-identity design tokens */
:root {
  /* Warm-light surfaces */
  --color-bg-primary: #f2f2ef;      /* App/body background - warm grey */
  --color-bg-secondary: #ffffff;    /* White - cards/panels */
  --color-bg-tertiary: #f6f6f3;     /* Lightest warm grey - inputs/fills */
  --color-bg-canvas: #ecece7;       /* Canvas background - deeper warm grey */
  --color-grid: #c4c4bf;            /* Canvas grid dots */

  --color-header-bg: #1f1f21;       /* Ink - top bar and node title bars */
  --color-header-text: #fafaf7;     /* Paper text on ink */

  /* Warm neutrals - text */
  --color-text-primary: #3f3f3f;    /* Graphite - main text */
  --color-text-secondary: #585858;  /* Charcoal - secondary text */
  --color-text-muted: #9a9a97;      /* Warm grey - muted text */
  --color-night: #06121b;           /* On-sky/on-amber text for filled buttons */

  /* Primary accent - sky */
  --color-accent: #21adf3;
  --color-accent-hover: #1b93cf;
  --color-accent-rgb: 33, 173, 243;
  --color-accent-deep: #14688f;     /* Dark sky - info text on light tints */
  --primary-color: var(--color-accent);

  /* Status palette */
  --color-success: #2f9e8c;         /* Teal - success text/borders on light */
  --color-success-rgb: 47, 158, 140;
  --color-mint: #63c4af;            /* CI mint - fills and on-dark success */
  --color-mint-rgb: 99, 196, 175;
  --color-warning: #f0a020;         /* Amber */
  --color-warning-rgb: 240, 160, 32;
  --color-warning-hover: #d18a12;
  --color-amber-deep: #9a660d;      /* Amber text on light tints */
  --color-error: #e5391a;           /* Fire */
  --color-error-rgb: 229, 57, 26;
  --color-error-hover: #c53014;
  --color-error-soft: #f28b73;      /* Fire tint - error text on dark */
  --color-indigo: #53389f;
  --color-purple: #8a63c4;

  /* Borders and greys */
  --color-border: #e6e6e1;
  --color-input-border: #d9d9d3;
  --color-grey-300: #e0e0da;
  --color-grey-400: #c4c4bf;
  --color-grey-500: #9a9a97;

  /* Secondary (charcoal) buttons */
  --color-btn-secondary: #585858;
  --color-btn-secondary-hover: #3f3f3f;

  /* Typography */
  --font-body: 'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Space Grotesk Variable', 'Space Grotesk', var(--font-body);
  --font-mono: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;

  --shadow-sm: 0 1px 2px rgba(16, 16, 17, 0.04);
  --shadow-md: 0 2px 6px rgba(16, 16, 17, 0.08);
  --shadow-lg: 0 12px 32px -8px rgba(16, 16, 17, 0.18);

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;

  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;

  /* Node Styling Defaults */
  --node-header-gradient: linear-gradient(135deg, rgba(33, 173, 243, 0.28), rgba(33, 173, 243, 0.06));
  --node-selected-shadow: 0 0 0 2px rgba(33, 173, 243, 0.5);
}

/* Logo Styling — the header bar is always ink, so the light logo works in both modes */
.logo-img {
  height: 48px;
  width: auto;
}

.logo-wordmark {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #9a9a97;
  white-space: nowrap;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-body);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-display);
}

/* Since we bind to .app, we ensure .app uses the variables */

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  outline: none;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 1.5rem;
  background: var(--color-header-bg);
  color: var(--color-header-text);
  border-bottom: none;
  box-shadow: var(--shadow-md);
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.app-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lang-toggle {
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-right: 0.25rem;
}

.lang-btn {
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  background: transparent;
  border: none;
  border-radius: 0;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.lang-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.lang-btn.active {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform var(--transition-fast), opacity var(--transition-fast);
}

.status-badge:hover {
  transform: translateY(-1px);
  opacity: 0.9;
}

.status-badge.error {
  background: rgba(var(--color-error-rgb), 0.25);
  color: var(--color-error-soft);
}

.status-badge.warning {
  background: rgba(var(--color-warning-rgb), 0.2);
  color: var(--color-warning);
}

.status-badge.success {
  background: rgba(var(--color-mint-rgb), 0.2);
  color: var(--color-mint);
}

.app-main {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  overflow: hidden;
}

.app-main.show-inspector {
  grid-template-columns: 260px 1fr 360px;
}

.panel-left, .panel-right {
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
}

.panel-right {
  border-right: none;
  border-left: 1px solid var(--color-border);
}

.canvas-container {
  position: relative;
  overflow: hidden;
  background: var(--color-bg-canvas);
  background-image: radial-gradient(circle, var(--color-grid) 1.5px, transparent 1.5px);
  background-size: 20px 20px;
}

.panel-bottom {
  height: 200px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-border);
  overflow-y: auto;
}

.slide-up-enter-active, .slide-up-leave-active {
  transition: all var(--transition-normal);
}

.slide-up-enter-from, .slide-up-leave-to {
  height: 0;
  opacity: 0;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--color-bg-primary);
}

::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

input, textarea, select {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  background: #ffffff;
  border: 1px solid var(--color-input-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  transition: border-color var(--transition-fast);
}

input::placeholder, textarea::placeholder {
  color: var(--color-text-muted);
}

input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
}

button {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  background: var(--color-accent);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-night);
  cursor: pointer;
  transition: background var(--transition-fast), opacity var(--transition-fast);
}

button:hover {
  background: var(--color-accent-hover);
}

button:disabled {
  background: var(--color-grey-300);
  color: var(--color-grey-500);
  cursor: not-allowed;
}

button.secondary {
  background: var(--color-btn-secondary);
  color: #ffffff;
  border: 1px solid var(--color-btn-secondary);
}

button.secondary:hover {
  background: var(--color-btn-secondary-hover);
  border-color: var(--color-btn-secondary-hover);
}

button.danger {
  background: var(--color-error);
  color: #ffffff;
}

button.danger:hover {
  background: var(--color-error-hover);
}

label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

/* Improved contrast for small/help text */
.help-text, .muted-text, small {
  color: var(--color-text-muted) !important;
}

/* Icon buttons in toolbar - ensure visibility */
.btn-icon, [class*="btn-toggle"], .toolbar button:not(.btn-add) {
  background: #ffffff !important;
  border: 1px solid var(--color-border) !important;
  color: var(--color-text-primary) !important;
}

.btn-icon:hover, [class*="btn-toggle"]:hover {
  background: var(--color-bg-tertiary) !important;
  border-color: var(--color-accent) !important;
}

/* Sidebar tab icons - ensure dark icons on light background */
.tab, .sidebar-tab, .nav-tab {
  color: var(--color-text-primary) !important;
  background: var(--color-bg-tertiary) !important;
}

.tab:hover, .sidebar-tab:hover, .nav-tab:hover {
  background: var(--color-border) !important;
}

.tab.active, .sidebar-tab.active, .nav-tab.active, .toolbar .btn-toggle.active {
  background: var(--color-accent) !important;
  color: var(--color-night) !important;
  border-color: var(--color-accent) !important;
}

/* Node headers - ensure readable text */
.vue-flow__node-header, .node-header {
  color: var(--color-text-primary) !important;
  background: linear-gradient(135deg, rgba(var(--color-accent-rgb), 0.15), rgba(var(--color-accent-rgb), 0.25)) !important;
}

/* Status badges in header should have good contrast */
.status-badge {
  font-weight: 600;
}
</style>
