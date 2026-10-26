// Validation Engine - Real-time validation of the graph
import { v4 as uuidv4 } from 'uuid';
import type { EditorNode, EditorEdge, ValidationIssue } from '@/types/editor';
import type { Question, Variable, MetaBlock, Effect } from '@/types/runtime';

// ============================================================================
// Main Validation Function
// ============================================================================

export interface ValidationContext {
    nodes: Map<string, EditorNode>;
    edges: EditorEdge[];
    variables: Variable[];
    meta?: MetaBlock;
    form?: any; // FormBlock
    runtime?: any; // RuntimeBlock
    i18n?: { defaultLocale?: string; supported?: string[] };
    flowStart?: string;
}

/**
 * Run all validators and return issues.
 */
export function validateGraph(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Metadata/Form validation
    issues.push(...validateMetadata(context));

    // Translation validation
    issues.push(...validateTranslations(context));

    // Syntax validation
    issues.push(...validateSyntax(context));
    // Semantic validation
    issues.push(...validateSemantics(context));

    // Graph validation
    issues.push(...validateGraphStructure(context));

    return issues;
}

function validateMetadata(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { meta, form } = context;

    if (meta) {
        if (!meta.id || meta.id.trim() === '') {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'semantic',
                message: 'Playbook ID is required',
                messageKey: 'validator.playbookIdRequired',
                panel: 'meta',
            });
        }
    }

    // Handle localized title (check form first, then meta)
    const title = form?.title || meta?.title;

    // 1. Check existence
    if (isLocalizedStringEmpty(title)) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'semantic',
            message: 'Playbook Title is required',
            messageKey: 'validator.playbookTitleRequired',
            panel: 'form',
        });
    } else if (typeof title === 'object' && context.i18n?.supported) {
        // 2. Strict check: Must exist for ALL supported locales
        // If it's a string, it applies to all (valid). If object, must have keys.
        const supportedLocales = context.i18n.supported;
        const titleMap = title as Record<string, string>;

        for (const locale of supportedLocales) {
            if (!titleMap[locale] || titleMap[locale].trim() === '') {
                issues.push({
                    id: uuidv4(),
                    severity: 'error',
                    category: 'semantic', // Blocking error
                    message: `Playbook Title is missing for language: ${locale}`,
                    messageKey: 'validator.playbookTitleMissingLocale',
                    messageParams: { locale },
                    panel: 'form',
                });
            }
        }
    }

    return issues;
}

function validateTranslations(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { nodes, i18n } = context;

    if (!i18n || !i18n.supported || i18n.supported.length <= 1) {
        return issues; // No validation needed if only 1 language or no i18n config
    }

    const supportedLocales = i18n.supported;
    const missingPerLocale: Record<string, number> = {};

    for (const [, node] of nodes) {
        if (node.type !== 'question' || !node.data) continue;
        const q = node.data;

        // Fields to check
        const textFields = ['label', 'placeholder', 'description'];

        for (const locale of supportedLocales) {
            let isMissing = false;

            // Check top-level text fields
            for (const field of textFields) {
                const value = (q as any)[field];
                if (typeof value === 'object' && value !== null) {
                    const valStr = (value as Record<string, string>)[locale];
                    if (!valStr || valStr.trim() === '') {
                        // Check if it exists in ANY other locale (to ensure it's a real field)
                        const hasContentElsewhere = Object.values(value as Record<string, string>).some(v => v && v.trim() !== '');
                        if (hasContentElsewhere) isMissing = true;
                    }
                }
            }

            // Check options
            if (!isMissing && q.options) {
                for (const opt of q.options) {
                    if (typeof opt.label === 'object' && opt.label !== null) {
                        const valStr = (opt.label as Record<string, string>)[locale];
                        if (!valStr || valStr.trim() === '') {
                            const hasContentElsewhere = Object.values(opt.label as Record<string, string>).some(v => v && v.trim() !== '');
                            if (hasContentElsewhere) {
                                isMissing = true;
                                break;
                            }
                        }
                    }
                }
            }

            if (isMissing) {
                missingPerLocale[locale] = (missingPerLocale[locale] || 0) + 1;
            }
        }
    }

    // Generate warnings
    for (const [locale, count] of Object.entries(missingPerLocale)) {
        if (count > 0) {
            issues.push({
                id: uuidv4(),
                severity: 'warning',
                category: 'semantic',
                message: `Missing translations for language: ${locale} (${count} questions)`,
                messageKey: 'validator.missingTranslations',
                messageParams: { locale, count },
                panel: 'i18n'
            });
        }
    }

    return issues;
}

/**
 * Check if a LocalizedString is empty (no content in any locale).
 */
function isLocalizedStringEmpty(value: unknown): boolean {
    if (!value) return true;
    if (typeof value === 'string') {
        return value.trim() === '';
    }
    if (typeof value === 'object') {
        // Check if any locale has a non-empty value
        const values = Object.values(value as Record<string, string>);
        return values.every(v => !v || (typeof v === 'string' && v.trim() === ''));
    }
    return true;
}

// ============================================================================
// Syntax Validation
// ============================================================================

function validateSyntax(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const [nodeId, node] of context.nodes) {
        if (node.type !== 'question' || !node.data) continue;

        const question = node.data;

        // Required fields per type
        issues.push(...validateRequiredFields(question, nodeId));

        // Validation config
        issues.push(...validateValidationConfig(question, nodeId));

        // Unique IDs
        issues.push(...validateUniqueIds(question, nodeId, context.nodes));

        // Regex patterns
        issues.push(...validateRegexPatterns(question, nodeId));
    }

    return issues;
}

function validateRequiredFields(question: Question, nodeId: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // All questions should have a label
    if (!question.label) {
        issues.push({
            id: uuidv4(),
            severity: 'warning',
            category: 'syntax',
            nodeId,
            field: 'label',
            message: 'Question is missing a label',
            messageKey: 'validator.questionMissingLabel',
        });
    }

    // Select and checkbox require options
    if ((question.type === 'select' || question.type === 'checkbox')) {
        const typeName = question.type === 'select' ? 'Dropdown' : 'Checkbox';
        if (!question.options || question.options.length === 0) {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'syntax',
                nodeId,
                field: 'options',
                message: `${typeName} question has no options — add at least one in the Options section`,
                messageKey: 'validator.noOptions',
                messageParams: { typeName },
            });
        } else {
            // Validate each option
            for (let i = 0; i < question.options.length; i++) {
                const opt = question.options[i];
                if (opt && !opt.label) {
                    issues.push({
                        id: uuidv4(),
                        severity: 'error',
                        category: 'syntax',
                        nodeId,
                        field: `options[${i}].label`,
                        message: `Option ${i + 1} has no label`,
                        messageKey: 'validator.optionNoLabel',
                        messageParams: { n: i + 1 },
                    });
                }
                if (opt && !opt.value) {
                    issues.push({
                        id: uuidv4(),
                        severity: 'error',
                        category: 'syntax',
                        nodeId,
                        field: `options[${i}].value`,
                        message: `Option ${i + 1} has no value (required for export)`,
                        messageKey: 'validator.optionNoValue',
                        messageParams: { n: i + 1 },
                    });
                }
            }
        }
    }

    return issues;
}

function validateValidationConfig(question: Question, nodeId: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const validation = question.validation;
    if (!validation) return issues;

    // Text: minLength <= maxLength
    if (validation.minLength !== undefined && validation.maxLength !== undefined) {
        if (validation.minLength > validation.maxLength) {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'syntax',
                nodeId,
                field: 'validation',
                message: `Min Length (${validation.minLength}) cannot exceed Max Length (${validation.maxLength})`,
                messageKey: 'validator.minExceedsMax',
                messageParams: { min: validation.minLength, max: validation.maxLength },
            });
        }
    }

    // Number: min <= max
    if (typeof validation.min === 'number' && typeof validation.max === 'number') {
        if (validation.min > validation.max) {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'syntax',
                nodeId,
                field: 'validation',
                message: `Min Value (${validation.min}) cannot exceed Max Value (${validation.max})`,
                messageKey: 'validator.minValueExceedsMax',
                messageParams: { min: validation.min, max: validation.max },
            });
        }
    }

    // Checkbox: maxSelections must be positive
    if (validation.maxSelections !== undefined && validation.maxSelections < 1) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'syntax',
            nodeId,
            field: 'validation.maxSelections',
            message: 'Max Selections must be at least 1',
            messageKey: 'validator.maxSelectionsMin',
        });
    }

    return issues;
}

function validateUniqueIds(
    question: Question,
    nodeId: string,
    _nodes: Map<string, EditorNode>
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for duplicate option values within the question
    if (question.options) {
        const optionValues = new Set<string>();
        for (let i = 0; i < question.options.length; i++) {
            const opt = question.options[i];
            if (!opt) continue;
            if (optionValues.has(opt.value)) {
                issues.push({
                    id: uuidv4(),
                    severity: 'error',
                    category: 'syntax',
                    nodeId,
                    field: `options[${i}].value`,
                    message: `Duplicate option value: '${opt.value}' — each option must have a unique value`,
                    messageKey: 'validator.duplicateOptionValue',
                    messageParams: { value: opt.value },
                });
            } else {
                optionValues.add(opt.value);
            }
        }
    }

    return issues;
}

function validateRegexPatterns(question: Question, nodeId: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const pattern = question.validation?.pattern;

    if (pattern) {
        try {
            new RegExp(pattern);
        } catch (e) {
            const error = e as Error;
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'syntax',
                nodeId,
                field: 'validation.pattern',
                message: `Invalid regex pattern — ${error.message}`,
                messageKey: 'validator.invalidRegex',
                messageParams: { error: error.message },
            });
        }
    }

    return issues;
}

// ============================================================================
// Semantic Validation
// ============================================================================

function validateSemantics(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { nodes, edges, variables } = context;

    // Build set of valid target IDs
    const validTargets = new Set<string>();
    for (const nodeId of nodes.keys()) {
        validTargets.add(nodeId);
    }
    validTargets.add('submit');
    validTargets.add('__end__');

    // Check all edge targets exist
    for (const edge of edges) {
        if (!validTargets.has(edge.target)) {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'semantic',
                nodeId: edge.source,
                message: `Routing points to a question that doesn't exist: '${edge.target}'`,
                messageKey: 'validator.invalidRoutingTarget',
                messageParams: { target: edge.target },
            });
        }
    }

    // Build set of variable IDs
    const variableIds = new Set(variables.map(v => v.id));

    // Check variable references in questions
    for (const [nodeId, node] of nodes) {
        if (node.type !== 'question' || !node.data) continue;

        const question = node.data;

        // Helper: validate a single effect, pushing all issues for missing/undefined vars
        const checkEffect = (effect: Effect, fieldPrefix: string, label: string) => {
            const isFn = effect.lhs !== undefined && effect.lhs !== null;

            // Target variable (all modes)
            if (!effect.var) {
                issues.push({
                    id: uuidv4(), severity: 'error', category: 'semantic', nodeId,
                    field: `${fieldPrefix}.var`,
                    message: `${label} effect: target variable not selected.`,
                    messageKey: 'validator.effectMissingVar',
                    messageParams: {},
                });
            } else if (!variableIds.has(effect.var)) {
                issues.push({
                    id: uuidv4(), severity: 'error', category: 'semantic', nodeId,
                    field: `${fieldPrefix}.var`,
                    message: `${label} effect uses an undefined variable: '${effect.var}'`,
                    messageKey: 'validator.undefinedVarEffect',
                    messageParams: { var: effect.var },
                });
            }

            if (isFn) {
                // Left-hand variable (function mode only)
                if (!effect.lhs) {
                    issues.push({
                        id: uuidv4(), severity: 'error', category: 'semantic', nodeId,
                        field: `${fieldPrefix}.lhs`,
                        message: `${label} effect (function mode): left variable not selected.`,
                        messageKey: 'validator.effectMissingLhs',
                        messageParams: {},
                    });
                } else if (!variableIds.has(effect.lhs)) {
                    issues.push({
                        id: uuidv4(), severity: 'error', category: 'semantic', nodeId,
                        field: `${fieldPrefix}.lhs`,
                        message: `${label} effect uses an undefined variable: '${effect.lhs}'`,
                        messageKey: 'validator.undefinedVarEffect',
                        messageParams: { var: effect.lhs },
                    });
                }

                // Right-hand variable (function mode — value must be $varName)
                const rhsVar = typeof effect.value === 'string' && effect.value.startsWith('$')
                    ? effect.value.slice(1)
                    : '';
                if (!rhsVar) {
                    issues.push({
                        id: uuidv4(), severity: 'error', category: 'semantic', nodeId,
                        field: `${fieldPrefix}.value`,
                        message: `${label} effect (function mode): right variable not selected.`,
                        messageKey: 'validator.effectMissingRhs',
                        messageParams: {},
                    });
                } else if (!variableIds.has(rhsVar)) {
                    issues.push({
                        id: uuidv4(), severity: 'error', category: 'semantic', nodeId,
                        field: `${fieldPrefix}.value`,
                        message: `${label} effect uses an undefined variable: '${rhsVar}'`,
                        messageKey: 'validator.undefinedVarEffect',
                        messageParams: { var: rhsVar },
                    });
                }
            }
        };

        // Check effects
        question.effects?.forEach((effect, i) => {
            checkEffect(effect, `effects[${i}]`, '"On Answer"');
        });

        // Check option effects
        question.options?.forEach((opt, oi) => {
            opt?.effects?.forEach((effect, ei) => {
                checkEffect(effect, `options[${oi}].effects[${ei}]`, `Option ${oi + 1}`);
            });
        });

        // Check action effects
        question.actions?.forEach((action, ai) => {
            action?.effects?.forEach((effect, ei) => {
                checkEffect(effect, `actions[${ai}].effects[${ei}]`, `Action ${ai + 1}`);
            });
        });
    }

    return issues;
}

// ============================================================================
// Graph Validation
// ============================================================================

function validateGraphStructure(context: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { nodes, edges } = context;

    // 1. Start node must exist
    if (!nodes.has('__start__')) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'graph',
            message: 'Start node is missing',
            messageKey: 'validator.startNodeMissing',
        });
        return issues; // Cannot continue without start
    }

    // 2. Start node must have exactly one outgoing edge
    const startEdges = edges.filter(e => e.source === '__start__');
    if (startEdges.length === 0) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'graph',
            nodeId: '__start__',
            message: 'Start node must have exactly one connection',
            messageKey: 'validator.startNodeOneConnection',
        });
    } else if (startEdges.length > 1) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'graph',
            nodeId: '__start__',
            message: 'Start node must have exactly one connection, has ' + startEdges.length,
            messageKey: 'validator.startNodeManyConnections',
            messageParams: { n: startEdges.length },
        });
    }

    // 3. End node must exist
    if (!nodes.has('__end__')) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'graph',
            message: 'End node is missing',
            messageKey: 'validator.endNodeMissing',
        });
    }

    // 4. Check for cycles
    const cycleNodes = detectCycles(nodes, edges);
    if (cycleNodes.length > 0) {
        for (const nodeId of cycleNodes) {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'graph',
                nodeId,
                message: 'Node is part of a cycle',
                messageKey: 'validator.nodeInCycle',
            });
        }
    }

    // 5. Check reachability
    const reachable = findReachable(nodes, edges);
    for (const [nodeId, node] of nodes) {
        if (node.type === 'question' && !reachable.has(nodeId)) {
            issues.push({
                id: uuidv4(),
                severity: 'warning',
                category: 'graph',
                nodeId,
                message: 'Node is not reachable from Start',
                messageKey: 'validator.nodeNotReachable',
            });
        }
    }

    // 6. Check path to End exists
    if (!hasPathToEnd(nodes, edges)) {
        issues.push({
            id: uuidv4(),
            severity: 'error',
            category: 'graph',
            message: 'No path from Start to Submit exists',
            messageKey: 'validator.noPathToSubmit',
        });
    }

    // 7. Every question node must have a default outgoing connection
    for (const [nodeId, node] of nodes) {
        if (node.type !== 'question') continue;

        const hasDefaultEdge = edges.some(e => e.source === nodeId && e.type === 'default');
        if (!hasDefaultEdge) {
            issues.push({
                id: uuidv4(),
                severity: 'error',
                category: 'graph',
                nodeId,
                message: 'Question has no default next connection',
                messageKey: 'validator.noDefaultNext',
            });
        }
    }

    return issues;
}

// ============================================================================
// Graph Algorithms
// ============================================================================

/**
 * Detect cycles reachable from Start using DFS.
 */
function detectCycles(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[]
): string[] {
    const WHITE = 0; // Not visited
    const GRAY = 1;  // Visiting
    const BLACK = 2; // Done

    const colors = new Map<string, number>();
    const cycleNodes: string[] = [];

    for (const nodeId of nodes.keys()) {
        colors.set(nodeId, WHITE);
    }

    function dfs(nodeId: string): boolean {
        colors.set(nodeId, GRAY);

        const outEdges = edges.filter(e => e.source === nodeId);
        for (const edge of outEdges) {
            const color = colors.get(edge.target);

            if (color === GRAY) {
                // Back edge found = cycle
                cycleNodes.push(nodeId);
                return true;
            }

            if (color === WHITE) {
                if (dfs(edge.target)) {
                    cycleNodes.push(nodeId);
                    return true;
                }
            }
        }

        colors.set(nodeId, BLACK);
        return false;
    }

    // Start DFS from __start__
    if (nodes.has('__start__')) {
        dfs('__start__');
    }

    return [...new Set(cycleNodes)]; // Unique nodes
}

/**
 * Find all nodes reachable from Start.
 */
function findReachable(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[]
): Set<string> {
    const reachable = new Set<string>();
    const stack = ['__start__'];

    while (stack.length > 0) {
        const nodeId = stack.pop()!;
        if (reachable.has(nodeId)) continue;
        reachable.add(nodeId);

        const outEdges = edges.filter(e => e.source === nodeId);
        for (const edge of outEdges) {
            if (!reachable.has(edge.target)) {
                stack.push(edge.target);
            }
        }
    }

    return reachable;
}

/**
 * Check if there's a path from Start to End.
 */
function hasPathToEnd(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[]
): boolean {
    const visited = new Set<string>();
    const stack = ['__start__'];

    while (stack.length > 0) {
        const nodeId = stack.pop()!;
        if (nodeId === '__end__') return true;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const outEdges = edges.filter(e => e.source === nodeId);
        for (const edge of outEdges) {
            stack.push(edge.target);
        }
    }

    return false;
}
