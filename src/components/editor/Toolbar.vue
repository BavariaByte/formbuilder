<script setup lang="ts">
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useGraphStore, useEditorStore, useValidationStore } from '@/store';
import type { QuestionType } from '@/types/runtime';
import {
  Plus,
  Type,
  AlignLeft,
  List,
  CheckSquare,
  Hash,
  Calendar,
  Info,
  FilePlus,
  Upload,
  Download,
  Globe,
  LayoutTemplate,
  Minus,
  MoveHorizontal,
  Map,
  Settings,
  AlertTriangle
} from 'lucide-vue-next';
import { useAppI18n } from '@/composables/useAppI18n';

// Stores
const graphStore = useGraphStore();
const editorStore = useEditorStore();
const validationStore = useValidationStore();

const { canExport } = storeToRefs(validationStore);
const { showMinimap, showInspector, showProblemsPanel, currentLocale } = storeToRefs(editorStore);
const { nodeCount, supportedLocales } = storeToRefs(graphStore);

const { t } = useAppI18n();

// Get editor canvas ref from parent
const emit = defineEmits<{
  zoomIn: [];
  zoomOut: [];
  resetZoom: [];
  reLayout: [];
}>();

// Question types for add menu
const questionTypes = computed(() => [
  { type: 'textzeile' as const, label: t('qtype.textzeile'), icon: Type },
  { type: 'textbox' as const, label: t('qtype.textbox'), icon: AlignLeft },
  { type: 'select' as const, label: t('qtype.select'), icon: List },
  { type: 'checkbox' as const, label: t('qtype.checkbox'), icon: CheckSquare },
  { type: 'int' as const, label: t('qtype.int'), icon: Hash },
  { type: 'date' as const, label: t('qtype.date'), icon: Calendar },
  { type: 'info' as const, label: t('qtype.info'), icon: Info },
]);

// Add node menu
const showAddMenu = ref(false);

function addQuestion(type: QuestionType) {
  const node = graphStore.createQuestionNode(type);
  graphStore.addNode(node);
  editorStore.selectNode(node.id);
  showAddMenu.value = false;
}

// Zoom display - read from store (synced with actual canvas zoom)
const zoomLevel = computed(() => Math.round(editorStore.zoom * 100));

function handleZoomIn() {
  emit('zoomIn');
}

function handleZoomOut() {
  emit('zoomOut');
}

function handleResetZoom() {
  emit('resetZoom');
}

function handleReLayout() {
  emit('reLayout');
}

function handleNewProject() {
  editorStore.openTemplateModal();
}

</script>

<template>
  <div class="toolbar">
    <!-- Left: Add Node -->
    <div class="toolbar-section">
      <div class="dropdown">
        <button class="btn-add" @click="showAddMenu = !showAddMenu">
          <span class="icon"><Plus :size="18" /></span>
          {{ t('toolbar.addQuestion') }}
        </button>
        <div v-if="showAddMenu" class="dropdown-menu" @mouseleave="showAddMenu = false">
          <button
            v-for="qType in questionTypes"
            :key="qType.type"
            class="dropdown-item"
            @click="addQuestion(qType.type)"
          >
            <span class="item-icon">
              <component :is="qType.icon" :size="16" />
            </span>
            <span class="item-label">{{ qType.label }}</span>
          </button>
        </div>
      </div>

      <span class="node-count">
        <LayoutTemplate :size="14" style="margin-right: 4px; display: inline-block; vertical-align: middle;" />
        {{ nodeCount }} {{ t('toolbar.nodes') }}
      </span>
    </div>

    <!-- Center: Zoom & Layout Controls -->
    <div class="toolbar-section toolbar-center">
      <button class="btn-icon" @click="handleZoomOut" :title="t('toolbar.zoomOut')">
        <Minus :size="16" />
      </button>
      <span class="zoom-level" @click="handleResetZoom">
        {{ zoomLevel }}%
      </span>
      <button class="btn-icon" @click="handleZoomIn" :title="t('toolbar.zoomIn')">
        <Plus :size="16" />
      </button>
      <div class="separator small"></div>
      <button class="btn-icon" @click="handleReLayout" :title="t('toolbar.reLayout')">
        <MoveHorizontal :size="16" />
      </button>
    </div>

    <!-- Right: Import/Export & Toggles -->
    <div class="toolbar-section">
      <button
        class="btn-toggle"
        :class="{ active: showMinimap }"
        @click="editorStore.toggleMinimap()"
        :title="t('toolbar.toggleMinimap')"
      >
        <Map :size="18" />
      </button>
      <button
        class="btn-toggle"
        :class="{ active: showInspector }"
        @click="editorStore.toggleInspector()"
        :title="t('toolbar.toggleInspector')"
      >
        <Settings :size="18" />
      </button>
      <button
        class="btn-toggle"
        :class="{ active: showProblemsPanel }"
        @click="editorStore.toggleProblemsPanel()"
        :title="t('toolbar.toggleProblems')"
      >
        <AlertTriangle :size="18" />
      </button>

      <div class="separator"></div>

      <!-- Locale Selector -->
      <div class="locale-selector-wrapper" style="position: relative; display: flex; align-items: center;">
         <Globe :size="16" style="position: absolute; left: 8px; z-index: 1; pointer-events: none; color: var(--color-text-muted);" />
         <select
          class="locale-select"
          :value="currentLocale"
          @change="editorStore.setCurrentLocale(($event.target as HTMLSelectElement).value)"
          :title="t('toolbar.displayLocale')"
          style="padding-left: 30px;"
        >
          <option v-for="locale in supportedLocales" :key="locale" :value="locale">
            {{ locale }}
          </option>
        </select>
      </div>

      <div class="separator"></div>

      <button class="btn-secondary" @click="handleNewProject" :title="t('toolbar.newProject')">
        <span class="icon"><FilePlus :size="16" /></span>
        {{ t('toolbar.new') }}
      </button>

      <button class="btn-secondary" @click="editorStore.openImportModal()">
        <span class="icon"><Upload :size="16" /></span>
        {{ t('toolbar.import') }}
      </button>

      <button
        class="btn-primary"
        @click="editorStore.openExportModal()"
        :disabled="!canExport"
        :title="!canExport ? t('toolbar.fixErrorsToExport') : t('toolbar.exportJson')"
      >
        <span class="icon"><Download :size="16" /></span>
        {{ t('toolbar.export') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  gap: 1rem;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toolbar-center {
  flex-shrink: 0;
}

.btn-add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--color-accent);
  color: var(--color-night);
  font-weight: 500;
}

.btn-add:hover {
  background: var(--color-accent-hover);
}

.btn-add .icon {
  font-size: 1.25rem;
  line-height: 1;
}

.node-count {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-left: 0.5rem;
}

/* Dropdown */
.dropdown {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 0.25rem;
  min-width: 180px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  padding: 0.25rem;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: transparent;
  text-align: left;
}

.dropdown-item:hover {
  background: var(--color-bg-tertiary);
}

.item-icon {
  font-size: 1rem;
}

.item-label {
  flex: 1;
}

/* Zoom Controls */
.btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: bold;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
}

.btn-icon:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-accent);
}

.zoom-level {
  min-width: 50px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.zoom-level:hover {
  color: var(--color-text-primary);
}

/* Toggles */
.btn-toggle {
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
}

.btn-toggle:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-accent);
}

.btn-toggle.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-night);
}

.separator {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 0.5rem;
}

.separator.small {
  margin: 0 0.25rem;
}

.locale-select {
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  cursor: pointer;
}

.locale-select:hover {
  border-color: var(--color-accent);
}

.btn-primary, .btn-secondary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-night);
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  background: var(--color-grey-300);
  color: var(--color-grey-500);
  cursor: not-allowed;
  opacity: 0.7;
  border: 1px solid var(--color-grey-300);
}

.btn-secondary {
  background: var(--color-btn-secondary);
  color: #ffffff;
  border: 1px solid var(--color-btn-secondary);
}

.btn-secondary:hover {
  background: var(--color-btn-secondary-hover);
  border-color: var(--color-btn-secondary-hover);
}

.icon {
  display: flex;
  align-items: center;
}

</style>
