<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, provide, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useGraphStore, useEditorStore, useValidationStore } from '@/store';
import {
  createEditor,
  addNodeToEditor,
  zoomToFit,
  destroyEditor,
  type EditorContext,
} from '@/rete/setup';
import { createNode, QuestionNode, StartNode, EndNode } from '@/rete/nodes';
import { ClassicPreset } from 'rete';
import { Trash2, Copy } from 'lucide-vue-next';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();

// Stores
const graphStore = useGraphStore();
const editorStore = useEditorStore();
const validationStore = useValidationStore();
const { nodes, edges, importVersion, isImporting } = storeToRefs(graphStore);
const { currentLocale } = storeToRefs(editorStore);
const { issuesByNode } = storeToRefs(validationStore);

// Refs
const containerRef = ref<HTMLElement | null>(null);
const editorContext = shallowRef<EditorContext | null>(null);
const isInitialized = ref(false);
const nodePositions = ref<Map<string, { x: number; y: number }>>(new Map());
const isRebuilding = ref(false);

// Flag to prevent circular sync
let isSyncingToRete = false;

// Tracks the last right-clicked node/connection ID.
// Set by direct DOM listeners on NodeView/ConnectionView elements (synchronous,
// bubble phase) so the value is always ready when handleContextMenu fires.
let lastContextMenuNodeId: string | null = null;
let lastContextMenuConnectionId: string | null = null;

// Attach a synchronous contextmenu listener directly to the NodeView wrapper element.
// This is the only reliable approach: Rete's emit() is async internally, so pipe-based
// detection always fires AFTER handleContextMenu. Direct DOM listeners fire synchronously
// during bubble phase (NodeView.element is nested, so it fires before the container).
function attachNodeContextMenuListener(nodeId: string) {
  if (!editorContext.value) return;
  const nodeViews = editorContext.value.area.nodeViews as Map<string, any>;
  const view = nodeViews.get(nodeId);
  if (!view?.element) return;
  view.element.addEventListener('contextmenu', () => {
    lastContextMenuNodeId = nodeId;
    lastContextMenuConnectionId = null;
  });
}

// Same approach for connection views.
function attachConnectionContextMenuListener(connectionId: string) {
  if (!editorContext.value) return;
  const connViews = editorContext.value.area.connectionViews as Map<string, any>;
  const view = connViews.get(connectionId);
  if (!view?.element) return;
  view.element.addEventListener('contextmenu', () => {
    lastContextMenuConnectionId = connectionId;
    lastContextMenuNodeId = null;
  });
}

// Note: isImporting is now from the store (set by ImportModal before adding nodes)

// Update background dots position to follow pan/zoom
function updateBackgroundPosition() {
  if (!containerRef.value || !editorContext.value) return;
  
  const { k, x, y } = editorContext.value.area.area.transform;
  const size = 24 * k; // Scale the dot spacing with zoom
  
  containerRef.value.style.backgroundSize = `${size}px ${size}px`;
  containerRef.value.style.backgroundPosition = `${x}px ${y}px`;
}

// Context menu state - supports both nodes and connections
const contextMenu = ref<{ show: boolean; x: number; y: number; nodeId: string | null; connectionId: string | null }>({
  show: false, x: 0, y: 0, nodeId: null, connectionId: null
});

// Provide editor context for zoom controls
provide('editorContext', editorContext);

// Initialize Rete editor
onMounted(async () => {
  if (!containerRef.value) return;

  try {
    editorContext.value = await createEditor(containerRef.value);

    // Node selection handler
    editorContext.value.area.addPipe((context: any) => {
      if (context.type === 'nodepicked') {
        editorStore.selectNode(context.data.id);
      }
      // Track node position changes
      if (context.type === 'nodetranslated') {
        const { id, position } = context.data;
        nodePositions.value.set(id, { x: position.x, y: position.y });
        graphStore.updateNodePosition(id, { x: position.x, y: position.y });
      }
      // Clamp zoom: block scroll/pinch zoom above 150%
      if (context.type === 'zoom' && context.data.zoom > 1.5) return;
      // Sync background dots with pan/zoom and update store zoom level
      if (context.type === 'zoomed' || context.type === 'translated') {
        updateBackgroundPosition();
        // Sync actual zoom to store for toolbar display
        if (context.type === 'zoomed' && editorContext.value) {
          editorStore.setZoom(editorContext.value.area.area.transform.k);
        }
      }
      return context;
    });

    // Connection sync handlers - sync Rete.js connections to store
    editorContext.value.editor.addPipe((context: any) => {
      // Skip if we're syncing TO Rete.js (from store)
      if (isSyncingToRete) return context;
      
      if (context.type === 'connectioncreated') {
        const conn = context.data;

        // Determine edge type from sourceOutput name
        const sourceOutput = conn.sourceOutput || 'next';
        let edgeType: 'default' | 'option' | 'routing' = 'default';
        let optionId: string | undefined;
        let routingIndex: number | undefined;
        
        if (sourceOutput.startsWith('option_')) {
          edgeType = 'option';
          optionId = sourceOutput.replace('option_', '');
        } else if (sourceOutput.startsWith('routing_')) {
          edgeType = 'routing';
          routingIndex = parseInt(sourceOutput.replace('routing_', ''), 10);
        }
        
        // First add the new edge to store (store will handle removing old edge)
        const edge = graphStore.createEdge(
          conn.source,
          sourceOutput,
          conn.target,
          conn.targetInput || 'prev',
          edgeType
        );
        
        // Add metadata for option/routing edges
        if (optionId) edge.optionId = optionId;
        if (routingIndex !== undefined) edge.routingIndex = routingIndex;
        
        graphStore.addEdge(edge);

        // Attach contextmenu listener and remove duplicate connections after Rete settles
        setTimeout(() => {
          attachConnectionContextMenuListener(conn.id);
          if (editorContext.value) {
            const editor = editorContext.value.editor;
            const allConnections = Array.from(editor.getConnections());
            const connectionsToRemove = allConnections.filter(
              (c: any) => c.source === conn.source &&
                          c.sourceOutput === sourceOutput &&
                          c.id !== conn.id
            ) as { id: string }[];
            connectionsToRemove.forEach(c => editor.removeConnection(c.id));
          }
        }, 10);
      }
      if (context.type === 'connectionremoved') {
        const conn = context.data;
        const sourceOutput = conn.sourceOutput;
        const edgeToRemove = graphStore.edges.find(
          e => e.source === conn.source &&
               e.target === conn.target &&
               (!sourceOutput || e.sourcePort === sourceOutput)
        );
        if (edgeToRemove) {
          graphStore.removeEdge(edgeToRemove.id);
        }
      }
      return context;
    });

    isInitialized.value = true;
    editorStore.setReteEditor(editorContext.value.editor);
    await initialSync();
    // Initialize tracking after initial sync
    previousNodeIds = new Set(nodes.value.keys());
    isWatchInitialized = true;
    nextTick(updateErrorHighlights);
  } catch (error) {
    console.error('Failed to initialize editor:', error);
  }
});

onUnmounted(() => {
  if (editorContext.value) {
    destroyEditor(editorContext.value);
  }
});

// Context menu handler
function handleContextMenu(e: MouseEvent) {
  e.preventDefault();

  const nodeId = lastContextMenuNodeId;
  const connectionId = lastContextMenuConnectionId;
  lastContextMenuNodeId = null;
  lastContextMenuConnectionId = null;

  if (nodeId === '__start__' || nodeId === '__end__') {
    contextMenu.value = { show: false, x: 0, y: 0, nodeId: null, connectionId: null };
    return;
  }

  if (nodeId) {
    contextMenu.value = { show: true, x: e.clientX, y: e.clientY, nodeId, connectionId: null };
    editorStore.selectNode(nodeId);
    return;
  }

  if (connectionId) {
    contextMenu.value = { show: true, x: e.clientX, y: e.clientY, nodeId: null, connectionId };
    return;
  }

  contextMenu.value = { show: false, x: 0, y: 0, nodeId: null, connectionId: null };
}

function closeContextMenu() {
  contextMenu.value.show = false;
}

async function deleteNode() {
  const nodeId = contextMenu.value.nodeId;
  closeContextMenu();
  if (nodeId && nodeId !== '__start__' && nodeId !== '__end__') {
    // Remove from Rete editor directly first (bypasses async watcher timing issues after import)
    if (editorContext.value) {
      const existingNode = editorContext.value.editor.getNode(nodeId);
      if (existingNode) {
        const conns = editorContext.value.editor.getConnections();
        for (const conn of conns) {
          if (conn.source === nodeId || conn.target === nodeId) {
            await editorContext.value.editor.removeConnection(conn.id);
          }
        }
        await editorContext.value.editor.removeNode(nodeId);
      }
    }
    // Remove from store (the nodeCount watcher will fire but getNode returns undefined → no-op)
    graphStore.removeNode(nodeId);
  }
}

async function duplicateNode() {
  const nodeId = contextMenu.value.nodeId;
  closeContextMenu();
  if (!nodeId || nodeId === '__start__' || nodeId === '__end__') return;
  const newNode = graphStore.duplicateNode(nodeId);
  if (newNode && editorContext.value) {
    nodePositions.value.set(newNode.id, newNode.position);
    await addSingleNode(newNode.id, newNode);
  }
}

async function deleteConnection() {
  if (contextMenu.value.connectionId && editorContext.value) {
    // Remove from Rete editor
    await editorContext.value.editor.removeConnection(contextMenu.value.connectionId);
    
    // Also remove from store (find by matching source/target)
    const reteConn = editorContext.value.editor.getConnections().find((c: { id: string }) => c.id === contextMenu.value.connectionId);
    if (reteConn) {
      const storeEdge = edges.value.find(e => e.source === reteConn.source && e.target === reteConn.target);
      if (storeEdge) {
        graphStore.removeEdge(storeEdge.id);
      }
    }
  }
  closeContextMenu();
}

// Initial sync (runs once on mount)
async function initialSync() {
  if (!editorContext.value || !isInitialized.value) return;

  // Add all nodes
  for (const [nodeId, node] of nodes.value) {
    await addSingleNode(nodeId, node);
  }

  // Add connections
  await syncConnections();

  // Apply horizontal auto-layout for initial positioning
  await applyHorizontalLayout();
  
  // Zoom to fit all nodes
  await zoomToFit(editorContext.value);
  
  // Sync actual zoom level to store so toolbar shows true percentage
  editorStore.setZoom(editorContext.value.area.area.transform.k);
  updateBackgroundPosition();

  // Update node classes for styling
  updateNodeClasses();
}

function updateNodeClasses() {
  if (!editorContext.value) return;
  
  for (const [id, view] of editorContext.value.area.nodeViews) {
    const node = editorContext.value.editor.getNode(id);
    if (!node || !(view as any).element) continue;
    
    const el = (view as any).element as HTMLElement;
    // Remove existing type classes to be safe
    el.classList.remove('node-start', 'node-end');
    
    // Check node type
    if (node instanceof StartNode || node.label === 'Start') {
       el.classList.add('node-start');
    } else if (node instanceof EndNode || node.label === 'Submit') {
       el.classList.add('node-end');
    }
  }
}

// Add a single node to editor
async function addSingleNode(nodeId: string, node: any) {
  if (!editorContext.value) return;
  
  // Skip if node already exists in editor
  const existingNode = editorContext.value.editor.getNode(nodeId);
  if (existingNode) return;

  let reteNode;
  if (node.type === 'start') {
    reteNode = createNode('start');
  } else if (node.type === 'end') {
    reteNode = createNode('end');
  } else if (node.data) {
    reteNode = createNode('question', node.data);
  } else {
    return;
  }

  (reteNode as any).id = nodeId;

  // Use saved position or default
  const savedPos = nodePositions.value.get(nodeId);
  const x = savedPos?.x ?? 0;
  const y = savedPos?.y ?? 0;

  await addNodeToEditor(editorContext.value, reteNode, x, y);

  // Attach direct synchronous DOM listener for right-click detection.
  // Must be done after await addNodeToEditor so the NodeView element exists.
  attachNodeContextMenuListener(nodeId);
}

// Get actual node height from Rete.js node or calculate based on type
function getNodeHeight(nodeId: string): number {
  if (nodeId === '__start__' || nodeId === '__end__') {
    return 60;
  }

  const node = nodes.value.get(nodeId);
  if (!node || !node.data) return 120;
  
  const data = node.data;
  let height = 100; // Base height (Header + Spacing)

  // Description height
  let desc = '';
  if (typeof data.description === 'string') {
    desc = data.description;
  } else if (data.description) {
    // Strict: only current locale
    desc = data.description[currentLocale.value] || '';
  }

  if (desc) {
    // Approx 35 chars per line for 320px width
    const lines = Math.ceil(desc.length / 35); 
    height += lines * 20; // 20px per line
  }

  // Options height
  if (data.options && data.options.length > 0) {
    height += data.options.length * 36; // 36px per option
  } else {
    // Input field height for non-option types
    height += 50; 
  }

  // Validation/Extras spacing
  if (data.validation) {
    height += 30;
  }

  return Math.max(120, height);
}

// Apply horizontal layout with proper branch separation
async function applyHorizontalLayout() {
  if (!editorContext.value) return;
  
  const reteNodes = editorContext.value.editor.getNodes();
  const nodeMap = new Map<string, any>();
  reteNodes.forEach((n: any) => nodeMap.set(n.id, n));

  // BFS to assign levels - track parent relationships for branch detection
  const visited = new Set<string>();
  const levels = new Map<string, number>();
  const parents = new Map<string, string[]>(); // Track all parents for each node
  const queue: Array<{ id: string; level: number; parent: string | null }> = [];
  
  if (nodeMap.has('__start__')) {
    queue.push({ id: '__start__', level: 0, parent: null });
  }

  while (queue.length > 0) {
    const { id, level, parent } = queue.shift()!;
    
    // Track parents even if already visited (for branch merging detection)
    if (parent) {
      const existingParents = parents.get(id) || [];
      if (!existingParents.includes(parent)) {
        existingParents.push(parent);
        parents.set(id, existingParents);
      }
    }
    
    if (visited.has(id)) continue;
    visited.add(id);
    levels.set(id, level);

    // Find outgoing edges
    const outEdges = edges.value.filter(e => e.source === id);
    for (const edge of outEdges) {
      if (!visited.has(edge.target)) {
        queue.push({ id: edge.target, level: level + 1, parent: id });
      }
    }
  }

  // Add unvisited nodes to the end
  for (const nodeId of nodeMap.keys()) {
    if (!visited.has(nodeId)) {
      const maxLevel = Math.max(...levels.values(), 0);
      levels.set(nodeId, maxLevel + 1);
    }
  }

  // Group nodes by level
  const levelNodes = new Map<number, string[]>();
  for (const [nodeId, level] of levels) {
    const existing = levelNodes.get(level) || [];
    existing.push(nodeId);
    levelNodes.set(level, existing);
  }

  // Sort levels
  const sortedLevels = Array.from(levelNodes.keys()).sort((a, b) => a - b);

  // Layout constants
  const nodeWidth = 320;
  const horizontalGap = 180;
  const verticalGap = 100; // Increased gap between nodes
  const branchGap = 60;    // Extra gap between separate branches

  // Calculate positions with proper height consideration
  for (const level of sortedLevels) {
    const nodeIds = levelNodes.get(level) || [];
    
    // Calculate actual heights for all nodes at this level
    const nodeHeights: Map<string, number> = new Map();
    let totalHeight = 0;
    
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      if (!nodeId) continue;
      const height = getNodeHeight(nodeId);
      nodeHeights.set(nodeId, height);
      totalHeight += height;
      if (i < nodeIds.length - 1) {
        totalHeight += verticalGap;
        
        // Add extra gap between nodes from different parent branches
        if (i < nodeIds.length - 1) {
          const currentNodeId = nodeIds[i];
          const nextNodeId = nodeIds[i + 1];
          if (currentNodeId && nextNodeId) {
            const currentParents = parents.get(currentNodeId) || [];
            const nextParents = parents.get(nextNodeId) || [];
            const shareParent = currentParents.some(p => nextParents.includes(p));
            if (!shareParent && currentParents.length > 0 && nextParents.length > 0) {
              totalHeight += branchGap;
            }
          }
        }
      }
    }

    // Position nodes, centered around y=0
    let y = -totalHeight / 2;
    
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      if (!nodeId) continue;
      const height = nodeHeights.get(nodeId) || 120;
      const x = level * (nodeWidth + horizontalGap);
      
      nodePositions.value.set(nodeId, { x, y });
      await editorContext.value.area.translate(nodeId, { x, y });
      
      y += height + verticalGap;
      
      // Add extra gap between different branches
      if (i < nodeIds.length - 1) {
        const currentNodeId = nodeIds[i];
        const nextNodeId = nodeIds[i + 1];
        if (currentNodeId && nextNodeId) {
          const currentParents = parents.get(currentNodeId) || [];
          const nextParents = parents.get(nextNodeId) || [];
          const shareParent = currentParents.some(p => nextParents.includes(p));
          if (!shareParent && currentParents.length > 0 && nextParents.length > 0) {
            y += branchGap;
          }
        }
      }
    }
  }
}

// Sync connections only (from store to Rete.js)
async function syncConnections() {
  if (!editorContext.value) return;

  isSyncingToRete = true;
  try {
    // Remove existing connections
    const existingConns = editorContext.value.editor.getConnections();
    for (const conn of existingConns) {
      await editorContext.value.editor.removeConnection(conn.id);
    }

    // Add connections from store
    for (const edge of edges.value) {
      const sourceNode = editorContext.value.editor.getNode(edge.source);
      const targetNode = editorContext.value.editor.getNode(edge.target);

      if (!sourceNode || !targetNode) continue;
      
      // Check if output port exists
      if (!sourceNode.outputs[edge.sourcePort]) continue;

      try {
        const connection = new ClassicPreset.Connection(
          sourceNode,
          edge.sourcePort,
          targetNode,
          edge.targetPort
        );
        await editorContext.value.editor.addConnection(connection);
        attachConnectionContextMenuListener(connection.id);
      } catch (e) {
        // Ignore connection errors
      }
    }
  } finally {
    isSyncingToRete = false;
  }
}

// Track node additions/removals using nodeCount
const nodeCount = computed(() => nodes.value.size);
let previousNodeIds = new Set<string>();
let isWatchInitialized = false;

// Watch node count changes to detect additions/removals
watch(nodeCount, async (_newCount, _oldCount) => {
  if (!isInitialized.value || !editorContext.value || !isWatchInitialized) return;
  if (isImporting.value) return; // Skip during import - importVersion watcher handles full rebuild
  
  const currentNodeIds = new Set(nodes.value.keys());
  
  // Find added nodes
  for (const nodeId of currentNodeIds) {
    if (!previousNodeIds.has(nodeId)) {
      const node = nodes.value.get(nodeId);
      if (node) {
        await addSingleNode(nodeId, node);
        
        // Place the new node in the center of the currently visible area.
        // The area transform maps canvas coordinates to screen coordinates:
        //   screen = canvas * k + panOffset
        // So: canvas = (screen - panOffset) / k
        let newPos = { x: 0, y: 0 };
        if (editorContext.value && containerRef.value) {
          const { k, x: panX, y: panY } = editorContext.value.area.area.transform;
          const { clientWidth, clientHeight } = containerRef.value;
          // Convert screen center to canvas space
          const centerCanvasX = (clientWidth / 2 - panX) / k;
          const centerCanvasY = (clientHeight / 2 - panY) / k;
          newPos = { x: centerCanvasX, y: centerCanvasY };
        }
        
        nodePositions.value.set(nodeId, newPos);
        await editorContext.value.area.translate(nodeId, newPos);
        
        // Update classes for the new node
        setTimeout(() => updateNodeClasses(), 50);
      }
    }
  }

  // Find removed nodes
  for (const nodeId of previousNodeIds) {
    if (!currentNodeIds.has(nodeId)) {
      const existingNode = editorContext.value.editor.getNode(nodeId);
      if (existingNode) {
        // Remove connections first
        const conns = editorContext.value.editor.getConnections();
        for (const conn of conns) {
          if (conn.source === nodeId || conn.target === nodeId) {
            await editorContext.value.editor.removeConnection(conn.id);
          }
        }
        await editorContext.value.editor.removeNode(nodeId);
      }
      nodePositions.value.delete(nodeId);
    }
  }

  previousNodeIds = currentNodeIds;
});

// Edge watcher DISABLED - import signal handles post-import sync correctly
// Individual edge changes are handled by Rete.js connection event handlers

// Watch for import signal - performs full canvas rebuild by recreating editor
watch(importVersion, async (newVersion, _oldVersion) => {
  if (!isInitialized.value || !editorContext.value || !containerRef.value || newVersion === 0) return;

  isRebuilding.value = true;
  // Note: isImporting is already set to true by ImportModal before signalImport()
  try {
    // Save Rete's content holder before destroying so we can remove only it.
    // We must NOT remove all container children — Vue's v-if anchor comment nodes
    // must stay or Vue crashes with "parent is null" when re-rendering.
    const oldContentHolder = (editorContext.value.area.area as any)?.content?.holder as HTMLElement | undefined;

    destroyEditor(editorContext.value);

    // Give Vue time to clean up DOM
    await nextTick();

    // Remove only Rete's stale content holder, not Vue-managed elements
    if (oldContentHolder && oldContentHolder.parentNode === containerRef.value) {
      containerRef.value.removeChild(oldContentHolder);
    }

    await nextTick();
    await new Promise(resolve => requestAnimationFrame(resolve));
    await nextTick();
    
    // Recreate the editor from scratch
    editorContext.value = await createEditor(containerRef.value);
    editorStore.setReteEditor(editorContext.value.editor);
    await nextTick();

    // Re-register event handlers
    editorContext.value.area.addPipe((context: any) => {
      if (context.type === 'nodepicked') {
        editorStore.selectNode(context.data.id);
      }
      if (context.type === 'nodetranslated') {
        const { id, position } = context.data;
        nodePositions.value.set(id, { x: position.x, y: position.y });
        graphStore.updateNodePosition(id, { x: position.x, y: position.y });
      }
      // Clamp zoom: block scroll/pinch zoom above 150%
      if (context.type === 'zoom' && context.data.zoom > 1.5) return;
      if (context.type === 'zoomed' || context.type === 'translated') {
        updateBackgroundPosition();
        // Sync actual zoom to store for toolbar display
        if (context.type === 'zoomed' && editorContext.value) {
          editorStore.setZoom(editorContext.value.area.area.transform.k);
        }
      }
      return context;
    });

    editorContext.value.editor.addPipe((context: any) => {
      if (isSyncingToRete) return context;

      if (context.type === 'connectioncreated') {
        const conn = context.data;
        const sourceOutput = conn.sourceOutput || 'next';
        let edgeType: 'default' | 'option' | 'routing' = 'default';
        let optionId: string | undefined;
        let routingIndex: number | undefined;

        if (sourceOutput.startsWith('option_')) {
          edgeType = 'option';
          optionId = sourceOutput.replace('option_', '');
        } else if (sourceOutput.startsWith('routing_')) {
          edgeType = 'routing';
          routingIndex = parseInt(sourceOutput.replace('routing_', ''), 10);
        }

        const edge = graphStore.createEdge(
          conn.source,
          sourceOutput,
          conn.target,
          conn.targetInput || 'prev',
          edgeType
        );

        if (optionId) edge.optionId = optionId;
        if (routingIndex !== undefined) edge.routingIndex = routingIndex;

        graphStore.addEdge(edge);

        // Attach contextmenu listener and remove duplicate connections after Rete settles
        const editor = editorContext.value!.editor;
        setTimeout(() => {
          attachConnectionContextMenuListener(conn.id);
          const allConnections = Array.from(editor.getConnections());
          const connectionsToRemove = allConnections.filter(
            (c: any) => c.source === conn.source &&
                        c.sourceOutput === sourceOutput &&
                        c.id !== conn.id
          ) as { id: string }[];
          connectionsToRemove.forEach(c => editor.removeConnection(c.id));
        }, 10);
      }
      if (context.type === 'connectionremoved') {
        const conn = context.data;
        const sourceOutput = conn.sourceOutput;
        const storeEdges = graphStore.edges;
        const edgeToRemove = storeEdges.find(
          e => e.source === conn.source &&
               e.target === conn.target &&
               (!sourceOutput || e.sourcePort === sourceOutput)
        );
        if (edgeToRemove) {
          graphStore.removeEdge(edgeToRemove.id);
        }
      }
      return context;
    });
    
    nodePositions.value.clear();
    previousNodeIds = new Set();

    // Rebuild from store
    for (const [nodeId, node] of nodes.value) {
      await addSingleNode(nodeId, node);
    }

    // Sync connections
    await syncConnections();

    // Apply saved positions if provided, otherwise auto-layout
    if (editorStore.pendingPositions) {
      for (const [nodeId, pos] of Object.entries(editorStore.pendingPositions)) {
        if (editorContext.value) {
          nodePositions.value.set(nodeId, pos);
          await editorContext.value.area.translate(nodeId, pos);
        }
      }
      editorStore.clearPendingPositions();
    } else {
      await applyHorizontalLayout();
    }
    if (editorContext.value) {
      await zoomToFit(editorContext.value);
      // Sync actual zoom level to store
      editorStore.setZoom(editorContext.value.area.area.transform.k);
      updateBackgroundPosition();
    }
    
    // Update node classes
    setTimeout(() => updateNodeClasses(), 100);

    // Re-apply error highlights after rebuild — the issuesByNode watcher may have fired
    // mid-rebuild when nodeViews were not yet populated. Force a re-check now.
    setTimeout(() => updateErrorHighlights(), 150);
  } catch (err) {
    console.error('Error during import sync:', err);
  } finally {
    // Always update tracking so nodeCount watcher has correct baseline
    previousNodeIds = new Set(nodes.value.keys());
    isRebuilding.value = false;
  }
  // Note: isImporting is set to false by ImportModal in finally block after signalImport()
});

// Watch for node data changes (labels, etc.) - update Rete.js node labels
watch(
  () => {
    // Track all label values considering current locale
    const nodesData: Array<{ id: string; label: string | undefined; questionId: string }> = [];
    const locale = currentLocale.value; // Dependency on locale
    
    for (const [id, node] of nodes.value) {
      if (node.data) {
        let label: string | undefined;
        if (typeof node.data.label === 'string') {
          label = node.data.label;
        } else if (node.data.label) {
          // Strict locale check
          label = node.data.label[locale];
        }
        nodesData.push({ id, label, questionId: node.data.id });
      }
    }
    return JSON.stringify(nodesData);
  },
  async () => {
    if (!isInitialized.value || !editorContext.value || !isWatchInitialized) return;
    
    // Update Rete.js node labels
    const locale = currentLocale.value;
    
    for (const [id, node] of nodes.value) {
      const reteNode = editorContext.value.editor.getNode(id);
      if (reteNode && node.data) {
        let newLabel: string;
        if (typeof node.data.label === 'string') {
          newLabel = node.data.label.trim() || node.data.id;
        } else if (node.data.label) {
          // Strict locale check
          newLabel = (node.data.label[locale] || '').trim() || node.data.id;
        } else {
          newLabel = node.data.id; // No label, use ID
        }
        
        if (reteNode.label !== newLabel) {
          reteNode.label = newLabel;
          await editorContext.value.area.update('node', id);
        }
      }
    }
  }
);

// Watch for question options/routing/description changes AND locale changes
watch(
  () => {
    // Track options, routing, description AND locale
    const locale = currentLocale.value; // Dependency
    const nodeData: Array<{ id: string; dataSummary: string }> = [];
    
    for (const [id, node] of nodes.value) {
      const parts: string[] = [];
      const data = node.data;
      if (!data) continue;

      // Track options (strict label check)
      if (data.options) {
        const optionsSummary = data.options.map((o: any) => {
          // Resolve label strictly for summary to trigger change on locale switch
          let label = '';
          if (typeof o.label === 'string') label = o.label;
          else if (o.label) label = o.label[locale] || '';
          
          return `${o.id}:${label}:${o.value}:${o.next || ''}`;
        }).join('|');
        parts.push(`opts:${optionsSummary}`);
      }
      
      // Track type changes
      parts.push(`type:${data.type || ''}`);

      // Track routing
      if (data.actions) {
        parts.push(`route:${JSON.stringify(data.actions)}`);
      }
      
      // Track description (strict check)
      if (data.description !== undefined) {
        let desc = '';
        if (typeof data.description === 'string') desc = data.description;
        else if (data.description) desc = data.description[locale] || '';
        
        parts.push(`desc:${desc}`);
      }
      
      if (parts.length > 0) {
        nodeData.push({ id, dataSummary: parts.join('||') });
      }
    }
    return JSON.stringify(nodeData) + `|${locale}`; // Include locale in hash
  },
  async () => {
    if (!isInitialized.value || !editorContext.value || !isWatchInitialized) return;
    
    // Update ALL Rete.js nodes
    for (const [id, node] of nodes.value) {
      const reteNode = editorContext.value.editor.getNode(id);
      if (reteNode && node.data && 'updateFromQuestion' in reteNode) {
        const questionNode = reteNode as QuestionNode;
        // This will now use the strict resolveLabel because we updated nodes.ts
        // and we are passing currentLocale.value
        questionNode.updateFromQuestion(node.data, currentLocale.value);

        // Remove edges whose sourcePort no longer exists after the type change
        const validPorts = new Set(Object.keys(questionNode.outputs));
        const orphanedEdges = graphStore.edges.filter(
          e => e.source === id && e.sourcePort != null && !validPorts.has(e.sourcePort)
        );
        for (const edge of orphanedEdges) {
          const reteConns = editorContext.value.editor.getConnections();
          for (const conn of reteConns) {
            if (conn.source === id && (conn as any).sourceOutput === edge.sourcePort) {
              await editorContext.value.editor.removeConnection(conn.id);
            }
          }
          graphStore.removeEdge(edge.id);
        }

        // Re-render
        await editorContext.value.area.update('node', id);
      }
    }
    
    // Also re-apply layout because heights might have changed due to strict description/options
    // We can debounce this if needed, but for now simple call
    // await applyHorizontalLayout(); // Optional: might be too jarring? 
    // User requested "no overlap", so yes we should re-layout if dimensions change significantly.
    // However, re-layout moves everything. Maybe just update nodes for now.
    // Ideally we should update background position logic if we re-layout.
  }
);

// Watch minimap toggle
const { showMinimap } = storeToRefs(editorStore);

// Watch for locale changes - update all nodes
watch(currentLocale, async (newLocale) => {
  if (!isInitialized.value || !editorContext.value) return;

  for (const [id, node] of nodes.value) {
    const reteNode = editorContext.value.editor.getNode(id);
    if (reteNode) {
      if ('updateFromQuestion' in reteNode && node.data) {
        // Update QuestionNodes with new locale
        (reteNode as QuestionNode).updateFromQuestion(node.data, newLocale);
        await editorContext.value.area.update('node', id);
      } else if (node.type === 'start' || node.type === 'end') {
        // Start/End nodes might need updates if they had localized labels (currently they don't, but good practice)
         await editorContext.value.area.update('node', id);
      }
    }
  }
});
watch(showMinimap, (show) => {
  if (!editorContext.value) return;
  // Toggle minimap using CSS since plugin doesn't have enable/disable method
  const minimapEl = containerRef.value?.querySelector('.minimap') as HTMLElement;
  if (minimapEl) {
    minimapEl.style.display = show ? 'block' : 'none';
  }
}, { immediate: true });

// Zoom methods exposed for toolbar
// Zoom methods exposed for toolbar
function zoomIn() {
  if (!editorContext.value || !containerRef.value) return;
  const { area } = editorContext.value;
  const rect = containerRef.value.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  
  // Current transform
  const { k, x, y } = area.area.transform;
  const newK = Math.min(k * 1.2, 1.5); // Max zoom 150%
  
  // Adjust translation to keep center fixed
  const newX = centerX - (centerX - x) * (newK / k);
  const newY = centerY - (centerY - y) * (newK / k);
  
  area.area.transform.k = newK;
  area.area.transform.x = newX;
  area.area.transform.y = newY;
  area.area.update();
  updateBackgroundPosition();
  editorStore.setZoom(newK);
}

function zoomOut() {
  if (!editorContext.value || !containerRef.value) return;
  const { area } = editorContext.value;
  const rect = containerRef.value.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  
  // Current transform
  const { k, x, y } = area.area.transform;
  const newK = Math.max(k / 1.2, 0.25); // Min zoom 25%
  
  // Adjust translation to keep center fixed
  const newX = centerX - (centerX - x) * (newK / k);
  const newY = centerY - (centerY - y) * (newK / k);
  
  area.area.transform.k = newK;
  area.area.transform.x = newX;
  area.area.transform.y = newY;
  area.area.update();
  updateBackgroundPosition();
  editorStore.setZoom(newK);
}

function resetZoom() {
  if (!editorContext.value || !containerRef.value) return;
  const { area } = editorContext.value;
  const rect = containerRef.value.getBoundingClientRect();
  
  // Reset to 100% zoom, centered at canvas center
  area.area.transform.k = 1;
  area.area.transform.x = rect.width / 2;
  area.area.transform.y = rect.height / 2;
  area.area.update();
  updateBackgroundPosition();
  editorStore.setZoom(1);
}

async function reLayout() {
  await applyHorizontalLayout();
  if (editorContext.value) {
    await zoomToFit(editorContext.value);
    // Sync the final zoom level to store
    editorStore.setZoom(editorContext.value.area.area.transform.k);
  }
}

// Error highlighting — apply/remove has-error class on node wrapper elements
function updateErrorHighlights() {
  if (!editorContext.value || !isInitialized.value) return;
  const nodeViews = editorContext.value.area.nodeViews as Map<string, any>;
  const minimapViews = editorContext.value.minimap?.nodeViews as Map<string, any> | undefined;

  for (const [nodeId, view] of nodeViews) {
    const hasError = issuesByNode.value.has(nodeId) &&
      issuesByNode.value.get(nodeId)!.some(i => i.severity === 'error');

    const el = view?.element as HTMLElement | undefined;
    if (el) el.classList.toggle('has-error', hasError);

    if (minimapViews) {
      const mView = minimapViews.get(nodeId);
      const mEl = mView?.element as HTMLElement | undefined;
      if (mEl) mEl.classList.toggle('has-error', hasError);
    }
  }
}

watch(issuesByNode, () => {
  nextTick(updateErrorHighlights);
}, { deep: true });

// ─── Focus node (from search) ─────────────────────────────────────────────────
watch(() => editorStore.focusNodeRequest, (nodeId) => {
  if (!nodeId || !editorContext.value || !containerRef.value) return;

  // Select so inspector shows it
  editorStore.selectNode(nodeId);

  // Resolve position: prefer live nodePositions, fall back to graphStore
  const pos = nodePositions.value.get(nodeId) ?? graphStore.nodes.get(nodeId)?.position;
  if (!pos) {
    editorStore.requestFocusNode(null);
    return;
  }

  const { area } = editorContext.value;
  const rect = containerRef.value.getBoundingClientRect();
  const k = area.area.transform.k;

  // Pan so the node centre is at the viewport centre
  area.area.transform.x = rect.width  / 2 - (pos.x + 110) * k;
  area.area.transform.y = rect.height / 2 - (pos.y +  60) * k;
  area.area.update();
  updateBackgroundPosition();

  editorStore.requestFocusNode(null);
});

defineExpose({ reLayout, zoomIn, zoomOut, resetZoom, editorContext });

// Watch for locale changes - update all node labels without moving them
watch(currentLocale, async (newLocale) => {
  if (!editorContext.value || !isInitialized.value) return;
  
  // Update labels for all QuestionNodes
  for (const [id] of nodes.value) {
    const reteNode = editorContext.value.editor.getNode(id);
    if (reteNode && reteNode instanceof QuestionNode) {
      reteNode.updateLabelForLocale(newLocale);
      await editorContext.value.area.update('node', id);
    }
  }
});
</script>

<template>
  <div ref="containerRef" class="editor-canvas" @click="closeContextMenu" @contextmenu.prevent="handleContextMenu">
    <!-- Import/Rebuild Loading Overlay -->
    <div v-if="isRebuilding" class="canvas-loading-overlay">
      <div class="canvas-spinner" />
      <span>{{ t('modals.import.buildingCanvas') }}</span>
    </div>

    <!-- Context Menu -->
    <div 
      v-if="contextMenu.show" 
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <!-- Node context menu (Start/End nodes never reach here) -->
      <template v-if="contextMenu.nodeId">
        <button @click="duplicateNode">
          <Copy :size="14" /> {{ t('canvas.duplicate') }}
        </button>
        <button @click="deleteNode" class="danger">
          <Trash2 :size="14" /> {{ t('canvas.deleteNode') }}
        </button>
      </template>

      <!-- Connection context menu -->
      <template v-if="contextMenu.connectionId">
        <button @click="deleteConnection" class="danger">
          <Trash2 :size="14" /> {{ t('canvas.deleteConnection') }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.editor-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  background: var(--color-bg-canvas);
  background-image: radial-gradient(circle, var(--color-grid) 1px, transparent 1px);
  background-size: 24px 24px;
}

.canvas-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  z-index: 500;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 500;
  pointer-events: all;
}

.canvas-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: canvas-spin 0.7s linear infinite;
}

@keyframes canvas-spin {
  to { transform: rotate(360deg); }
}

.context-menu {
  position: fixed;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  padding: 0.25rem;
  min-width: 140px;
}

.context-menu button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: transparent;
  text-align: left;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  margin-bottom: 2px;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
}

.context-menu button:last-child {
  margin-bottom: 0;
}

.context-menu button:hover {
  background: var(--color-bg-tertiary);
}

.context-menu button.danger {
  color: var(--color-error);
}

.context-menu button.danger:hover {
  background: rgba(var(--color-error-rgb), 0.08);
  color: var(--color-error-hover);
}

:deep(.node) {
  background: var(--color-bg-secondary) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-md) !important;
  min-width: 200px;
  box-shadow: var(--shadow-md) !important;
  color: var(--color-text-primary) !important; /* Force dark text for visibility */
  overflow: visible !important; /* Allow sockets to extend outside node bounds */
}

:deep(.has-error .node) {
  border-color: var(--color-error) !important;
  box-shadow: 0 0 0 2px rgba(var(--color-error-rgb), 0.25), var(--shadow-md) !important;
}

:deep(.rete-minimap .has-error) {
  outline: 2px solid var(--color-error) !important;
  outline-offset: 1px;
}

/* 
 * Start Node Styling 
 * Green/Teal accent to signify "Go" / Entry
 * Applied to parent wrapper (node-start) -> child (.node)
 */
:deep(.node-start .node) {
  border-color: var(--color-mint) !important; /* CI mint */
}
:deep(.node-start .node .title) {
  background: var(--color-success) !important; /* CI teal */
  border-bottom-color: var(--color-success);
}
:deep(.node-start .node .socket) {
  background: var(--color-mint);
}

/* 
 * End Node Styling
 * Purple/Indigo accent to signify "Finish" / Submission
 */
:deep(.node-end .node) {
  border-color: var(--color-purple) !important; /* CI purple */
}
:deep(.node-end .node .title) {
  background: var(--color-indigo) !important; /* CI indigo */
  border-bottom-color: var(--color-indigo);
}
:deep(.node-end .node .socket) {
  background: var(--color-purple);
}

:deep(.node.selected) {
  border-color: var(--color-accent) !important;
  box-shadow: var(--node-selected-shadow) !important;
}

:deep(.node .title) {
  padding: 0.75rem 1rem;
  padding-left: 2rem; /* Make room for the input socket */
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-header-text) !important; /* Paper text on ink */
  border-bottom: 1px solid var(--color-border);
  background: var(--node-header-gradient), var(--color-header-bg) !important; /* Ink + sky sheen, matches topbar */
  position: relative;
  border-top-left-radius: var(--radius-md);
  border-top-right-radius: var(--radius-md);
}

:deep(.node .socket) {
  width: 16px;
  height: 16px;
  background: var(--color-accent);
  border: 2px solid var(--color-bg-secondary);
  border-radius: 50%;
}

/* Position input socket at the left edge of the header, vertically centered */
:deep(.node .input) {
  position: absolute !important;
  left: 0px !important;
  top: 5px !important;
  margin: 0 !important;
  padding: 0 !important;
  height: auto !important;
}

:deep(.node .inputs) {
  position: absolute !important;
  left: 0px !important;
  top: 5px !important; /* Center in header (header is ~40px tall, so 20px = center) */
  height: 0 !important;
  width: 0 !important;
  overflow: visible !important;
  transform: translateY(-50%) !important;
}

:deep(.node .control input),
:deep(.node .control select),
:deep(.node .control textarea) {
  color: var(--color-text-primary) !important;
  background-color: #ffffff !important;
  border: 1px solid var(--color-input-border) !important;
  border-radius: var(--radius-sm) !important;
  padding: 4px 8px !important;
  font-size: 14px !important;
}

:deep(.node .control) {
  padding: 8px !important;
}

/* Node outputs container */
:deep(.node .outputs) {
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* Base Output Styling - let Rete.js handle socket positioning */
:deep(.node .output) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--color-text-primary) !important; /* Fixed dark text color */
}

/* Output sockets - ensure they're above text labels */
:deep(.node .output .socket) {
  cursor: crosshair;
  position: relative;  /* Enable z-index */
  z-index: 20;         /* Above text labels */
  flex-shrink: 0;      /* Don't shrink socket */
  margin-left: 8px;    /* Space between text and socket */
}

/* Output Label Styling - prevent overlap with socket */
:deep(.node .output-title) {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: calc(100% - 28px); /* Leave room for socket */
  color: var(--color-text-primary) !important; /* Fixed dark text color */
}

:deep(.node .input-title) {
  color: var(--color-text-primary) !important; /* Fixed dark text color */
}

/* 
 * 1. Description Styling 
 * Full width, below title, distinct style
 */
:deep(.node .output[data-testid^="output-__desc__"]) {
  display: block !important;
  padding: 8px 16px !important;
  background: rgba(0, 0, 0, 0.07);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-style: italic;
  font-size: 0.75rem;
  line-height: 1.4;
  order: -1;
  box-sizing: border-box !important;
  width: 100%;
  text-align: left !important;
  overflow: hidden;
}
:deep([data-testid^="output-__desc__"] .output-title) {
  display: -webkit-box !important;
  -webkit-line-clamp: 3 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  white-space: normal !important;
  word-break: break-word;
  text-align: left !important;
  margin: 0 !important;
  padding: 0 !important;
}
:deep([data-testid^="output-__desc__"] .socket) {
  display: none !important;
}

/* Force Node Auto Height */
:deep(.node) {
  height: auto !important;
  min-height: 120px;
  box-sizing: border-box !important;
}
:deep(.node *) {
  box-sizing: border-box;
}
:deep([data-testid^="output-__desc__"] .socket) {
  display: none !important;
}

/* 
 * 2. Next (Default) Output Styling
 * Distinct "Standard Action"
 */
:deep(.node .output[data-testid="output-default"]) {
  padding: 8px 0px 8px 16px;
  border-bottom: 1px solid var(--color-border); /* Separator before options */
  font-weight: 500;
  color: var(--color-text-primary);
}

/* 
 * 3. Options Section & Separator
 * "Info" outputs (no routing) and "Option" outputs (routing)
 */

/* Display-only options (InfoSocket) - No socket circle */
:deep([data-testid^="output-info_"] .socket) {
  display: none !important;
}
:deep(.node .output[data-testid^="output-info_"]) {
  color: var(--color-text-secondary);
  padding-left: 16px; /* Indent slightly like a list item */
}


/* Routing options (OptionSocket) - With visible socket */
:deep(.node .output[data-testid^="output-option_"]) {
  color: var(--color-accent);
  font-weight: 500;
  background: rgba(var(--color-accent-rgb), 0.05); /* Subtle highlight */
  padding-left: 16px;
}

:deep(.node .output .socket.Option) {
  background: var(--color-success);
}

/* Routing Rules Styling */
:deep(.node .output[data-testid^="output-routing_"]) {
  border-top: 1px solid var(--color-border); /* Separate routing rules section */
  margin-top: 4px;
  font-size: 0.75rem;
  padding: 8px 0px 0px 16px;
}

:deep(.connection) {
  stroke: var(--color-accent);
  stroke-width: 5px; /* Increased from 3px for better hitbox */
  transition: stroke-width 0.2s ease;
  cursor: pointer;
}

:deep(.connection:hover) {
  stroke-width: 7px;
  stroke: var(--primary-color);
}

:deep(.minimap) {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 180px;
  height: 130px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
</style>

<style>
/* Global override for node text visibility */
.node .input-title,
.node .output-title {
  color: var(--color-text-primary) !important;
  font-weight: 500;
}

</style>

