// Rete.js Socket Definitions
import { ClassicPreset } from 'rete';

/**
 * FlowSocket: Used for main flow connections between nodes.
 * - Start → Question
 * - Question → Question
 * - Question → End
 */
export const FlowSocket = new ClassicPreset.Socket('Flow');

/**
 * OptionSocket: Used for option-specific connections.
 * - Option output → Question/End
 */
export const OptionSocket = new ClassicPreset.Socket('Option');

/**
 * InfoSocket: Used for display-only outputs (no connections allowed).
 * - Description preview
 * - Options without custom routing
 */
export const InfoSocket = new ClassicPreset.Socket('Info');

// Socket color mappings for visualization
export const SOCKET_COLORS = {
    flow: '#21adf3',      // CI sky
    option: '#2f9e8c',    // CI teal
    info: '#6b6b70',      // CI grey (display only)
} as const;

