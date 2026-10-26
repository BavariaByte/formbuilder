// JSON Importer - Parses and transforms JSON to editor state
import { v4 as uuidv4 } from 'uuid';
import type {
    PlaybookDefinition,
} from '@/types/runtime';
import type {
    EditorNode,
    EditorEdge,
    ImportResult,
    ImportWarning,
} from '@/types/editor';

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_QUESTIONS = 500;

// ============================================================================
// Import Function
// ============================================================================

/**
 * Import a JSON string and convert to editor state.
 */
export function importPlaybook(jsonString: string): ImportResult {
    const warnings: ImportWarning[] = [];

    // Check size limit
    if (jsonString.length > MAX_FILE_SIZE) {
        return {
            success: false,
            warnings: [],
            errors: [`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024} MB`],
        };
    }

    // Parse JSON
    let data: PlaybookDefinition;
    try {
        data = JSON.parse(jsonString);
    } catch (e) {
        const error = e as Error;
        return {
            success: false,
            warnings: [],
            errors: [`Invalid JSON: ${error.message}`],
        };
    }

    // Validate basic structure
    const validationErrors = validatePlaybookStructure(data);
    if (validationErrors.length > 0) {
        return {
            success: false,
            warnings: [],
            errors: validationErrors,
        };
    }

    // Check question count limit
    if (data.questions.length > MAX_QUESTIONS) {
        return {
            success: false,
            warnings: [],
            errors: [`Too many questions: ${data.questions.length}. Maximum is ${MAX_QUESTIONS}`],
        };
    }

    // Build node map
    const nodes = new Map<string, EditorNode>();
    const edges: EditorEdge[] = [];

    // Create Start node
    nodes.set('__start__', {
        id: '__start__',
        type: 'start',
        position: { x: 0, y: 0 },
        data: null,
    });

    // Create End node
    nodes.set('__end__', {
        id: '__end__',
        type: 'end',
        position: { x: 0, y: 0 },
        data: null,
    });

    // Create Question nodes
    for (const question of data.questions) {
        // Check for visibleIf (not supported)
        if ('visibleIf' in question) {
            warnings.push({
                type: 'visibleIf',
                questionId: question.id,
                message: `Question "${question.id}" has visibleIf which is not supported and will be ignored`,
            });
            // Remove visibleIf from question
            delete (question as any).visibleIf;
        }

        // Normalize legacy options format to standard `{ options: [{ id, value, label }] }`
        const anyQ = question as any;
        if (anyQ.values && !anyQ.options) {
            anyQ.options = anyQ.values;
            delete anyQ.values;
        }
        if (Array.isArray(anyQ.options)) {
            anyQ.options = anyQ.options.map((opt: any) => {
                if (typeof opt === 'string' || typeof opt === 'number') {
                    return { id: String(opt), value: String(opt), label: String(opt) };
                }
                if (typeof opt === 'object' && opt !== null) {
                    const fallbackValue = opt.value ?? opt.id ?? opt.key ?? opt.name;
                    const fallbackLabel = opt.label ?? opt.text ?? opt.title ?? opt.name ?? fallbackValue;
                    return {
                        ...opt,
                        id: opt.id || String(fallbackValue),
                        value: String(fallbackValue),
                        label: fallbackLabel
                    };
                }
                return opt;
            });
        }

        nodes.set(question.id, {
            id: question.id,
            type: 'question',
            questionType: question.type,
            position: { x: 0, y: 0 },
            data: question,
        });
    }

    // Create edge from Start to first question
    if (data.flow?.start) {
        const targetId = data.flow.start === 'submit' ? '__end__' : data.flow.start;
        edges.push({
            id: uuidv4(),
            source: '__start__',
            sourcePort: 'next',
            target: targetId,
            targetPort: 'prev',
            type: 'default',
        });
    }

    // Create edges from Questions
    for (const question of data.questions) {
        // Option edges (highest priority)
        if (question.options) {
            for (const option of question.options) {
                if (option.next) {
                    const targetId = option.next === 'submit' ? '__end__' : option.next;
                    edges.push({
                        id: uuidv4(),
                        source: question.id,
                        sourcePort: `option_${option.id}`,
                        target: targetId,
                        targetPort: 'prev',
                        type: 'option',
                        optionId: option.id,
                    });
                }
            }
        }

        // Routing edges – skip effect-only rules (no goto)
        if (question.actions) {
            question.actions.forEach((rule, index) => {
                if (!rule.goto) return;
                const targetId = rule.goto === 'submit' ? '__end__' : rule.goto;
                edges.push({
                    id: uuidv4(),
                    source: question.id,
                    sourcePort: `routing_${index}`,
                    target: targetId,
                    targetPort: 'prev',
                    type: 'routing',
                    routingIndex: index,
                });
            });
        }

        // Default edge
        if (question.defaultNext) {
            const targetId = question.defaultNext === 'submit' ? '__end__' : question.defaultNext;
            edges.push({
                id: uuidv4(),
                source: question.id,
                sourcePort: 'default',
                target: targetId,
                targetPort: 'prev',
                type: 'default',
            });
        }
    }

    // Validate all edge targets exist
    for (const edge of edges) {
        if (!nodes.has(edge.target)) {
            warnings.push({
                type: 'unknown_field',
                message: `Edge target "${edge.target}" does not exist`,
            });
        }
    }

    return {
        success: true,
        state: {
            nodes,
            edges,
            selectedNodeIds: new Set(),
            selectedEdgeIds: new Set(),
            clipboard: [],
            currentLocale: data.i18n?.defaultLocale || data.meta.locale || 'de-DE',
            zoom: 1,
            pan: { x: 0, y: 0 },
            searchQuery: '',
            filterType: 'all',
        },
        warnings,
        errors: [],
    };
}

/**
 * Import from File object.
 */
export async function importPlaybookFromFile(file: File): Promise<ImportResult> {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
        return {
            success: false,
            warnings: [],
            errors: [`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024} MB`],
        };
    }

    // Read file content
    try {
        const text = await file.text();
        return importPlaybook(text);
    } catch (e) {
        const error = e as Error;
        return {
            success: false,
            warnings: [],
            errors: [`Failed to read file: ${error.message}`],
        };
    }
}

// ============================================================================
// Validation
// ============================================================================

function validatePlaybookStructure(data: any): string[] {
    const errors: string[] = [];

    if (typeof data !== 'object' || data === null) {
        errors.push('Invalid playbook: root must be an object');
        return errors;
    }

    if (data.type !== 'form-definition') {
        errors.push('Invalid playbook: type must be "form-definition"');
    }

    if (!data.version && (!data.meta || !data.meta.version)) {
        errors.push('Invalid playbook: version is required (in root or meta)');
    }

    if (!data.meta || typeof data.meta !== 'object') {
        errors.push('Invalid playbook: meta block is required');
    } else {
        if (!data.meta.id) {
            errors.push('Invalid playbook: meta.id is required');
        }
        // Title check: allow in meta OR form
        const hasMetaTitle = !!data.meta.title;
        const hasFormTitle = !!(data.form && data.form.title);

        if (!hasMetaTitle && !hasFormTitle) {
            errors.push('Invalid playbook: title is required (in meta or form)');
        }
    }

    if (!Array.isArray(data.questions)) {
        errors.push('Invalid playbook: questions must be an array');
    } else {
        // Check for duplicate IDs
        const ids = new Set<string>();
        for (const q of data.questions) {
            if (!q.id) {
                errors.push('Invalid question: id is required');
            } else if (ids.has(q.id)) {
                errors.push(`Duplicate question ID: ${q.id}`);
            } else {
                ids.add(q.id);
            }

            if (!q.type) {
                errors.push(`Question ${q.id || '(unknown)'}: type is required`);
            }
        }
    }

    // Validate flow.end is 'submit'
    if (data.flow && data.flow.end !== 'submit') {
        errors.push('Invalid playbook: flow.end must be "submit"');
    }

    return errors;
}

// ============================================================================
// Global Config Extraction
// ============================================================================

/**
 * Extract global configuration from playbook data.
 * Fills form.title and form.description from meta if not set in form block.
 */
export function extractGlobalConfig(data: PlaybookDefinition) {
    // Build form config, filling title/description from meta if not set
    const formConfig = data.form || {};

    // Fill title from meta if not in form
    if (!formConfig.title && data.meta?.title) {
        formConfig.title = data.meta.title;
    }

    // Fill description from meta.description if available (though usually not in meta)
    // This is a fallback in case form.description is empty
    if (!formConfig.description && (data as any).description) {
        formConfig.description = (data as any).description;
    }

    // Progress mode is always percent
    formConfig.progress = { mode: 'percent' };

    // Copy the playbook version to meta.version for user editing
    // Convert version to simple integer format (e.g., "1.1" -> "1")
    const rawVersion = data.meta?.version || (data as any).version || '0';
    const majorVersion = String(parseInt(rawVersion, 10) || 0);

    const metaWithVersion = {
        ...data.meta,
        version: majorVersion,
    };

    // Cleanup: Remove title from meta since it is now in form
    delete metaWithVersion.title;

    // Migrate routingPriority from calculation → flow (backward compat)
    const { routingPriority: legacyRp, ...cleanCalc } = (data.calculation || {}) as any;
    const flowBase = data.flow || { end: 'submit' };
    const flowConfig = legacyRp && !(flowBase as any).routingPriority
        ? { ...flowBase, routingPriority: legacyRp }
        : flowBase;

    return {
        meta: metaWithVersion,
        i18n: data.i18n || { defaultLocale: 'de-DE', supported: ['de-DE'] },
        form: formConfig,
        runtime: data.runtime || {},
        variables: data.variables || [],
        calculation: cleanCalc,
        flow: flowConfig,
        // Explicitly remove root version to enforce usage of meta.version
        version: undefined,
        schemaId: data.schemaId || '',
        schemaHash: data.schemaHash || '',
        nodePositions: (data as any)._nodePositions ?? null,
    };
}
