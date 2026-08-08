// JSON Exporter - Converts editor state to runtime JSON
import type {
    PlaybookDefinition,
    Question,
    MetaBlock,
    I18nBlock,
    FormBlock,
    RuntimeBlock,
    Variable,
    CalculationBlock,
    FlowBlock,
} from '@/types/runtime';
import type { EditorNode, EditorEdge, ExportOptions } from '@/types/editor';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Increment version string by +1.
 * Handles simple integer versions like "0", "1", "2".
 */
function incrementVersion(version: string): string {
    const num = parseInt(version, 10);
    // Use 0 as baseline if parsing fails (NaN) or if number is negative
    // This ensures minimum output version is always 1 (0 + 1)
    const baseline = (isNaN(num) || num < 0) ? 0 : num;
    return String(baseline + 1);
}

/**
 * Clean an i18n string value:
 * - Remove keys NOT in supportedLocales
 * - If 0 or 1 locale remain after cleaning, collapse to a plain string
 *   using defaultLocale value (or first available, or empty string)
 */
function cleanI18nValue(
    value: string | Record<string, string> | undefined | null,
    supportedLocales: string[],
    defaultLocale: string
): string | Record<string, string> | undefined {
    if (!value) return value as undefined;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object' || Array.isArray(value)) return value;

    // Filter to only supported locales
    const cleaned: Record<string, string> = {};
    for (const locale of supportedLocales) {
        if (locale in value) {
            cleaned[locale] = (value as Record<string, string>)[locale]!;
        }
    }

    // Collapse to plain string if only one locale (or none)
    const remainingKeys = Object.keys(cleaned);
    if (remainingKeys.length <= 1) {
        return cleaned[defaultLocale] ?? (remainingKeys.length > 0 ? cleaned[remainingKeys[0]!] : '');
    }

    return cleaned;
}

/**
 * Recursively clean all i18n fields in a question using the supported locales.
 */
function cleanQuestionLocales(
    question: Question,
    supportedLocales: string[],
    defaultLocale: string
): void {
    const clean = (v: string | Record<string, string> | undefined | null) =>
        cleanI18nValue(v, supportedLocales, defaultLocale);

    // Question-level string fields
    if (question.label !== undefined) {
        question.label = clean(question.label as any) as any;
    }
    if (question.description !== undefined) {
        question.description = clean(question.description as any) as any;
    }
    if ((question as any).placeholder !== undefined) {
        (question as any).placeholder = clean((question as any).placeholder);
    }

    // Options — strip internal id (Formbuilder-only), keep value/label/etc.
    if (question.options) {
        for (const opt of question.options) {
            if (opt.label !== undefined) {
                opt.label = clean(opt.label as any) as any;
            }
            delete (opt as any).id;
            if (Array.isArray((opt as any).effects) && (opt as any).effects.length === 0) {
                delete (opt as any).effects;
            }
        }
    }

    // Strip empty top-level arrays
    if (Array.isArray((question as any).effects) && (question as any).effects.length === 0) {
        delete (question as any).effects;
    }
    if (Array.isArray((question as any).actions) && (question as any).actions.length === 0) {
        delete (question as any).actions;
    }

    // Strip redundant questionId from action conditions (implicitly the current question)
    for (const action of (question as any).actions ?? []) {
        if (action.when && 'questionId' in action.when) {
            delete action.when.questionId;
        }
    }

    // Image src & alt
    const img = (question as any).image;
    if (img && typeof img === 'object') {
        if (img.src && typeof img.src === 'object') {
            img.src = clean(img.src);
        }
        if (img.alt && typeof img.alt === 'object') {
            img.alt = clean(img.alt);
        }
    }
}

// ============================================================================
// Export Function
// ============================================================================

export interface ExportContext {
    nodes: Map<string, EditorNode>;
    edges: EditorEdge[];
    meta: MetaBlock;
    i18n: I18nBlock;
    form: FormBlock;
    runtime: RuntimeBlock;
    variables: Variable[];
    calculation: CalculationBlock;
    flow: FlowBlock;
    version: string;
    schemaId: string;
    schemaHash: string;
}

export interface ExportResult {
    success: boolean;
    json?: string;
    data?: PlaybookDefinition;
    unreachableNodes: string[];
    errors: string[];
}

/**
 * Export editor state to runtime JSON.
 * Uses BFS traversal for deterministic question ordering.
 */
export function exportPlaybook(
    context: ExportContext,
    options: ExportOptions = {}
): ExportResult {
    const { prettyPrint = true } = options;
    const errors: string[] = [];

    // Find reachable nodes via BFS
    const { unreachable } = findReachableNodes(
        context.nodes,
        context.edges
    );

    // Build questions array from reachable nodes in BFS order first, then append unreachable
    const questions: Question[] = [];
    const questionOrder = bfsTraversal(context.nodes, context.edges);
    const allOrder = [...questionOrder, ...Array.from(unreachable)];

    for (const nodeId of allOrder) {
        if (nodeId === '__start__' || nodeId === '__end__') continue;

        const node = context.nodes.get(nodeId);
        if (!node || !node.data) continue;

        // Clone question data
        const question: Question = JSON.parse(JSON.stringify(node.data));

        // Update routing targets from edges
        updateQuestionTargets(question, nodeId, context.edges);

        // Clean up stale locale keys and collapse single-locale objects to plain strings
        const supported = context.i18n?.supported || [];
        const defaultLocale = context.i18n?.defaultLocale || (supported[0] ?? 'de-DE');
        if (supported.length > 0) {
            cleanQuestionLocales(question, supported, defaultLocale);
        }

        questions.push(question);
    }

    // Validate required meta fields
    if (!context.meta.id) {
        errors.push('meta.id is required for export');
    }
    // Check form.title OR meta.title (legacy)
    if (!context.form.title && !context.meta.title) {
        errors.push('Title is required (in Form Settings)');
    }
    // Check for duplicate option values per question
    for (const q of questions) {
        if (q.options && q.options.length > 0) {
            const seen = new Set<string>();
            for (const opt of q.options) {
                if (seen.has(opt.value)) {
                    errors.push(`Question "${q.id}": duplicate option value "${opt.value}"`);
                    break;
                }
                seen.add(opt.value);
            }
        }
    }
    // Return with errors if validation failed
    if (errors.length > 0) {
        return {
            success: false,
            json: undefined,
            data: undefined,
            unreachableNodes: Array.from(unreachable),
            errors,
        };
    }

    // Build flow.start from Start node's edge
    let flowStart: string | undefined;
    const startEdge = context.edges.find(e => e.source === '__start__');
    if (startEdge) {
        flowStart = startEdge.target === '__end__' ? 'submit' : startEdge.target;
    }

    // Increment the playbook version by +1 for export
    const currentVersion = context.meta.version || '0';
    const incrementedVersion = incrementVersion(currentVersion);

    // Build meta with incremented version
    const exportMeta = {
        ...context.meta,
        version: incrementedVersion,
    };

    // Build playbook definition with explicit property order (questions last)
    const playbook: PlaybookDefinition = {
        type: 'form-definition',
        meta: exportMeta,
        questions: [], // Placeholder - will be set at end
    };

    // Add optional fields if present
    if (context.schemaId) {
        playbook.schemaId = context.schemaId;
    }
    if (context.schemaHash) {
        playbook.schemaHash = context.schemaHash;
    }
    if (context.i18n && (context.i18n.defaultLocale || context.i18n.supported?.length)) {
        playbook.i18n = context.i18n;
    }
    if (Object.keys(context.form).length > 0) {
        const formExport = JSON.parse(JSON.stringify(context.form));
        if (formExport.completion) {
            delete formExport.completion.summaryEditable;
            if (Object.keys(formExport.completion).length === 0) {
                delete formExport.completion;
            }
        }
        if (Object.keys(formExport).length > 0) {
            playbook.form = formExport;
        }
    }
    {
        const runtimeExport = Object.keys(context.runtime).length > 0
            ? JSON.parse(JSON.stringify(context.runtime))
            : {};
        delete runtimeExport.api;
        delete runtimeExport.scoring;
        if (runtimeExport.session && !runtimeExport.session.identityQuestionId) {
            delete runtimeExport.session.identityQuestionId;
        }
        if (runtimeExport.session?.resume) {
            delete runtimeExport.session.resume.sameBrowserOnly;
        }
        // Always ensure session.resume.maxAgeMinutes is exported (default 120)
        if (!runtimeExport.session) runtimeExport.session = {};
        if (!runtimeExport.session.resume) runtimeExport.session.resume = {};
        if (runtimeExport.session.resume.maxAgeMinutes == null) {
            runtimeExport.session.resume.maxAgeMinutes = 120;
        }
        if (runtimeExport.session && Object.keys(runtimeExport.session).length === 0) {
            delete runtimeExport.session;
        }
        if (Object.keys(runtimeExport).length > 0) {
            playbook.runtime = runtimeExport;
        }
    }
    if (context.variables.length > 0) {
        playbook.variables = context.variables;
    }
    if (Object.keys(context.calculation).length > 0) {
        playbook.calculation = { ...context.calculation, onDivZero: 'skip' };
    }
    
    const { endBehavior: _endBehavior, ...flowWithoutEndBehavior } = context.flow as any;
    playbook.flow = {
        ...flowWithoutEndBehavior,
        start: flowStart,
        end: 'submit',
    };



    // Set questions at the end for proper JSON ordering
    playbook.questions = questions;

    // Convert to JSON string with custom property order
    // Convert to JSON string with custom property order
    const orderedPlaybook = {
        type: playbook.type,
        // version: playbook.version, // Removed as per requirement
        meta: {
            ...playbook.meta,
            // remove locale from export if present
            locale: undefined,
            // remove title from meta, it is in form
            title: undefined
        },
        ...(playbook.schemaId && { schemaId: playbook.schemaId }),
        ...(playbook.schemaHash && { schemaHash: playbook.schemaHash }),
        ...(playbook.i18n && { i18n: playbook.i18n }),
        ...(playbook.form && Object.keys(playbook.form).length > 0 && { form: playbook.form }),
        ...(playbook.runtime && Object.keys(playbook.runtime).length > 0 && { runtime: playbook.runtime }),
        ...(playbook.variables && playbook.variables.length > 0 && { variables: playbook.variables }),
        ...(playbook.calculation && Object.keys(playbook.calculation).length > 0 && { calculation: playbook.calculation }),
        flow: playbook.flow,
        questions: playbook.questions, // Questions at the end
        // Editor-only: node positions for re-import (not used at runtime)
        _nodePositions: Object.fromEntries(
            Array.from(context.nodes.entries())
                .filter(([, n]) => n.position)
                .map(([id, n]) => [id, { x: n.position.x, y: n.position.y }])
        ),
    };

    // Clean up undefined properties (like locale)
    if (orderedPlaybook.meta && 'locale' in orderedPlaybook.meta) {
        delete (orderedPlaybook.meta as any).locale;
    }

    const json = prettyPrint
        ? JSON.stringify(orderedPlaybook, null, 2)
        : JSON.stringify(orderedPlaybook);

    return {
        success: true,
        json,
        data: playbook,
        unreachableNodes: Array.from(unreachable),
        errors,
    };
}

// ============================================================================
// BFS Traversal
// ============================================================================

/**
 * Perform BFS traversal from Start node.
 * Returns node IDs in deterministic order based on edge priority.
 */
function bfsTraversal(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[]
): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = ['__start__'];

    while (queue.length > 0) {
        const nodeId = queue.shift()!;

        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        order.push(nodeId);

        // Get outgoing edges sorted by priority
        const outEdges = getOutgoingEdgesSorted(nodeId, edges);

        for (const edge of outEdges) {
            if (!visited.has(edge.target)) {
                queue.push(edge.target);
            }
        }
    }

    return order;
}

/**
 * Get outgoing edges sorted by priority:
 * 1. Option edges (by option ID lexicographically)
 * 2. Routing edges (by index)
 * 3. Default edge
 */
function getOutgoingEdgesSorted(
    nodeId: string,
    edges: EditorEdge[]
): EditorEdge[] {
    const outEdges = edges.filter(e => e.source === nodeId);

    return outEdges.sort((a, b) => {
        // Sort by type priority
        const typePriority = { option: 0, routing: 1, default: 2 };
        const priorityA = typePriority[a.type];
        const priorityB = typePriority[b.type];

        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }

        // Same type: sort by ID/index
        if (a.type === 'option' && b.type === 'option') {
            return (a.optionId || '').localeCompare(b.optionId || '');
        }

        if (a.type === 'routing' && b.type === 'routing') {
            return (a.routingIndex || 0) - (b.routingIndex || 0);
        }

        // Default: sort by target ID
        return a.target.localeCompare(b.target);
    });
}

// ============================================================================
// Reachability
// ============================================================================

/**
 * Find nodes reachable from Start node.
 */
function findReachableNodes(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[]
): { reachable: Set<string>; unreachable: Set<string> } {
    const reachable = new Set<string>();
    const visited = new Set<string>();
    const stack = ['__start__'];

    while (stack.length > 0) {
        const nodeId = stack.pop()!;

        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        reachable.add(nodeId);

        const outEdges = edges.filter(e => e.source === nodeId);
        for (const edge of outEdges) {
            if (!visited.has(edge.target)) {
                stack.push(edge.target);
            }
        }
    }

    // Find unreachable question nodes
    const unreachable = new Set<string>();
    for (const [nodeId, node] of nodes) {
        if (node.type === 'question' && !reachable.has(nodeId)) {
            unreachable.add(nodeId);
        }
    }

    return { reachable, unreachable };
}

// ============================================================================
// Target Updates
// ============================================================================

/**
 * Update question's routing targets from edges.
 * Converts __end__ back to 'submit'.
 */
function updateQuestionTargets(
    question: Question,
    nodeId: string,
    edges: EditorEdge[]
): void {
    const nodeEdges = edges.filter(e => e.source === nodeId);

    // Update defaultNext from default edge
    const defaultEdge = nodeEdges.find(e => e.type === 'default');
    if (defaultEdge) {
        question.defaultNext = defaultEdge.target === '__end__'
            ? 'submit'
            : defaultEdge.target;
    } else {
        delete question.defaultNext;
    }

    // Update routing from routing edges; effect-only rules (no goto) have no edge and are left as-is
    if (question.actions) {
        for (const edge of nodeEdges) {
            if (edge.type === 'routing' && edge.routingIndex !== undefined) {
                const rule = question.actions[edge.routingIndex];
                if (rule && rule.goto !== undefined) {
                    rule.goto = edge.target === '__end__' ? 'submit' : edge.target;
                }
            }
        }
    }

    // Update options from option edges
    if (question.options) {
        for (const edge of nodeEdges) {
            if (edge.type === 'option' && edge.optionId) {
                const option = question.options.find(o => o.id === edge.optionId);
                if (option) {
                    option.next = edge.target === '__end__' ? 'submit' : edge.target;
                }
            }
        }

        // Remove next from options without edges
        const optionEdgeIds = new Set(
            nodeEdges.filter(e => e.type === 'option').map(e => e.optionId)
        );
        for (const option of question.options) {
            if (!optionEdgeIds.has(option.id)) {
                delete option.next;
            }
        }
    }
}

// ============================================================================
// Download Helper
// ============================================================================

/**
 * Trigger a download of the JSON file.
 */
export function downloadJson(json: string, filename: string = 'playbook.json'): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
