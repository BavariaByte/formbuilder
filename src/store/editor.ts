// Editor Store - Manages UI state (selection, zoom, pan, locale)
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Position, GlobalPanelType } from '@/types/editor';
import type { QuestionType } from '@/types/runtime';

export const useEditorStore = defineStore('editor', () => {
    // =========================================================================
    // State
    // =========================================================================

    // Selection
    const selectedNodeIds = ref<Set<string>>(new Set());
    const selectedEdgeIds = ref<Set<string>>(new Set());

    // Viewport
    const zoom = ref(1);
    const pan = ref<Position>({ x: 0, y: 0 });

    // Locale
    const currentLocale = ref('de-DE');

    // UI Language (Formbuilder interface language: 'de' | 'en')
    const uiLocale = ref<'de' | 'en'>('de');

    // Search/Filter
    const searchQuery = ref('');
    const filterType = ref<QuestionType | 'all'>('all');

    // UI Panels
    const activeGlobalPanel = ref<GlobalPanelType>('meta');
    const showProblemsPanel = ref(false);
    const showMinimap = ref(true);
    const showInspector = ref(true);

    // Inspector
    const inspectorExpandedSections = ref<Set<string>>(new Set(['basic', 'validation']));

    // Focus request – set to a node ID to pan the canvas to that node
    const focusNodeRequest = ref<string | null>(null);

    // Inspector section scroll request – set to a section key to scroll the inspector to that section
    const inspectorScrollToSection = ref<string | null>(null);

    // Modals
    const showImportModal = ref(false);
    const showExportModal = ref(false);
    const showTemplateModal = ref(false);
    const showVariableDeleteConfirm = ref(false);
    const variableToDelete = ref<string | null>(null);

    // Rete editor reference (set by EditorCanvas, used by Inspector and others)
    const reteEditor = ref<any>(null);

    // Pending positions for import — set by ImportModal, consumed by EditorCanvas
    const pendingPositions = ref<Record<string, { x: number; y: number }> | null>(null);

    // Clipboard
    const clipboard = ref<any[]>([]);

    // =========================================================================
    // Computed
    // =========================================================================

    const hasSelection = computed(() =>
        selectedNodeIds.value.size > 0 || selectedEdgeIds.value.size > 0
    );

    const selectedNodeCount = computed(() => selectedNodeIds.value.size);

    const singleNodeSelected = computed(() =>
        selectedNodeIds.value.size === 1 && selectedEdgeIds.value.size === 0
    );

    const selectedNodeId = computed(() => {
        if (selectedNodeIds.value.size === 1) {
            return Array.from(selectedNodeIds.value)[0];
        }
        return null;
    });

    // =========================================================================
    // Actions - Selection
    // =========================================================================

    function selectNode(nodeId: string, addToSelection = false): void {
        if (!addToSelection) {
            selectedNodeIds.value.clear();
            selectedEdgeIds.value.clear();
        }
        selectedNodeIds.value.add(nodeId);
    }

    function deselectNode(nodeId: string): void {
        selectedNodeIds.value.delete(nodeId);
    }

    function selectEdge(edgeId: string, addToSelection = false): void {
        if (!addToSelection) {
            selectedNodeIds.value.clear();
            selectedEdgeIds.value.clear();
        }
        selectedEdgeIds.value.add(edgeId);
    }

    function deselectEdge(edgeId: string): void {
        selectedEdgeIds.value.delete(edgeId);
    }

    function clearSelection(): void {
        selectedNodeIds.value.clear();
        selectedEdgeIds.value.clear();
    }

    function selectMultipleNodes(nodeIds: string[]): void {
        selectedNodeIds.value.clear();
        selectedEdgeIds.value.clear();
        nodeIds.forEach(id => selectedNodeIds.value.add(id));
    }

    // =========================================================================
    // Actions - Viewport
    // =========================================================================

    function setZoom(newZoom: number): void {
        zoom.value = Math.max(0.1, Math.min(2, newZoom));
    }

    function zoomIn(): void {
        setZoom(zoom.value + 0.1);
    }

    function zoomOut(): void {
        setZoom(zoom.value - 0.1);
    }

    function resetZoom(): void {
        zoom.value = 1;
        pan.value = { x: 0, y: 0 };
    }

    function setPan(newPan: Position): void {
        pan.value = newPan;
    }

    // =========================================================================
    // Actions - Locale
    // =========================================================================

    function setCurrentLocale(locale: string): void {
        currentLocale.value = locale;
    }

    function setUiLocale(locale: 'de' | 'en'): void {
        uiLocale.value = locale;
    }

    // =========================================================================
    // Actions - Search/Filter
    // =========================================================================

    function setSearchQuery(query: string): void {
        searchQuery.value = query;
    }

    function setFilterType(type: QuestionType | 'all'): void {
        filterType.value = type;
    }

    function clearSearch(): void {
        searchQuery.value = '';
        filterType.value = 'all';
    }

    // =========================================================================
    // Actions - Panels
    // =========================================================================

    function setActiveGlobalPanel(panel: GlobalPanelType): void {
        activeGlobalPanel.value = panel;
    }

    function toggleProblemsPanel(): void {
        showProblemsPanel.value = !showProblemsPanel.value;
    }

    function toggleMinimap(): void {
        showMinimap.value = !showMinimap.value;
    }

    function toggleInspector(): void {
        showInspector.value = !showInspector.value;
    }

    // =========================================================================
    // Actions - Inspector
    // =========================================================================

    function toggleInspectorSection(section: string): void {
        if (inspectorExpandedSections.value.has(section)) {
            inspectorExpandedSections.value.delete(section);
        } else {
            inspectorExpandedSections.value.add(section);
        }
    }

    function isInspectorSectionExpanded(section: string): boolean {
        return inspectorExpandedSections.value.has(section);
    }

    // =========================================================================
    // Actions - Modals
    // =========================================================================

    function openImportModal(): void {
        showImportModal.value = true;
    }

    function closeImportModal(): void {
        showImportModal.value = false;
    }

    function openExportModal(): void {
        showExportModal.value = true;
    }

    function closeExportModal(): void {
        showExportModal.value = false;
    }

    function openTemplateModal(): void {
        showTemplateModal.value = true;
    }

    function closeTemplateModal(): void {
        showTemplateModal.value = false;
    }

    function requestFocusNode(nodeId: string | null): void {
        focusNodeRequest.value = nodeId;
    }

    function requestInspectorSection(section: string | null): void {
        inspectorScrollToSection.value = section;
    }

    function confirmDeleteVariable(varId: string): void {
        variableToDelete.value = varId;
        showVariableDeleteConfirm.value = true;
    }

    function cancelDeleteVariable(): void {
        variableToDelete.value = null;
        showVariableDeleteConfirm.value = false;
    }

    // =========================================================================
    // Actions - Clipboard
    // =========================================================================

    function setReteEditor(editor: any): void {
        reteEditor.value = editor;
    }

    function setPendingPositions(positions: Record<string, { x: number; y: number }>): void {
        pendingPositions.value = positions;
    }

    function clearPendingPositions(): void {
        pendingPositions.value = null;
    }

    function setClipboard(items: any[]): void {
        clipboard.value = items;
    }

    function clearClipboard(): void {
        clipboard.value = [];
    }

    // =========================================================================
    // Return
    // =========================================================================

    return {
        // State
        selectedNodeIds,
        selectedEdgeIds,
        focusNodeRequest,
        inspectorScrollToSection,
        zoom,
        pan,
        currentLocale,
        uiLocale,
        searchQuery,
        filterType,
        activeGlobalPanel,
        showProblemsPanel,
        showMinimap,
        showInspector,
        inspectorExpandedSections,
        showImportModal,
        showExportModal,
        showTemplateModal,
        showVariableDeleteConfirm,
        variableToDelete,
        clipboard,
        reteEditor,
        pendingPositions,

        // Computed
        hasSelection,
        selectedNodeCount,
        singleNodeSelected,
        selectedNodeId,

        // Selection actions
        selectNode,
        deselectNode,
        selectEdge,
        deselectEdge,
        clearSelection,
        selectMultipleNodes,

        // Viewport actions
        setZoom,
        zoomIn,
        zoomOut,
        resetZoom,
        setPan,

        // Locale actions
        setCurrentLocale,
        setUiLocale,

        // Search/Filter actions
        setSearchQuery,
        setFilterType,
        clearSearch,

        // Panel actions
        setActiveGlobalPanel,
        toggleProblemsPanel,
        toggleMinimap,
        toggleInspector,

        // Inspector actions
        toggleInspectorSection,
        isInspectorSectionExpanded,

        // Modal actions
        openImportModal,
        closeImportModal,
        openExportModal,
        closeExportModal,
        openTemplateModal,
        closeTemplateModal,

        // Focus actions
        requestFocusNode,
        requestInspectorSection,
        confirmDeleteVariable,
        cancelDeleteVariable,

        // Clipboard actions
        setClipboard,
        clearClipboard,

        // Rete editor
        setReteEditor,

        // Pending positions
        setPendingPositions,
        clearPendingPositions,
    };
});
