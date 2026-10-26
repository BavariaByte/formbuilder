// Rete.js Node Definitions
import { ClassicPreset } from 'rete';
import { FlowSocket, OptionSocket, InfoSocket } from './sockets';
import type { Question, QuestionType, LocalizedString } from '@/types/runtime';

// ============================================================================
// Helper to resolve localized string
// ============================================================================

function resolveLabel(label: LocalizedString | undefined, fallback: string, locale?: string): string {
    if (!label) return fallback;
    if (typeof label === 'string') {
        return label.trim() || fallback; // Empty string → use fallback
    }
    // It's a locale map
    if (locale) {
        // Strict mode: Return content for this locale OR fallback. Do NOT search other locales.
        return (label[locale]?.trim()) || fallback;
    }
    // Logic for when no locale is passed (e.g. export or internal checks) - fallback to first available
    const values = Object.values(label).filter((v): v is string => Boolean(v && v.trim()));
    return values.length > 0 ? (values[0] || fallback) : fallback;
}

// ============================================================================
// Base Node Class with common functionality
// ============================================================================

export class BaseNode extends ClassicPreset.Node {
    width = 320; // Wider node for better content fit
    height = 120; // Initial height, will be overridden by CSS auto-height
}

// ============================================================================
// Start Node - Entry point of the flow
// ============================================================================

export class StartNode extends BaseNode {
    constructor() {
        super('Start');
        this.addOutput('next', new ClassicPreset.Output(FlowSocket, 'Next'));
    }
}

// ============================================================================
// End Node - Submit/termination point
// ============================================================================

export class EndNode extends BaseNode {
    constructor() {
        super('Submit');
        this.addInput('prev', new ClassicPreset.Input(FlowSocket, '', true)); // No label
    }
}

// ============================================================================
// Question Node - Main content node
// ============================================================================

export class QuestionNode extends BaseNode {
    questionId: string;
    questionType: QuestionType;
    questionData: Question;

    constructor(question: Question) {
        // Use resolved label, not raw object
        const displayLabel = resolveLabel(question.label, question.id);
        super(displayLabel);

        this.questionId = question.id;
        this.questionType = question.type;
        this.questionData = question;

        // Input: can receive flow from multiple sources (no label, just socket)
        this.addInput('prev', new ClassicPreset.Input(FlowSocket, '', true));

        // Description preview as first output (if exists) — CSS clamps to 3 lines
        const desc = resolveLabel(question.description, '');
        if (desc) {
            this.addOutput('__desc__', new ClassicPreset.Output(InfoSocket, desc));
        }

        // Default output: always present (Next)
        this.addOutput('default', new ClassicPreset.Output(FlowSocket, 'Next'));

        // ALL Options as outputs - with or without routing sockets
        if (question.options && question.options.length > 0) {
            question.options.forEach(opt => {
                const optLabel = resolveLabel(opt.label, opt.value);
                if (opt.next) {
                    // Custom routing: connectable OptionSocket
                    this.addOutput(
                        `option_${opt.id}`,
                        new ClassicPreset.Output(OptionSocket, `→ ${optLabel}`)
                    );
                } else {
                    // No routing: display-only InfoSocket
                    this.addOutput(
                        `info_${opt.id}`,
                        new ClassicPreset.Output(InfoSocket, `• ${optLabel}`)
                    );
                }
            });
        }

        // Routing outputs: only for rules that have a goto target (not effect-only)
        question.actions?.forEach((rule, index) => {
            if (rule.goto !== undefined) {
                this.addOutput(
                    `routing_${index}`,
                    new ClassicPreset.Output(FlowSocket, `Rule ${index + 1}`)
                );
            }
        });

        // Calculate height based on options + description (desc = 3 lines ≈ 54px)
        const descHeight = desc ? 54 : 0;
        const optionsCount = question.options?.length || 0;
        const routingCount = question.actions?.filter(r => r.goto !== undefined).length || 0;
        this.height = Math.max(120, 70 + descHeight + (optionsCount + routingCount + 1) * 26);
    }

    private getOutputCount(): number {
        let count = 1; // default output
        count += this.questionData.actions?.filter(r => r.goto !== undefined).length || 0;
        count += this.questionData.options?.filter(o => o.next).length || 0;
        return count;
    }

    private currentDescPreview = ''; // Track current description to avoid unnecessary re-renders

    /**
     * Update the node when question data changes.
     * Returns true if outputs changed (requiring reconnection).
     */
    updateFromQuestion(question: Question, locale?: string): boolean {
        const oldOutputKeys = new Set(Object.keys(this.outputs));

        // Update label with resolved value
        this.label = resolveLabel(question.label, question.id, locale);
        this.questionData = question;

        // Get description — CSS clamps to 3 lines, no JS truncation needed
        const desc = resolveLabel(question.description, '', locale);
        const newDescPreview = desc;

        // Clear ALL outputs to ensure correct order
        // Order matters for CSS flex order to work correctly
        for (const key of Object.keys(this.outputs)) {
            this.removeOutput(key);
        }

        // Re-add outputs in correct order:
        // 1. Description Preview (first, will use CSS order:-1 to stay at top)
        if (newDescPreview) {
            this.addOutput('__desc__', new ClassicPreset.Output(InfoSocket, newDescPreview));
        }
        this.currentDescPreview = newDescPreview;

        // 2. Default "Next" Output
        this.addOutput('default', new ClassicPreset.Output(FlowSocket, 'Next'));

        // 3. Options (Info or Custom Routing)
        if (question.options && question.options.length > 0) {
            question.options.forEach(opt => {
                const optLabel = resolveLabel(opt.label, opt.value, locale);
                if (opt.next) {
                    // Custom routing: connectable OptionSocket
                    this.addOutput(
                        `option_${opt.id}`,
                        new ClassicPreset.Output(OptionSocket, `→ ${optLabel}`)
                    );
                } else {
                    // No routing: display-only InfoSocket
                    this.addOutput(
                        `info_${opt.id}`,
                        new ClassicPreset.Output(InfoSocket, `• ${optLabel}`)
                    );
                }
            });
        }

        // 4. Routing Rules – only those with a goto target
        question.actions?.forEach((rule, index) => {
            if (rule.goto !== undefined) {
                this.addOutput(
                    `routing_${index}`,
                    new ClassicPreset.Output(FlowSocket, `Rule ${index + 1}`)
                );
            }
        });

        // Check if outputs changed
        const newOutputKeys = new Set(Object.keys(this.outputs));
        return !setsEqual(oldOutputKeys, newOutputKeys);
    }

    /**
     * Update node label for a specific locale (without changing outputs).
     * Used when switching display locale.
     */
    updateLabelForLocale(locale: string): void {
        this.label = resolveLabel(this.questionData.label, this.questionData.id, locale);
    }
}

// ============================================================================
// Node Factory
// ============================================================================

export type AnyNode = StartNode | EndNode | QuestionNode;

export function createNode(type: 'start'): StartNode;
export function createNode(type: 'end'): EndNode;
export function createNode(type: 'question', question: Question): QuestionNode;
export function createNode(type: string, question?: Question): AnyNode {
    switch (type) {
        case 'start':
            return new StartNode();
        case 'end':
            return new EndNode();
        case 'question':
            if (!question) throw new Error('Question data required for question node');
            return new QuestionNode(question);
        default:
            throw new Error(`Unknown node type: ${type}`);
    }
}

// ============================================================================
// Node Type Guards
// ============================================================================

export function isStartNode(node: AnyNode): node is StartNode {
    return node instanceof StartNode;
}

export function isEndNode(node: AnyNode): node is EndNode {
    return node instanceof EndNode;
}

export function isQuestionNode(node: AnyNode): node is QuestionNode {
    return node instanceof QuestionNode;
}

// ============================================================================
// Helper Functions
// ============================================================================

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

// Node dimension constants
export const NODE_DIMENSIONS = {
    start: { width: 180, height: 60 },
    end: { width: 180, height: 60 },
    question: { width: 280, height: 120 },
} as const;

// Question type display names
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
    textzeile: 'Text (Single Line)',
    textbox: 'Text (Multi Line)',
    select: 'Dropdown',
    checkbox: 'Checkbox',
    int: 'Number',
    date: 'Date',
    info: 'Info',
};

// Question type icons
export const QUESTION_TYPE_ICONS: Record<QuestionType, string> = {
    textzeile: 'Type',
    textbox: 'AlignLeft',
    select: 'List',
    checkbox: 'CheckSquare',
    int: 'Hash',
    date: 'Calendar',
    info: 'Info',
};
