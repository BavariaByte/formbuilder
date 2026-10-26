// Validation Store - Manages validation results and error tracking
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ValidationIssue, ValidationResult } from '@/types/editor';

export const useValidationStore = defineStore('validation', () => {
    // =========================================================================
    // State
    // =========================================================================

    const issues = ref<ValidationIssue[]>([]);
    const isValidating = ref(false);
    const lastValidationTime = ref<number>(0);

    // =========================================================================
    // Computed
    // =========================================================================

    const errors = computed(() =>
        issues.value.filter(i => i.severity === 'error')
    );

    const warnings = computed(() =>
        issues.value.filter(i => i.severity === 'warning')
    );

    const errorCount = computed(() => errors.value.length);
    const warningCount = computed(() => warnings.value.length);

    const isValid = computed(() => errorCount.value === 0);
    const canExport = computed(() => errorCount.value === 0);

    const issuesByNode = computed(() => {
        const map = new Map<string, ValidationIssue[]>();
        issues.value.forEach(issue => {
            if (issue.nodeId) {
                const existing = map.get(issue.nodeId) || [];
                existing.push(issue);
                map.set(issue.nodeId, existing);
            }
        });
        return map;
    });

    const issuesByPanel = computed(() => {
        const map = new Map<string, ValidationIssue[]>();
        issues.value.forEach(issue => {
            if (issue.panel) {
                const existing = map.get(issue.panel) || [];
                existing.push(issue);
                map.set(issue.panel, existing);
            }
        });
        return map;
    });

    const syntaxErrors = computed(() =>
        issues.value.filter(i => i.category === 'syntax' && i.severity === 'error')
    );

    const semanticErrors = computed(() =>
        issues.value.filter(i => i.category === 'semantic' && i.severity === 'error')
    );

    const graphErrors = computed(() =>
        issues.value.filter(i => i.category === 'graph' && i.severity === 'error')
    );

    // =========================================================================
    // Actions
    // =========================================================================

    function setIssues(newIssues: ValidationIssue[]): void {
        issues.value = newIssues;
        lastValidationTime.value = Date.now();
    }

    function addIssue(issue: ValidationIssue): void {
        issues.value.push(issue);
    }

    function removeIssue(issueId: string): void {
        issues.value = issues.value.filter(i => i.id !== issueId);
    }

    function clearIssues(): void {
        issues.value = [];
    }

    function getIssuesForNode(nodeId: string): ValidationIssue[] {
        return issues.value.filter(i => i.nodeId === nodeId);
    }

    function getErrorCountForNode(nodeId: string): number {
        return issues.value.filter(
            i => i.nodeId === nodeId && i.severity === 'error'
        ).length;
    }

    function getWarningCountForNode(nodeId: string): number {
        return issues.value.filter(
            i => i.nodeId === nodeId && i.severity === 'warning'
        ).length;
    }

    function setValidating(value: boolean): void {
        isValidating.value = value;
    }

    function getValidationResult(): ValidationResult {
        return {
            errors: errors.value,
            warnings: warnings.value,
            isValid: isValid.value,
            canExport: canExport.value,
        };
    }

    // =========================================================================
    // Return
    // =========================================================================

    return {
        // State
        issues,
        isValidating,
        lastValidationTime,

        // Computed
        errors,
        warnings,
        errorCount,
        warningCount,
        isValid,
        canExport,
        issuesByNode,
        issuesByPanel,
        syntaxErrors,
        semanticErrors,
        graphErrors,

        // Actions
        setIssues,
        addIssue,
        removeIssue,
        clearIssues,
        getIssuesForNode,
        getErrorCountForNode,
        getWarningCountForNode,
        setValidating,
        getValidationResult,
    };
});
