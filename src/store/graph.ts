// Graph Store - Manages nodes, edges, and global configuration
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type {
    Question,
    QuestionType,
    MetaBlock,
    I18nBlock,
    FormBlock,
    RuntimeBlock,
    Variable,
    CalculationBlock,
    FlowBlock,
} from '@/types/runtime';
import type { EditorNode, EditorEdge, Position } from '@/types/editor';

export const useGraphStore = defineStore('graph', () => {
    // =========================================================================
    // State
    // =========================================================================

    // Graph data
    const nodes = ref<Map<string, EditorNode>>(new Map());
    const edges = ref<EditorEdge[]>([]);

    // Import signal - incremented after each import to trigger sync
    const importVersion = ref(0);

    // Flag to indicate import in progress (prevents watchers from reacting)
    const isImporting = ref(false);

    // Global configuration
    const meta = ref<MetaBlock>({ id: '', title: '', version: '0' });
    const i18n = ref<I18nBlock>({ defaultLocale: 'de-DE', supported: ['de-DE'] });
    const form = ref<FormBlock>({});
    const runtime = ref<RuntimeBlock>({});
    const variables = ref<Variable[]>([]);
    const calculation = ref<CalculationBlock>({
        checkboxOptionOrder: 'definition',
        onDivZero: 'skip',
        rounding: 2,
        effectOrder: 'action-option',
    });
    const flow = ref<FlowBlock>({ end: 'submit', routingPriority: 'options-first' });
    const version = ref<string>('1');
    const schemaId = ref<string>('');
    const schemaHash = ref<string>('');

    // =========================================================================
    // Computed
    // =========================================================================

    const nodeCount = computed(() => nodes.value.size);
    const questionNodes = computed(() =>
        Array.from(nodes.value.values()).filter(n => n.type === 'question')
    );
    const edgeCount = computed(() => edges.value.length);

    const supportedLocales = computed(() => i18n.value.supported || ['de-DE']);
    const defaultLocale = computed(() => i18n.value.defaultLocale || 'de-DE');
    const isMultiLocale = computed(() => supportedLocales.value.length > 1);

    const startNode = computed(() => nodes.value.get('__start__'));
    const endNode = computed(() => nodes.value.get('__end__'));

    // =========================================================================
    // Actions - Node Management
    // =========================================================================

    function addNode(node: EditorNode): void {
        nodes.value.set(node.id, node);
    }

    function removeNode(nodeId: string): void {
        nodes.value.delete(nodeId);
        // Remove connected edges
        edges.value = edges.value.filter(
            e => e.source !== nodeId && e.target !== nodeId
        );
    }

    function updateNode(nodeId: string, updates: Partial<Question>): void {
        const node = nodes.value.get(nodeId);
        if (node && node.data) {
            node.data = { ...node.data, ...updates };
        }
    }

    function updateNodePosition(nodeId: string, position: Position): void {
        const node = nodes.value.get(nodeId);
        if (node) {
            node.position = position;
        }
    }

    function getNode(nodeId: string): EditorNode | undefined {
        return nodes.value.get(nodeId);
    }

    function createQuestionNode(
        type: QuestionType,
        position: Position = { x: 0, y: 0 }
    ): EditorNode {
        const id = uuidv4();
        const node: EditorNode = {
            id,
            type: 'question',
            questionType: type,
            position,
            data: {
                id,
                type,
                label: '',
                required: false,
            },
        };

        // Add type-specific defaults
        if (type === 'select' || type === 'checkbox') {
            node.data!.options = [];
        }

        return node;
    }

    function duplicateNode(nodeId: string): EditorNode | null {
        const original = nodes.value.get(nodeId);
        if (!original || !original.data) return null;

        const newId = uuidv4();
        const newData: Question = {
            ...JSON.parse(JSON.stringify(original.data)),
            id: newId,
        };

        // Regenerate option IDs
        if (newData.options) {
            newData.options = newData.options.map(opt => ({
                ...opt,
                id: uuidv4(),
            }));
        }

        const newNode: EditorNode = {
            id: newId,
            type: 'question',
            questionType: original.questionType,
            position: {
                x: original.position.x + 50,
                y: original.position.y + 50,
            },
            data: newData,
        };

        addNode(newNode);
        return newNode;
    }

    // =========================================================================
    // Actions - Edge Management
    // =========================================================================

    function addEdge(edge: EditorEdge): void {
        // Check if edge already exists (exact same connection)
        const exists = edges.value.some(
            e => e.source === edge.source &&
                e.sourcePort === edge.sourcePort &&
                e.target === edge.target
        );
        if (exists) return;

        // Enforce max 1 edge per output port - remove any existing edge from same source port
        const existingFromPort = edges.value.find(
            e => e.source === edge.source && e.sourcePort === edge.sourcePort
        );
        if (existingFromPort) {
            // Remove the old edge before adding new one
            edges.value = edges.value.filter(e => e.id !== existingFromPort.id);
        }

        edges.value.push(edge);
    }

    function removeEdge(edgeId: string): void {
        edges.value = edges.value.filter(e => e.id !== edgeId);
    }

    function getEdgesFrom(nodeId: string): EditorEdge[] {
        return edges.value.filter(e => e.source === nodeId);
    }

    function getEdgesTo(nodeId: string): EditorEdge[] {
        return edges.value.filter(e => e.target === nodeId);
    }

    function createEdge(
        source: string,
        sourcePort: string,
        target: string,
        targetPort: string = 'prev',
        type: EditorEdge['type'] = 'default'
    ): EditorEdge {
        return {
            id: uuidv4(),
            source,
            sourcePort,
            target,
            targetPort,
            type,
        };
    }

    // =========================================================================
    // Actions - Variable Management
    // =========================================================================

    function addVariable(id: string, initial: number = 0): void {
        if (!variables.value.find(v => v.id === id)) {
            variables.value.push({ id, initial });
        }
    }

    function updateVariable(id: string, initial: number): void {
        const variable = variables.value.find(v => v.id === id);
        if (variable) {
            variable.initial = initial;
        }
    }

    function removeVariable(varId: string): string[] {
        const affectedNodeIds: string[] = [];

        // Remove from variables list
        variables.value = variables.value.filter(v => v.id !== varId);

        // Remove references in nodes
        nodes.value.forEach(node => {
            if (!node.data) return;
            let affected = false;

            // Remove from effects
            if (node.data.effects) {
                const before = node.data.effects.length;
                node.data.effects = node.data.effects.filter(e => e.var !== varId);
                if (node.data.effects.length < before) affected = true;
            }

            // Remove from options effects
            node.data.options?.forEach(opt => {
                if (opt.effects) {
                    const before = opt.effects.length;
                    opt.effects = opt.effects.filter(e => e.var !== varId);
                    if (opt.effects.length < before) affected = true;
                }
            });

            if (affected) affectedNodeIds.push(node.id);
        });

        return affectedNodeIds;
    }

    function renameVariable(oldId: string, newId: string): void {
        // Update variables list
        const variable = variables.value.find(v => v.id === oldId);
        if (variable) {
            variable.id = newId;
        }

        // Update all references in nodes
        nodes.value.forEach(node => {
            if (!node.data) return;

            // Update effects
            node.data.effects?.forEach(e => {
                if (e.var === oldId) e.var = newId;
            });

            // Update options effects
            node.data.options?.forEach(opt => {
                opt.effects?.forEach(e => {
                    if (e.var === oldId) e.var = newId;
                });
            });

        });

    }

    function getVariableReferences(varId: string): { nodeId: string; location: string }[] {
        const refs: { nodeId: string; location: string }[] = [];

        nodes.value.forEach(node => {
            if (!node.data) return;

            node.data.effects?.forEach((e, i) => {
                if (e.var === varId) {
                    refs.push({ nodeId: node.id, location: `effects[${i}]` });
                }
            });

            node.data.options?.forEach((opt, oi) => {
                opt.effects?.forEach((e, ei) => {
                    if (e.var === varId) {
                        refs.push({ nodeId: node.id, location: `options[${oi}].effects[${ei}]` });
                    }
                });
            });

        });

        return refs;
    }

    // =========================================================================
    // Actions - i18n Management
    // =========================================================================

    function addLocale(locale: string): void {
        if (!i18n.value.supported) {
            i18n.value.supported = [i18n.value.defaultLocale || 'de-DE'];
        }
        if (!i18n.value.supported.includes(locale)) {
            i18n.value.supported.push(locale);

            // Create empty string entries for the new locale in all nodes
            nodes.value.forEach((node) => {
                if (!node.data) return;

                // Add empty strings for localized string fields
                const localizedFields = ['label', 'placeholder', 'description'];
                for (const field of localizedFields) {
                    const value = (node.data as Record<string, unknown>)[field];
                    if (typeof value === 'object' && value !== null) {
                        const localeMap = value as Record<string, string>;
                        if (!(locale in localeMap)) {
                            localeMap[locale] = '';
                        }
                    } else if (typeof value === 'string') {
                        // Convert string to locale map with empty string for new locale
                        const existingLocales = (i18n.value.supported || []).filter(l => l !== locale);
                        const srcLocale = existingLocales[0] || 'de-DE';
                        (node.data as Record<string, unknown>)[field] = {
                            [srcLocale]: value,
                            [locale]: ''
                        };
                    }
                }

                // Add empty strings for image localized fields (src, alt)
                const image = node.data.image;
                if (image && typeof image === 'object') {
                    const imgObj = image as { src?: string | Record<string, string>; alt?: string | Record<string, string> };

                    if (typeof imgObj.src === 'object' && imgObj.src !== null) {
                        if (!(locale in imgObj.src)) {
                            imgObj.src[locale] = '';
                        }
                    }

                    if (typeof imgObj.alt === 'object' && imgObj.alt !== null) {
                        if (!(locale in imgObj.alt)) {
                            imgObj.alt[locale] = '';
                        }
                    }
                }

                // Add empty strings for option labels
                if (node.data.options) {
                    for (const opt of node.data.options) {
                        if (typeof opt.label === 'object' && opt.label !== null) {
                            const localeMap = opt.label as Record<string, string>;
                            if (!(locale in localeMap)) {
                                localeMap[locale] = '';
                            }
                        } else if (typeof opt.label === 'string') {
                            const existingLocales = (i18n.value.supported || []).filter(l => l !== locale);
                            const srcLocale = existingLocales[0] || 'de-DE';
                            opt.label = {
                                [srcLocale]: opt.label,
                                [locale]: ''
                            };
                        }
                    }
                }
            });
        }
    }

    function removeLocale(locale: string): void {
        if (i18n.value.supported) {
            i18n.value.supported = i18n.value.supported.filter(l => l !== locale);
        }
    }

    function setDefaultLocale(locale: string): void {
        i18n.value.defaultLocale = locale;
        if (!i18n.value.supported?.includes(locale)) {
            addLocale(locale);
        }
    }

    // =========================================================================
    // Actions - Reset/Initialize
    // =========================================================================

    function reset(): void {
        nodes.value = new Map();
        edges.value = [];
        meta.value = { id: '', title: '', version: '0' };
        i18n.value = { defaultLocale: 'de-DE', supported: ['de-DE'] };
        form.value = {
            title: 'New Form',
            description: '',
            progress: { mode: 'percent' }
        };
        runtime.value = {
            session: {
                resume: {
                    maxAgeMinutes: 120
                }
            }
        };
        variables.value = [];
        calculation.value = {
            checkboxOptionOrder: 'definition',
            onDivZero: 'skip',
            rounding: 2,
            effectOrder: 'action-option',
        };
        flow.value = { end: 'submit', routingPriority: 'options-first' };
        version.value = '1';
        schemaId.value = '';
        schemaHash.value = '';
    }

    /**
     * Signal that an import has completed.
     * This triggers watchers to sync connections.
     */
    function signalImport(): void {
        importVersion.value++;
    }

    /**
     * Set the importing flag. Call this BEFORE populating store during import.
     */
    function setImporting(value: boolean): void {
        isImporting.value = value;
    }

    function initializeEmptyGraph(): void {
        reset();

        // Create Start node
        const startNode: EditorNode = {
            id: '__start__',
            type: 'start',
            position: { x: 0, y: 0 },
            data: null,
        };

        // Create End node
        const endNode: EditorNode = {
            id: '__end__',
            type: 'end',
            position: { x: 0, y: 200 },
            data: null,
        };

        nodes.value.set(startNode.id, startNode);
        nodes.value.set(endNode.id, endNode);
    }

    // =========================================================================
    // Return
    // =========================================================================

    return {
        // State
        nodes,
        edges,
        meta,
        i18n,
        form,
        runtime,
        variables,
        calculation,
        flow,
        version,
        schemaId,
        schemaHash,

        // Computed
        nodeCount,
        questionNodes,
        edgeCount,
        supportedLocales,
        defaultLocale,
        isMultiLocale,
        startNode,
        endNode,

        // Node actions
        addNode,
        removeNode,
        updateNode,
        updateNodePosition,
        getNode,
        createQuestionNode,
        duplicateNode,

        // Edge actions
        addEdge,
        removeEdge,
        getEdgesFrom,
        getEdgesTo,
        createEdge,

        // Variable actions
        addVariable,
        updateVariable,
        removeVariable,
        renameVariable,
        getVariableReferences,

        // i18n actions
        addLocale,
        removeLocale,
        setDefaultLocale,

        // Reset
        reset,
        initializeEmptyGraph,

        // Import signal
        importVersion,
        signalImport,
        isImporting,
        setImporting,
    };
});
