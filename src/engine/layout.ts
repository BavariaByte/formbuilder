// Auto Layout Engine using ELK.js
import ELK from 'elkjs/lib/elk.bundled.js';
import type { EditorNode, EditorEdge, Position, LayoutConfig } from '@/types/editor';

// ============================================================================
// ELK Layout Engine
// ============================================================================

const elk = new ELK();

export interface LayoutResult {
    positions: Map<string, Position>;
    width: number;
    height: number;
}

/**
 * Calculate positions for all nodes using ELK.js.
 * Returns a map of node IDs to positions.
 */
export async function calculateLayout(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[],
    config: Partial<LayoutConfig> = {}
): Promise<LayoutResult> {
    const cfg: LayoutConfig = {
        direction: config.direction || 'TB',
        nodeWidth: config.nodeWidth || 280,
        nodeHeight: config.nodeHeight || 120,
        nodeSep: config.nodeSep || 80,
        rankSep: config.rankSep || 120,
    };

    // Build ELK graph
    const elkGraph = buildElkGraph(nodes, edges, cfg);

    // Run layout
    const layoutedGraph = await elk.layout(elkGraph);

    // Extract positions
    const positions = new Map<string, Position>();
    let maxX = 0;
    let maxY = 0;

    for (const node of layoutedGraph.children || []) {
        const x = node.x || 0;
        const y = node.y || 0;
        positions.set(node.id, { x, y });

        maxX = Math.max(maxX, x + (node.width || cfg.nodeWidth));
        maxY = Math.max(maxY, y + (node.height || cfg.nodeHeight));
    }

    return {
        positions,
        width: maxX + cfg.nodeSep,
        height: maxY + cfg.rankSep,
    };
}

/**
 * Build ELK graph structure from editor nodes and edges.
 */
function buildElkGraph(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[],
    config: LayoutConfig
): any {
    const elkNodes: any[] = [];
    const elkEdges: any[] = [];

    // Add nodes
    for (const [nodeId, node] of nodes) {
        const width = node.type === 'question' ? config.nodeWidth : 180;
        const height = node.type === 'question'
            ? getQuestionNodeHeight(node)
            : 60;

        elkNodes.push({
            id: nodeId,
            width,
            height,
        });
    }

    // Add edges
    for (const edge of edges) {
        // Only add edges where both source and target exist
        if (nodes.has(edge.source) && nodes.has(edge.target)) {
            elkEdges.push({
                id: edge.id,
                sources: [edge.source],
                targets: [edge.target],
            });
        }
    }

    return {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': config.direction === 'TB' ? 'DOWN' : 'RIGHT',
            'elk.spacing.nodeNode': String(config.nodeSep),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(config.rankSep),
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        },
        children: elkNodes,
        edges: elkEdges,
    };
}

/**
 * Calculate node height based on outputs.
 */
function getQuestionNodeHeight(node: EditorNode): number {
    if (!node.data) return 120;

    let outputCount = 1; // default output
    outputCount += node.data.actions?.length || 0;
    outputCount += node.data.options?.filter(o => o.next).length || 0;

    return Math.max(120, 80 + outputCount * 24);
}

// ============================================================================
// Simple Fallback Layout (no external dependencies)
// ============================================================================

/**
 * Simple grid-based layout as fallback.
 */
export function calculateSimpleLayout(
    nodes: Map<string, EditorNode>,
    edges: EditorEdge[]
): Map<string, Position> {
    const positions = new Map<string, Position>();
    const visited = new Set<string>();
    const levels = new Map<string, number>();

    // BFS to assign levels
    const queue: Array<{ id: string; level: number }> = [{ id: '__start__', level: 0 }];

    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        levels.set(id, level);

        const outEdges = edges.filter(e => e.source === id);
        for (const edge of outEdges) {
            if (!visited.has(edge.target)) {
                queue.push({ id: edge.target, level: level + 1 });
            }
        }
    }

    // Assign positions based on levels
    const levelNodes = new Map<number, string[]>();
    for (const [nodeId, level] of levels) {
        const existing = levelNodes.get(level) || [];
        existing.push(nodeId);
        levelNodes.set(level, existing);
    }

    // Add unvisited nodes to last level
    let maxLevel = Math.max(...levels.values(), 0);
    for (const nodeId of nodes.keys()) {
        if (!visited.has(nodeId)) {
            maxLevel++;
            const existing = levelNodes.get(maxLevel) || [];
            existing.push(nodeId);
            levelNodes.set(maxLevel, existing);
        }
    }

    // Calculate positions
    const nodeWidth = 280;
    const nodeHeight = 120;
    const horizontalGap = 100;
    const verticalGap = 150;

    for (const [level, nodeIds] of levelNodes) {
        const levelWidth = nodeIds.length * (nodeWidth + horizontalGap) - horizontalGap;
        let x = -levelWidth / 2;

        for (const nodeId of nodeIds) {
            positions.set(nodeId, {
                x,
                y: level * (nodeHeight + verticalGap),
            });
            x += nodeWidth + horizontalGap;
        }
    }

    return positions;
}
