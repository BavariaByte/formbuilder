<script setup lang="ts">
import { ref, computed, markRaw, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useGraphStore, useEditorStore } from '@/store';
import type { GlobalPanelType } from '@/types/editor';
import type { LocalizedString } from '@/types/runtime';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();
import {
  FileText,
  Globe,
  Layout,
  PlayCircle,
  Database,
  Calculator,
  GitMerge,
  Search,
  X,
} from 'lucide-vue-next';

// Stores
const graphStore = useGraphStore();
const editorStore = useEditorStore();

const { activeGlobalPanel, currentLocale } = storeToRefs(editorStore);
const { meta, form, runtime, variables, calculation, flow, i18n, supportedLocales, nodes } = storeToRefs(graphStore);

const textzeileNodeEntries = computed(() => {
  void currentLocale.value; // reactive dependency for label re-resolution
  return Array.from(nodes.value.entries()).filter(([, n]) => n.type === 'question' && n.data?.type === 'textzeile');
});

// Clear identityQuestionId if the selected node no longer exists or is no longer a textzeile
watch(textzeileNodeEntries, (entries) => {
  const selectedId = graphStore.runtime.session?.identityQuestionId;
  if (selectedId && !entries.some(([id]) => id === selectedId)) {
    graphStore.runtime = {
      ...graphStore.runtime,
      session: { ...graphStore.runtime.session, identityQuestionId: undefined },
    };
  }
});

// ─── Node Search ──────────────────────────────────────────────────────────────

const searchQuery = ref('');

function resolveSearchLabel(value: LocalizedString | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[currentLocale.value] ?? Object.values(value)[0] ?? '';
}

interface SearchResult {
  id: string;
  typeBadge: string;
  typeClass: string;
  label: string;
}

const searchResults = computed((): SearchResult[] => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const [id, node] of nodes.value) {
    const idMatch   = id.toLowerCase().includes(q);
    const label     = resolveSearchLabel(node.data?.label);
    const labelMatch = label.toLowerCase().includes(q);

    if (!idMatch && !labelMatch) continue;

    results.push({
      id,
      typeBadge: node.type === 'start' ? 'S' : node.type === 'end' ? 'E' : 'Q',
      typeClass:  node.type === 'start' ? 'badge-start' : node.type === 'end' ? 'badge-end' : 'badge-question',
      label,
    });

    if (results.length >= 12) break;
  }

  return results;
});

function selectResult(nodeId: string) {
  editorStore.selectNode(nodeId);
  editorStore.requestFocusNode(nodeId);
  searchQuery.value = '';
}

// Panel tabs
const panels: { key: GlobalPanelType; label: string; icon: any }[] = [
  { key: 'meta', label: 'Meta', icon: markRaw(FileText) },
  { key: 'i18n', label: 'i18n', icon: markRaw(Globe) },
  { key: 'form', label: 'Form', icon: markRaw(Layout) },
  { key: 'runtime', label: 'Runtime', icon: markRaw(PlayCircle) },
  { key: 'variables', label: 'Variables', icon: markRaw(Database) },
  { key: 'calculation', label: 'Calc', icon: markRaw(Calculator) },
  { key: 'flow', label: 'Flow', icon: markRaw(GitMerge) },
];

// New variable input
const newVarId = ref('');
const newVarInitial = ref(0);

function addVariable() {
  if (newVarId.value.trim()) {
    graphStore.addVariable(newVarId.value.trim(), newVarInitial.value);
    newVarId.value = '';
    newVarInitial.value = 0;
  }
}

// New locale input
const newLocale = ref('');

function addLocale() {
  if (newLocale.value.trim()) {
    graphStore.addLocale(newLocale.value.trim());
    newLocale.value = '';
  }
}

function updateVariableValue(id: string, value: number) {
  graphStore.updateVariable(id, value);
}

// Form Localization Logic
const missingFormTranslations = computed(() => {
  const supportedLocales = graphStore.supportedLocales;
  const missing: string[] = [];
  const title = form.value.title;
  const description = form.value.description;
  
  for (const locale of supportedLocales) {
    let hasMissing = false;
    
    // Check Title
    if (typeof title === 'object' && title !== null) {
      const localeMap = title as Record<string, string>;
      if (!localeMap[locale]) {
        const otherHasContent = Object.entries(localeMap).some(([l, v]) => l !== locale && v && v.trim() !== '');
        if (otherHasContent) hasMissing = true;
      }
    }
    
    // Check Description
    if (!hasMissing && typeof description === 'object' && description !== null) {
      const localeMap = description as Record<string, string>;
      if (!localeMap[locale]) {
        const otherHasContent = Object.entries(localeMap).some(([l, v]) => l !== locale && v && v.trim() !== '');
        if (otherHasContent) hasMissing = true;
      }
    }
    
    if (hasMissing) missing.push(locale);
  }
  
  return missing;
});

const hasMissingFormTranslations = computed(() => missingFormTranslations.value.length > 0);

function updateFormTitle(value: string) {
  const currentTitle = form.value.title;
  const supportedLocales = graphStore.supportedLocales;
  let localeMap: Record<string, string> = {};
  
  // Initialize map
  for (const locale of supportedLocales) {
    if (typeof currentTitle === 'object' && currentTitle !== null) {
      localeMap[locale] = (currentTitle as Record<string, string>)[locale] || '';
    } else if (typeof currentTitle === 'string') {
      localeMap[locale] = locale === currentLocale.value ? value : currentTitle;
    } else {
      localeMap[locale] = '';
    }
  }
  
  localeMap[currentLocale.value] = value;
  form.value.title = localeMap;
}

function updateFormDescription(value: string) {
  const currentDesc = form.value.description;
  const supportedLocales = graphStore.supportedLocales;
  let localeMap: Record<string, string> = {};
  
  for (const locale of supportedLocales) {
    if (typeof currentDesc === 'object' && currentDesc !== null) {
      localeMap[locale] = (currentDesc as Record<string, string>)[locale] || '';
    } else if (typeof currentDesc === 'string') {
      localeMap[locale] = locale === currentLocale.value ? value : currentDesc;
    } else {
      localeMap[locale] = '';
    }
  }
  
  localeMap[currentLocale.value] = value;
  form.value.description = localeMap;
}

function fillMissingFormTranslations() {
  const defLocale = graphStore.defaultLocale;
  const targetLocales = missingFormTranslations.value;

  // Title
  const currentTitle = form.value.title;
  if (typeof currentTitle === 'object' && currentTitle !== null) {
    const localeMap = { ...(currentTitle as Record<string, string>) };
    const defValue = localeMap[defLocale];
    
    if (defValue && defValue.trim() !== '') {
      let changed = false;
      for (const target of targetLocales) {
        if (!localeMap[target] || localeMap[target].trim() === '') {
          localeMap[target] = defValue;
          changed = true;
        }
      }
      if (changed) form.value.title = localeMap;
    }
  }

  // Description
  const currentDesc = form.value.description;
  if (typeof currentDesc === 'object' && currentDesc !== null) {
    const localeMap = { ...(currentDesc as Record<string, string>) };
    const defValue = localeMap[defLocale];
    
    if (defValue && defValue.trim() !== '') {
      let changed = false;
      for (const target of targetLocales) {
        if (!localeMap[target] || localeMap[target].trim() === '') {
          localeMap[target] = defValue;
          changed = true;
        }
      }
      if (changed) form.value.description = localeMap;
    }
  }
}
</script>

<template>
  <div class="global-panels">

    <!-- Node Search -->
    <div class="node-search">
      <div class="search-input-wrap">
        <Search :size="13" class="search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('panels.search.placeholder')"
          class="search-input"
          @keydown.escape="searchQuery = ''"
        />
        <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
          <X :size="12" />
        </button>
      </div>

      <!-- Results -->
      <div v-if="searchQuery" class="search-results">
        <button
          v-for="result in searchResults"
          :key="result.id"
          class="search-result-item"
          @click="selectResult(result.id)"
        >
          <span class="result-badge" :class="result.typeClass">{{ result.typeBadge }}</span>
          <span class="result-info">
            <span class="result-id">{{ result.id }}</span>
            <span v-if="result.label" class="result-label">{{ result.label }}</span>
          </span>
        </button>
        <div v-if="searchResults.length === 0" class="search-empty">{{ t('panels.search.noResults') }}</div>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="tabs">
      <button
        v-for="panel in panels"
        :key="panel.key"
        class="tab"
        :class="{ active: activeGlobalPanel === panel.key }"
        @click="editorStore.setActiveGlobalPanel(panel.key)"
        :title="panel.label"
      >
        <component :is="panel.icon" :size="16" />
      </button>
    </div>

    <!-- Content Area -->


    <!-- Panel Content -->
    <div class="panel-content">
      <!-- Meta Panel -->
      <div v-if="activeGlobalPanel === 'meta'" class="panel">
        <h4>{{ t('panels.meta.title') }}</h4>
        
        <div class="field">
          <label>{{ t('panels.meta.playbookId') }}</label>
          <input
            type="text"
            :value="meta.id"
            @input="meta.id = ($event.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '')"
            pattern="[a-z0-9\-]*"
            :placeholder="t('panels.meta.idPlaceholder')"
          />
          <small class="hint">{{ t('panels.meta.idHint') }}</small>
        </div>
        
        <div class="field">
          <label>{{ t('panels.meta.version') }}</label>
          <input
            type="number"
            v-model="meta.version"
            placeholder="0"
            min="0"
          />
          <small class="hint">{{ t('panels.meta.versionHint') }}</small>
        </div>
      </div>

      <!-- i18n Panel -->
      <div v-if="activeGlobalPanel === 'i18n'" class="panel">
        <h4>{{ t('panels.i18n.title') }}</h4>
        
        <div class="field">
          <label>{{ t('panels.i18n.defaultLocale') }}</label>
          <select v-model="i18n.defaultLocale">
            <option v-for="locale in supportedLocales" :key="locale" :value="locale">
              {{ locale }}
            </option>
          </select>
        </div>
        
        <div class="field">
          <label>{{ t('panels.i18n.supportedLocales') }}</label>
          <div class="locale-list">
            <div v-for="locale in supportedLocales" :key="locale" class="locale-item">
              <span>{{ locale }}</span>
              <button 
                v-if="supportedLocales.length > 1 && locale !== i18n.defaultLocale"
                class="btn-remove"
                @click="graphStore.removeLocale(locale)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
        
        <div class="field">
          <label>{{ t('panels.i18n.addLocale') }}</label>
          <div class="input-row">
            <input
              type="text"
              v-model="newLocale"
              :placeholder="t('panels.i18n.localePlaceholder')"
            />
            <button @click="addLocale" :disabled="!newLocale.trim()">{{ t('panels.i18n.add') }}</button>
          </div>
        </div>
      </div>

      <!-- Form Panel -->
      <div v-if="activeGlobalPanel === 'form'" class="panel">
        <h4>{{ t('panels.form.title') }}</h4>
        
        <div v-if="hasMissingFormTranslations" class="translation-warning">
          <div class="warning-content">
            <span class="warning-icon">⚠️</span>
            <span>{{ t('panels.form.missingTranslation') }} {{ missingFormTranslations.join(', ') }}</span>
          </div>
          <button class="btn-copy-all-fields" @click="fillMissingFormTranslations">
            <Globe :size="14" /> {{ t('panels.form.fillMissing') }}
          </button>
        </div>

        <div class="field">
          <label>{{ t('panels.form.titleLabel') }}</label>
          <input
            type="text"
            :value="typeof form.title === 'string' ? form.title : (form.title && form.title[currentLocale]) || ''"
            @input="updateFormTitle(($event.target as HTMLInputElement).value)"
            :placeholder="t('panels.form.titlePlaceholder')"
          />
        </div>
        
        <div class="field">
          <label>{{ t('panels.form.descriptionLabel') }}</label>
          <textarea
            :value="typeof form.description === 'string' ? form.description : (form.description && form.description[currentLocale]) || ''"
            @input="updateFormDescription(($event.target as HTMLTextAreaElement).value)"
            :placeholder="t('panels.form.descriptionPlaceholder')"
            rows="3"
          />
        </div>
        
      </div>

      <!-- Runtime Panel -->
      <div v-if="activeGlobalPanel === 'runtime'" class="panel">
        <h4>{{ t('panels.runtime.title') }}</h4>
        

        
        <div class="subsection">
          <h5>{{ t('panels.runtime.session') }}</h5>
          <div class="field">
            <label>{{ t('panels.runtime.identityQuestion') }}</label>
            <select
              :value="runtime.session?.identityQuestionId || ''"
              @change="runtime.session = { ...runtime.session, identityQuestionId: ($event.target as HTMLSelectElement).value || undefined }"
            >
              <option value="">{{ t('panels.runtime.none') }}</option>
              <option v-for="[nodeId, node] in textzeileNodeEntries" :key="nodeId" :value="nodeId">
                {{ resolveSearchLabel(node.data?.label) || nodeId }}
              </option>
            </select>
            <span class="field-hint">{{ t('panels.runtime.identityHint') }}</span>
          </div>
          <div class="field">
            <label>{{ t('panels.runtime.maxResumeAge') }}</label>
            <input 
              type="number"
              :value="runtime.session?.resume?.maxAgeMinutes ?? 120"
              @input="runtime.session = { ...runtime.session, resume: { ...runtime.session?.resume, maxAgeMinutes: parseInt(($event.target as HTMLInputElement).value) || 120 } }"
              min="1"
            />
          </div>
        </div>
      </div>

      <!-- Variables Panel -->
      <div v-if="activeGlobalPanel === 'variables'" class="panel">
        <h4>{{ t('panels.variables.title') }}</h4>
        
        <div class="variable-list">
          <div v-for="v in variables" :key="v.id" class="variable-card">
            <div class="var-header">
              <code class="var-id">{{ v.id }}</code>
            </div>
            <div class="var-value">
              <label>{{ t('panels.variables.initialValue') }}</label>
              <input 
                type="number" 
                class="var-input"
                :value="v.initial"
                @input="updateVariableValue(v.id, parseInt(($event.target as HTMLInputElement).value) || 0)"
              />
            </div>
            <button class="btn-remove-var" @click="graphStore.removeVariable(v.id)" :title="t('panels.variables.remove')">×</button>
          </div>
          <div v-if="variables.length === 0" class="empty-vars">
            {{ t('panels.variables.empty') }}
          </div>
        </div>
        
        <div class="field">
          <label>{{ t('panels.variables.add') }}</label>
          <div class="input-row">
            <input
              type="text"
              v-model="newVarId"
              :placeholder="t('panels.variables.idPlaceholder')"
              style="flex: 2"
            />
            <input
              type="number"
              v-model="newVarInitial"
              :placeholder="t('panels.variables.initialPlaceholder')"
              style="flex: 1"
            />
            <button @click="addVariable" :disabled="!newVarId.trim()" style="padding: 0 0.6rem; flex-shrink: 0;">+</button>
          </div>
        </div>

      </div>

      <!-- Calculation Panel -->
      <div v-if="activeGlobalPanel === 'calculation'" class="panel">
        <h4>{{ t('panels.calculation.title') }}</h4>
        
        <div class="field">
          <label>{{ t('panels.calculation.checkboxOrder') }}</label>
          <select v-model="calculation.checkboxOptionOrder">
            <option value="definition">{{ t('panels.calculation.definitionOrder') }}</option>
            <option value="alphabetical">{{ t('panels.calculation.alphabetical') }}</option>
          </select>
        </div>

        <div class="field">
          <label>{{ t('panels.calculation.rounding') }}</label>
          <input type="number" v-model.number="calculation.rounding" min="0" max="10" />
        </div>

        <div class="settings-section-label">{{ t('panels.calculation.orderSection') }}</div>

        <div class="field">
          <label>{{ t('panels.calculation.effectOrder') }}</label>
          <select v-model="calculation.effectOrder">
            <option value="action-option">Action → Option → On Answer</option>
            <option value="option-action">Option → Action → On Answer</option>
          </select>
          <span class="field-hint">{{ t('panels.calculation.effectOrderHint') }}</span>
        </div>
      </div>

      <!-- Flow Panel -->
      <div v-if="activeGlobalPanel === 'flow'" class="panel">
        <h4>{{ t('panels.flow.title') }}</h4>

        <div class="field">
          <label>{{ t('panels.flow.startQuestion') }}</label>
          <code class="readonly">{{ flow.start || t('panels.flow.startQuestionHint') }}</code>
        </div>

        <div class="field">
          <label>{{ t('panels.flow.endMarker') }}</label>
          <code class="readonly">submit</code>
        </div>

        <div class="settings-section-label">{{ t('panels.flow.routingSection') }}</div>

        <div class="field">
          <label>{{ t('panels.flow.routingPriority') }}</label>
          <select v-model="flow.routingPriority">
            <option value="options-first">Options Routing → Actions → Default</option>
            <option value="actions-first">Actions → Options Routing → Default</option>
          </select>
          <span class="field-hint">{{ t('panels.flow.routingHint') }}</span>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.global-panels {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  padding: 0.4rem 0.5rem;
  gap: 0.25rem;
  border-bottom: 1px solid var(--color-border);
}

.tab {
  width: 31px;
  height: 31px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 1rem;
}

.tab:hover {
  background: var(--color-bg-tertiary);
}

.tab.active {
  background: rgba(var(--color-accent-rgb), 0.18);
}

.tab-icon {
  line-height: 1;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.panel h4 {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--color-text-primary);
}

.subsection {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.subsection:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}

.subsection h5 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.settings-section-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin: 0.75rem 0 0.4rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--color-border);
}


.field-hint {
  display: block;
  font-size: 0.65rem;
  color: var(--color-text-muted);
  margin-top: 0.2rem;
  line-height: 1.3;
}

.field {
  margin-bottom: 0.75rem;
}

.field input,
.field textarea,
.field select {
  width: 100%;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.checkbox-field input[type="checkbox"] {
  width: auto;
}

.checkbox-field span {
  font-size: 0.875rem;
}

.input-row {
  display: flex;
  gap: 0.5rem;
}

.input-row input {
  flex: 1;
}

.input-row button {
  flex-shrink: 0;
}

.locale-list,
.variable-list {
  margin-bottom: 0.75rem;
}

.locale-item,
.variable-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  margin-bottom: 0.25rem;
}

.locale-item span,
.var-id {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.var-initial {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.btn-remove {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 1.25rem;
  line-height: 1;
}

.btn-remove:hover {
  background: rgba(var(--color-error-rgb), 0.12);
  color: var(--color-error);
}

/* Variable Cards */
.variable-card {
  position: relative;
  padding: 0.75rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  margin-bottom: 0.5rem;
}

.variable-card:hover {
  border-color: var(--color-accent);
}

.var-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.var-icon {
  font-size: 0.875rem;
}

.variable-card .var-id {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--color-accent);
  background: var(--color-bg-tertiary);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
}

.var-value {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.var-value label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.var-input {
  flex: 1;
  text-align: center;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  max-width: 80px;
}

.var-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.btn-remove-var {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 1rem;
  line-height: 1;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.variable-card:hover .btn-remove-var {
  opacity: 1;
}

.btn-remove-var:hover {
  color: var(--color-error);
}

.empty-vars {
  text-align: center;
  padding: 1rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.readonly {
  display: block;
  padding: 0.5rem 0.75rem;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.8rem;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-style: italic;
}

.translation-warning {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: linear-gradient(135deg, var(--color-warning), var(--color-warning-hover));
  color: var(--color-night);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.warning-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-copy-all-fields {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 1rem;
  background: rgba(6, 18, 27, 0.12);
  color: var(--color-night);
  border: 1px solid rgba(6, 18, 27, 0.25);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-copy-all-fields:hover {
  background: rgba(6, 18, 27, 0.22);
}

/* ── Node Search ──────────────────────────────────────────────────────────── */
.node-search {
  padding: 0.5rem 0.625rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.5rem;
  color: var(--color-text-muted);
  pointer-events: none;
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  padding: 0.4rem 1.6rem 0.4rem 1.75rem;
  font-size: 0.75rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  transition: border-color var(--transition-fast);
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
}

.search-clear {
  position: absolute;
  right: 0.35rem;
  width: 18px;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.search-clear:hover {
  background: var(--color-error);
  border-color: var(--color-error);
  color: #fff;
}

/* Results list */
.search-results {
  margin-top: 0.35rem;
  margin-bottom: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 240px;
  overflow-y: auto;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
  color: var(--color-text-primary);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.search-result-item:hover {
  background: rgba(var(--color-accent-rgb), 0.07);
  border-color: rgba(var(--color-accent-rgb), 0.25);
}

.result-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0;
}

.badge-question {
  background: rgba(var(--color-accent-rgb), 0.15);
  color: var(--color-accent-deep);
}

.badge-start {
  background: rgba(var(--color-success-rgb), 0.15);
  color: var(--color-success);
}

.badge-end {
  background: rgba(var(--color-error-rgb), 0.12);
  color: var(--color-error);
}

.result-info {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.result-id {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-label {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-empty {
  padding: 0.5rem 0.25rem;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  text-align: center;
  margin-bottom: 0.5rem;
}
</style>
