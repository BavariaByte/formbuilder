// Rete.js Editor Setup with simplified types
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { VuePlugin, Presets as VuePresets } from 'rete-vue-plugin';
import { MinimapPlugin } from 'rete-minimap-plugin';
import { AutoArrangePlugin, Presets as ArrangePresets } from 'rete-auto-arrange-plugin';
import {
    type AnyNode
} from './nodes';
import { canCreateConnection } from './connection-rules';

// ============================================================================
// Type Definitions - Use any to avoid Rete.js type complexity
// ============================================================================

export type EditorConnection = ClassicPreset.Connection<AnyNode, AnyNode>;

// Use any for context to avoid complex generic issues
export interface EditorContext {
    editor: any;
    area: any;
    connection: any;
    render: any;
    minimap: any;
    arrange: any;
}

// ============================================================================
// Editor Factory
// ============================================================================

export async function createEditor(
    container: HTMLElement
): Promise<EditorContext> {
    // Create the core editor
    const editor = new NodeEditor<any>();

    // Create plugins
    const area = new AreaPlugin<any, any>(container);
    const connection = new ConnectionPlugin<any, any>();
    const render = new VuePlugin<any, any>();
    const minimap = new MinimapPlugin<any>({ ratio: 180 / 130 });
    const arrange = new AutoArrangePlugin<any>();

    // Configure connection plugin with classic preset
    connection.addPreset(ConnectionPresets.classic.setup());

    // Configure render plugin with Vue presets
    render.addPreset(VuePresets.classic.setup() as any);
    render.addPreset(VuePresets.minimap.setup({ size: 130 }) as any);

    // Configure auto-arrange plugin
    arrange.addPreset(ArrangePresets.classic.setup() as any);

    // IMPORTANT: Register area with editor FIRST (establishes parent scope)
    editor.use(area);

    // THEN register other plugins with area (they need the parent scope)
    area.use(connection);
    area.use(render);
    area.use(minimap);
    area.use(arrange);

    // Setup area extensions - use Shift for multi-select instead of Ctrl
    let shiftPressed = false;
    document.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftPressed = true; });
    document.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftPressed = false; });

    AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
        accumulating: {
            active: () => shiftPressed
        }
    });
    AreaExtensions.simpleNodesOrder(area);

    // Setup connection validation
    editor.addPipe((context: any) => {
        if (context.type === 'connectioncreate') {
            const { data } = context;
            const sourceNode = editor.getNode(data.source);
            const targetNode = editor.getNode(data.target);

            if (sourceNode && targetNode) {
                const connections = editor.getConnections();
                const result = canCreateConnection(
                    sourceNode,
                    data.sourceOutput,
                    targetNode,
                    data.targetInput,
                    connections
                );

                if (!result.allowed) {
                    console.warn('Connection blocked:', result.reason);
                    return undefined; // Block the connection
                }
            }
        }
        return context;
    });

    return {
        editor,
        area,
        connection,
        render,
        minimap,
        arrange,
    };
}

// ============================================================================
// Editor Operations
// ============================================================================

/**
 * Add a node to the editor at a specific position.
 */
export async function addNodeToEditor(
    context: EditorContext,
    node: AnyNode,
    x: number = 0,
    y: number = 0
): Promise<void> {
    await context.editor.addNode(node);
    await context.area.translate(node.id, { x, y });
}

/**
 * Remove a node from the editor.
 */
export async function removeNodeFromEditor(
    context: EditorContext,
    nodeId: string
): Promise<void> {
    // First remove all connections
    const connections = context.editor.getConnections();
    for (const conn of connections) {
        if (conn.source === nodeId || conn.target === nodeId) {
            await context.editor.removeConnection(conn.id);
        }
    }

    // Then remove the node
    await context.editor.removeNode(nodeId);
}

/**
 * Create a connection between two nodes.
 */
export async function createConnection(
    context: EditorContext,
    sourceId: string,
    sourceOutput: string,
    targetId: string,
    targetInput: string = 'prev'
): Promise<string | null> {
    const sourceNode = context.editor.getNode(sourceId);
    const targetNode = context.editor.getNode(targetId);

    if (!sourceNode || !targetNode) {
        console.error('Source or target node not found');
        return null;
    }

    const connection = new ClassicPreset.Connection(
        sourceNode,
        sourceOutput,
        targetNode,
        targetInput
    );

    try {
        await context.editor.addConnection(connection);
        return connection.id;
    } catch (error) {
        console.error('Failed to create connection:', error);
        return null;
    }
}

/**
 * Remove a connection from the editor.
 */
export async function removeConnection(
    context: EditorContext,
    connectionId: string
): Promise<void> {
    await context.editor.removeConnection(connectionId);
}

/**
 * Auto-arrange all nodes in the editor.
 */
export async function arrangeNodes(context: EditorContext): Promise<void> {
    await context.arrange.layout();
    await AreaExtensions.zoomAt(context.area, context.editor.getNodes());
}

/**
 * Zoom to fit all nodes in view.
 */
export async function zoomToFit(context: EditorContext): Promise<void> {
    await AreaExtensions.zoomAt(context.area, context.editor.getNodes());
}

/**
 * Clear all nodes and connections from the editor.
 */
export async function clearEditor(context: EditorContext): Promise<void> {
    const connections = context.editor.getConnections();
    for (const conn of connections) {
        await context.editor.removeConnection(conn.id);
    }

    const nodes = context.editor.getNodes();
    for (const node of nodes) {
        await context.editor.removeNode(node.id);
    }
}

/**
 * Get all nodes from the editor.
 */
export function getEditorNodes(context: EditorContext): AnyNode[] {
    return context.editor.getNodes();
}

/**
 * Get all connections from the editor.
 */
export function getEditorConnections(context: EditorContext): EditorConnection[] {
    return context.editor.getConnections();
}

/**
 * Get a node by ID.
 */
export function getEditorNode(
    context: EditorContext,
    nodeId: string
): AnyNode | undefined {
    return context.editor.getNode(nodeId);
}

/**
 * Update a node's position.
 */
export async function updateNodePosition(
    context: EditorContext,
    nodeId: string,
    x: number,
    y: number
): Promise<void> {
    await context.area.translate(nodeId, { x, y });
}

/**
 * Get a node's current position.
 */
export function getNodePosition(
    context: EditorContext,
    nodeId: string
): { x: number; y: number } | null {
    const view = context.area.nodeViews.get(nodeId);
    return view ? { x: view.position.x, y: view.position.y } : null;
}

// ============================================================================
// Destroy
// ============================================================================

/**
 * Clean up the editor and all plugins.
 */
export function destroyEditor(context: EditorContext): void {
    context.area.destroy();
}
