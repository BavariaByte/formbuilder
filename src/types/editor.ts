// Editor State Types
// Internal types for the visual editor, not persisted to JSON

import type { Question, QuestionType } from './runtime';

// ============================================================================
// Editor Node Types
// ============================================================================

export type EditorNodeType = 'start' | 'end' | 'question';

export interface EditorNode {
    id: string;
    type: EditorNodeType;
    questionType?: QuestionType;
    data: Question | null;  // null for start/end nodes
    position: Position;     // transient, calculated by auto-layout
}

export interface Position {
    x: number;
    y: number;
}

// ============================================================================
// Editor Edge Types
// ============================================================================

export type EdgeType = 'default' | 'routing' | 'option';

export interface EditorEdge {
    id: string;
    source: string;
    sourcePort: string;
    target: string;
    targetPort: string;
    type: EdgeType;
    routingIndex?: number;    // for routing edges, index in routing[]
    optionId?: string;        // for option edges, the option ID
}

// ============================================================================
// Editor State
// ============================================================================

export interface EditorState {
    // Graph data
    nodes: Map<string, EditorNode>;
    edges: EditorEdge[];

    // Selection
    selectedNodeIds: Set<string>;
    selectedEdgeIds: Set<string>;

    // Clipboard
    clipboard: EditorNode[];

    // UI state (transient)
    currentLocale: string;
    zoom: number;
    pan: Position;

    // Search/filter (transient)
    searchQuery: string;
    filterType: QuestionType | 'all';
}

// ============================================================================
// Validation Types
// ============================================================================

export type IssueCategory = 'syntax' | 'semantic' | 'graph';
export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
    id: string;
    severity: IssueSeverity;
    category: IssueCategory;
    nodeId?: string;        // for node-specific issues
    panel?: string;         // for global panel issues
    field?: string;         // specific field name
    message: string;        // English fallback
    messageKey?: string;    // i18n translation key
    messageParams?: Record<string, string | number>;
}

export interface ValidationResult {
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    isValid: boolean;         // true if no errors
    canExport: boolean;       // true if no errors (warnings are ok)
}

// ============================================================================
// Import/Export Types
// ============================================================================

export interface ImportResult {
    success: boolean;
    state?: EditorState;
    warnings: ImportWarning[];
    errors: string[];
}

export interface ImportWarning {
    type: 'visibleIf' | 'unknown_field' | 'deprecated';
    questionId?: string;
    message: string;
}

export interface ExportOptions {
    includeUnreachable?: boolean;  // default false
    prettyPrint?: boolean;         // default true
}

// ============================================================================
// UI State Types
// ============================================================================

export interface InspectorState {
    selectedNodeId: string | null;
    expandedSections: Set<string>;
}

export interface GlobalPanelState {
    activePanel: GlobalPanelType;
}

export type GlobalPanelType =
    | 'meta'
    | 'i18n'
    | 'form'
    | 'runtime'
    | 'variables'
    | 'calculation'
    | 'flow';

// ============================================================================
// Action Types (for undo/redo, if implemented)
// ============================================================================

export type EditorAction =
    | { type: 'ADD_NODE'; node: EditorNode }
    | { type: 'DELETE_NODE'; nodeId: string }
    | { type: 'UPDATE_NODE'; nodeId: string; data: Partial<Question> }
    | { type: 'ADD_EDGE'; edge: EditorEdge }
    | { type: 'DELETE_EDGE'; edgeId: string }
    | { type: 'BATCH'; actions: EditorAction[] };

// ============================================================================
// Copy/Paste Types
// ============================================================================

export interface ClipboardData {
    nodes: EditorNode[];
    edges: EditorEdge[];
    timestamp: number;
}

// ============================================================================
// Layout Types
// ============================================================================

export interface LayoutConfig {
    direction: 'TB' | 'LR';   // Top-to-Bottom or Left-to-Right
    nodeWidth: number;
    nodeHeight: number;
    nodeSep: number;          // horizontal separation
    rankSep: number;          // vertical separation
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    direction: 'TB',
    nodeWidth: 280,
    nodeHeight: 120,
    nodeSep: 80,
    rankSep: 120,
};
