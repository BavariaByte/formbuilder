<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useValidationStore, useEditorStore, useGraphStore } from '@/store';
import type { ValidationIssue } from '@/types/editor';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();

// Stores
const validationStore = useValidationStore();
const editorStore = useEditorStore();
const graphStore = useGraphStore();

const { issues, errorCount, warningCount } = storeToRefs(validationStore);

// Group issues by category
const groupedIssues = computed(() => {
  const groups: { graph: ValidationIssue[]; semantic: ValidationIssue[]; syntax: ValidationIssue[] } = {
    graph: [],
    semantic: [],
    syntax: [],
  };

  for (const issue of issues.value) {
    if (issue.category === 'graph') {
      groups.graph.push(issue);
    } else if (issue.category === 'semantic') {
      groups.semantic.push(issue);
    } else if (issue.category === 'syntax') {
      groups.syntax.push(issue);
    }
  }

  return groups;
});

// Get the display title for a node (truncated to 50 chars)
function getNodeTitle(nodeId: string): string {
  if (nodeId === '__start__') return t('problems.startNode');
  if (nodeId === '__end__') return t('problems.submitNode');
  const node = graphStore.getNode(nodeId);
  if (!node?.data?.label) return t('problems.noLabel');
  const label = node.data.label;
  const raw = typeof label === 'string'
    ? label
    : (Object.values(label as Record<string, string>).find(v => v?.trim()) ?? '');
  if (!raw) return t('problems.noLabel');
  return raw.length > 50 ? raw.slice(0, 50) + '…' : raw;
}

// Get the short ID string for a node (first 15 chars)
function getNodeShortId(nodeId: string): string {
  if (nodeId === '__start__' || nodeId === '__end__') return nodeId;
  return nodeId.slice(0, 15) + '…';
}

// Map a field path to its inspector section key
function fieldToSection(field?: string): string | null {
  if (!field) return null;
  if (field === 'label' || field === 'placeholder' || field === 'description') return 'basic';
  if (field.startsWith('options')) return 'options';
  if (field.startsWith('validation')) return 'validation';
  if (field.startsWith('actions')) return 'actions';
  if (field.startsWith('effects')) return 'effects';
  return null;
}

// Navigate to issue: focus canvas + select node + scroll inspector to the relevant section
function goToIssue(issue: ValidationIssue) {
  if (issue.nodeId) {
    editorStore.requestFocusNode(issue.nodeId);
    const section = fieldToSection(issue.field);
    if (section) {
      editorStore.requestInspectorSection(section);
    }
  } else if (issue.panel) {
    editorStore.setActiveGlobalPanel(issue.panel as any);
  }
}
</script>

<template>
  <div class="problems-panel">
    <div class="problems-header">
      <h3>{{ t('problems.title') }}</h3>
      <div class="problem-counts">
        <span v-if="errorCount > 0" class="count error">{{ errorCount }} {{ t('problems.errors') }}</span>
        <span v-if="warningCount > 0" class="count warning">{{ warningCount }} {{ t('problems.warnings') }}</span>
        <span v-if="errorCount === 0 && warningCount === 0" class="count success">{{ t('problems.noProblems') }}</span>
      </div>
    </div>

    <div class="problems-content">
      <div v-if="issues.length === 0" class="empty-state">
        <span class="check-icon">✓</span>
        <p>{{ t('problems.noIssues') }}</p>
      </div>

      <div v-else>
        <!-- Graph Issues -->
        <div v-if="groupedIssues.graph.length > 0" class="issue-group">
          <h4>{{ t('problems.graphStructure') }}</h4>
          <div
            v-for="issue in groupedIssues.graph"
            :key="issue.id"
            class="issue-item"
            :class="issue.severity"
            @click="goToIssue(issue)"
          >
            <span class="issue-icon">{{ issue.severity === 'error' ? '❌' : '⚠️' }}</span>
            <div class="issue-body">
              <span class="issue-message">{{ issue.messageKey ? t(issue.messageKey as any, issue.messageParams) : issue.message }}</span>
              <div v-if="issue.nodeId" class="issue-node">
                <span class="issue-node-title">{{ getNodeTitle(issue.nodeId) }}</span>
                <span class="issue-node-id">{{ getNodeShortId(issue.nodeId) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Semantic Issues -->
        <div v-if="groupedIssues.semantic.length > 0" class="issue-group">
          <h4>{{ t('problems.references') }}</h4>
          <div
            v-for="issue in groupedIssues.semantic"
            :key="issue.id"
            class="issue-item"
            :class="issue.severity"
            @click="goToIssue(issue)"
          >
            <span class="issue-icon">{{ issue.severity === 'error' ? '❌' : '⚠️' }}</span>
            <div class="issue-body">
              <span class="issue-message">{{ issue.messageKey ? t(issue.messageKey as any, issue.messageParams) : issue.message }}</span>
              <div v-if="issue.nodeId" class="issue-node">
                <span class="issue-node-title">{{ getNodeTitle(issue.nodeId) }}</span>
                <span class="issue-node-id">{{ getNodeShortId(issue.nodeId) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Syntax Issues -->
        <div v-if="groupedIssues.syntax.length > 0" class="issue-group">
          <h4>{{ t('problems.syntax') }}</h4>
          <div
            v-for="issue in groupedIssues.syntax"
            :key="issue.id"
            class="issue-item"
            :class="issue.severity"
            @click="goToIssue(issue)"
          >
            <span class="issue-icon">{{ issue.severity === 'error' ? '❌' : '⚠️' }}</span>
            <div class="issue-body">
              <span class="issue-message">{{ issue.messageKey ? t(issue.messageKey as any, issue.messageParams) : issue.message }}</span>
              <div v-if="issue.nodeId" class="issue-node">
                <span class="issue-node-title">{{ getNodeTitle(issue.nodeId) }}</span>
                <span class="issue-node-id">{{ getNodeShortId(issue.nodeId) }}</span>
              </div>
              <span v-if="issue.field" class="issue-field">{{ issue.field }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.problems-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.problems-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.problems-header h3 {
  font-size: 0.875rem;
  font-weight: 600;
}

.problem-counts {
  display: flex;
  gap: 0.5rem;
}

.count {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
}

.count.error {
  background: rgba(var(--color-error-rgb), 0.12);
  color: var(--color-error);
}

.count.warning {
  background: rgba(var(--color-warning-rgb), 0.15);
  color: var(--color-amber-deep);
}

.count.success {
  background: rgba(var(--color-mint-rgb), 0.18);
  color: var(--color-success);
}

.problems-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.5rem;
  color: var(--color-text-muted);
}

.check-icon {
  font-size: 2rem;
  color: var(--color-success);
}

.issue-group {
  margin-bottom: 1rem;
}

.issue-group h4 {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
  padding: 0.25rem 0.5rem;
}

.issue-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.issue-item:hover {
  background: var(--color-bg-tertiary);
}

.issue-item.error {
  border-left: 2px solid var(--color-error);
}

.issue-item.warning {
  border-left: 2px solid var(--color-warning);
}

.issue-icon {
  font-size: 0.875rem;
  flex-shrink: 0;
  margin-top: 0.05rem;
}

.issue-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.issue-message {
  font-size: 0.75rem;
  color: var(--color-text-primary);
  line-height: 1.4;
}

.issue-node {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin-top: 0.2rem;
}

.issue-node-title {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.issue-node-id {
  font-size: 0.6rem;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.issue-field {
  font-size: 0.625rem;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  padding: 0.1rem 0.375rem;
  border-radius: var(--radius-sm);
  margin-top: 0.15rem;
  align-self: flex-start;
}
</style>
