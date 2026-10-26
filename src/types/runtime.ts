// Runtime JSON Types for the GIRP Formbuilder
// Based on the JSON specification for incident response playbooks

// ============================================================================
// Utility Types
// ============================================================================

/**
 * LocalizedString: Either a plain string or a locale-keyed map.
 * Examples:
 *   - "Hello" (plain)
 *   - { "de-DE": "Hallo", "en-US": "Hello" } (localized)
 */
export type LocalizedString = string | Record<string, string>;

// ============================================================================
// Root Playbook Definition
// ============================================================================

export interface PlaybookDefinition {
    type: 'form-definition';
    meta: MetaBlock;
    schemaId?: string;
    schemaHash?: string;
    i18n?: I18nBlock;
    form?: FormBlock;
    runtime?: RuntimeBlock;
    variables?: Variable[];
    calculation?: CalculationBlock;
    flow?: FlowBlock;
    questions: Question[];
}

// ============================================================================
// Meta Block
// ============================================================================

export interface MetaBlock {
    id: string;
    title?: LocalizedString;
    version?: string;  // User-editable playbook version, auto-incremented on export
    locale?: string;
}

// ============================================================================
// i18n Block
// ============================================================================

export interface I18nBlock {
    defaultLocale?: string;
    supported?: string[];
}

// ============================================================================
// Form Block
// ============================================================================

export interface FormBlock {
    title?: LocalizedString;
    description?: LocalizedString;
    progress?: ProgressConfig;
    completion?: CompletionConfig;
}

export interface ProgressConfig {
    mode: 'step' | 'percent';
}

export interface CompletionConfig {
    title?: LocalizedString;
    description?: LocalizedString;
}

// ============================================================================
// Runtime Block
// ============================================================================

export interface RuntimeBlock {
    session?: SessionConfig;
}

export interface SessionConfig {
    identityQuestionId?: string;
    resume?: ResumeConfig;
}

export interface ResumeConfig {
    maxAgeMinutes?: number;
}

// ============================================================================
// Variables Block
// ============================================================================

export interface Variable {
    id: string;
    initial: number;
}

// ============================================================================
// Calculation Block
// ============================================================================

export interface CalculationBlock {
    checkboxOptionOrder?: 'definition' | 'alphabetical';
    onDivZero?: 'skip' | 'error';
    rounding?: number;
    effectOrder?: 'option-action' | 'action-option';
}

// ============================================================================
// Flow Block
// ============================================================================

export interface FlowBlock {
    start?: string;
    end: 'submit';
    routingPriority?: 'options-first' | 'actions-first';
}

// ============================================================================
// Question Types
// ============================================================================

export type QuestionType =
    | 'textzeile'
    | 'textbox'
    | 'select'
    | 'checkbox'
    | 'int'
    | 'date'
    | 'info';

export interface Question {
    id: string;
    type: QuestionType;
    label?: LocalizedString;
    placeholder?: LocalizedString;
    description?: LocalizedString;
    required?: boolean;
    validation?: ValidationConfig;
    defaultNext?: string;
    actions?: RoutingRule[];
    effects?: Effect[];
    image?: string | ImageConfig;
    system?: SystemConfig;
    isIdentity?: boolean;
    // Type-specific fields
    options?: Option[];           // select, checkbox
}

// ============================================================================
// Option (for select/checkbox)
// ============================================================================

export interface Option {
    id: string;
    value: string;
    label: LocalizedString;
    description?: LocalizedString;
    exclusive?: boolean;          // checkbox only
    effects?: Effect[];
    next?: string;
}

// ============================================================================
// Validation Config
// ============================================================================

export interface ValidationConfig {
    // Text validation
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    // Number validation
    min?: number | string;  // string for date tokens like "now", "today"
    max?: number | string;
    // Checkbox validation
    maxSelections?: number;
}

// ============================================================================
// Routing
// ============================================================================

export interface RoutingRule {
    when: Condition;
    /**
     * Navigation target. When absent the rule runs its effects only
     * and does not change the navigation path (effect-only mode).
     */
    goto?: string;
    effects?: Effect[];
}

// ============================================================================
// Effects
// ============================================================================

export type EffectOperator = 'add' | 'sub' | 'mul' | 'div' | 'set';

export interface Effect {
    var: string;
    op: EffectOperator;
    value: number | string;  // string with '$' prefix = variable reference (e.g. "$varName")
    lhs?: string;            // when set: function mode — var = lhs op value (e.g. "score")
    if?: Condition;
}

// ============================================================================
// Image Configuration
// ============================================================================

export interface ImageConfig {
    src?: LocalizedString;
    url?: LocalizedString;
    alt?: LocalizedString;
    caption?: LocalizedString;
    placement?: 'before' | 'after';
    width?: number;
    height?: number;
    maxHeight?: number;
    fit?: string;
}

// ============================================================================
// System Configuration
// ============================================================================

export interface SystemConfig {
    isIdentity?: boolean;
}

// ============================================================================
// Condition System
// ============================================================================

export type Condition = CombinatorCondition | LeafCondition;

export interface CombinatorCondition {
    anyOf?: Condition[];
    allOf?: Condition[];
    not?: Condition;
}

export interface LeafCondition {
    // Target
    questionId?: string;
    var?: string;
    // Checks (exactly one should be present)
    notEmpty?: boolean;
    isEmpty?: boolean;
    equals?: string | number | boolean;
    contains?: string;
    containsAny?: string[];
    containsAll?: string[];
    gt?: number;
    gte?: number;
    lt?: number;
    lte?: number;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isCombinatorCondition(cond: Condition): cond is CombinatorCondition {
    return 'anyOf' in cond || 'allOf' in cond || 'not' in cond;
}

export function isLeafCondition(cond: Condition): cond is LeafCondition {
    return !isCombinatorCondition(cond);
}

export function isLocalizedMap(value: LocalizedString): value is Record<string, string> {
    return typeof value === 'object' && value !== null;
}

// ============================================================================
// Constants
// ============================================================================

export const SUBMIT_SENTINEL = 'submit' as const;
export const START_NODE_ID = '__start__' as const;
export const END_NODE_ID = '__end__' as const;
