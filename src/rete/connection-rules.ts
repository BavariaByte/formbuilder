// Connection Rules for Rete.js
import type { AnyNode } from './nodes';
import { StartNode, EndNode, QuestionNode } from './nodes';

interface ConnectionLike {
    source: string;
    target: string;
    sourceOutput?: string;
}

/**
 * Validate if a connection can be created between two nodes.
 */
export function canCreateConnection(
    source: AnyNode,
    sourceKey: string,
    target: AnyNode,
    _targetKey: string,
    _existingConnections: ConnectionLike[]
): { allowed: boolean; reason?: string } {
    const sourceId = source.id;
    const targetId = target.id;

    // Rule 1: Start node check is handled by editor replacement logic
    if (source instanceof StartNode) {
        // We allow the connection here so that the editor can handle removing the old one
        // and replacing it with the new one.
        // The cleanup logic is in EditorCanvas.vue
    }

    // Rule 2: End node cannot have outgoing connections
    if (source instanceof EndNode) {
        return { allowed: false, reason: 'End node cannot have outgoing connections' };
    }

    // Rule 3: Cannot connect to Start node
    if (target instanceof StartNode) {
        return { allowed: false, reason: 'Cannot connect to Start node' };
    }

    // Rule 4: No self-loops
    if (sourceId === targetId) {
        return { allowed: false, reason: 'Self-loops are not allowed' };
    }

    // Additional: For question nodes, check output key validity
    if (source instanceof QuestionNode) {
        const validOutputKeys = ['default', ...Object.keys(source.outputs || {})];
        if (!validOutputKeys.includes(sourceKey)) {
            return { allowed: false, reason: `Invalid output key: ${sourceKey}` };
        }
    }

    return { allowed: true };
}

/**
 * Check if a connection already exists.
 */
export function connectionExists(
    sourceId: string,
    sourceKey: string,
    targetId: string,
    connections: ConnectionLike[]
): boolean {
    return connections.some(
        conn => conn.source === sourceId && conn.sourceOutput === sourceKey && conn.target === targetId
    );
}

/**
 * Get the maximum connections from a source port.
 */
export function getMaxConnectionsFromPort(node: AnyNode, _portKey: string): number {
    if (node instanceof StartNode) return 1;
    if (node instanceof QuestionNode) return 1;
    if (node instanceof EndNode) return 0;
    return Infinity;
}

/**
 * Get the maximum connections to a target port.
 */
export function getMaxConnectionsToPort(node: AnyNode, _portKey: string): number {
    if (node instanceof StartNode) return 0;
    return Infinity;
}

/**
 * Determine edge type based on source port.
 */
export function getEdgeTypeFromPort(sourcePort: string): 'default' | 'routing' | 'option' {
    if (sourcePort === 'default' || sourcePort === 'next') return 'default';
    if (sourcePort.startsWith('routing_')) return 'routing';
    if (sourcePort.startsWith('option_')) return 'option';
    return 'default';
}

/**
 * Extract routing index from port key.
 */
export function getRoutingIndexFromPort(portKey: string): number | null {
    const match = portKey.match(/^routing_(\d+)$/);
    return match && match[1] ? parseInt(match[1], 10) : null;
}

/**
 * Extract option ID from port key.
 */
export function getOptionIdFromPort(portKey: string): string | null {
    const match = portKey.match(/^option_(.+)$/);
    return match && match[1] ? match[1] : null;
}
