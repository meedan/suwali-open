import type { Edge, Node, NodeChange } from '@xyflow/react';

import type { Message } from '@customTypes/message';

// Layout constants for conversation flow visualization
export const NODE_HEIGHT = 60;
export const NODE_SPACING = 90;
export const BOTTOM_PADDING = 150;
export const BRANCH_NODE_GAP = 40;
export const BRANCH_GROUP_PADDING = 10;
export const BRANCH_Y_OFFSET = 8;
export const MAIN_FLOW_X_OFFSET = 50;
// Distance from a main-flow node's left edge to the vertical line connecting the nodes
export const MAIN_FLOW_LINE_X_OFFSET = 28;
export const BRANCH_LANE_SPACING = 350;

// Rendered heights, margin included, of a message node and a date pill node
export const MESSAGE_NODE_OUTER_HEIGHT = 56;
const DATE_NODE_OUTER_HEIGHT = 26;
// A date node sits NODE_SPACING below the message above it, which leaves a gap of
// NODE_SPACING - MESSAGE_NODE_OUTER_HEIGHT. The message below sits the same gap under it.
export const DATE_TO_MESSAGE_SPACING = DATE_NODE_OUTER_HEIGHT + (NODE_SPACING - MESSAGE_NODE_OUTER_HEIGHT);

// Message types that appear in horizontal contribution flows
const CONTRIBUTION_FLOW_TYPES: Message['state'][] = [
  'bot_contribution_started',
  'user_contribution_cancelled',
  'user_contribution_submitted'
];

/**
 * Determines the appropriate node type based on message state
 */
export const getNodeType = (messageState: Message['state']): string => {
  if (CONTRIBUTION_FLOW_TYPES.includes(messageState)) {
    return 'contributionNode';
  }

  return 'messageNode';
};

/**
 * Checks if a message is a contribution type that should be in horizontal flow
 */
export const isContributionFlowType = (messageState: Message['state']): boolean => {
  return CONTRIBUTION_FLOW_TYPES.includes(messageState);
};

/**
 * Collects consecutive contribution messages starting from a given index
 * Returns an array of contribution messages and the index after the last contribution
 */
export const collectContributionMessages = (
  messages: Message[],
  startIndex: number
): { contributionMessages: Message[]; nextIndex: number } => {
  const contributionMessages: Message[] = [];
  let nextIndex = startIndex;

  while (nextIndex < messages.length && isContributionFlowType(messages[nextIndex].state)) {
    contributionMessages.push(messages[nextIndex]);
    nextIndex++;
  }

  return { contributionMessages, nextIndex };
};

/**
 * Finds the main-flow messages that start a new local day (the first loaded
 * message included), mirroring where the conversation view shows a date pill.
 * Messages in `skippedIndices` (contribution flows) are not compared. When older
 * messages are not loaded (`hasOlderMessages`), the first message's day may have
 * started earlier, so it gets no date node.
 */
export const getDateSeparatorIndices = (
  messages: Message[],
  skippedIndices: ReadonlySet<number>,
  hasOlderMessages = false
): Set<number> => {
  const indices = new Set<number>();
  let previousDay: string | null = null;
  let isFirst = true;

  messages.forEach((msg, index) => {
    if (skippedIndices.has(index)) return;

    const day = new Date(msg.created_at).toDateString();

    if (day !== previousDay && !(isFirst && hasOlderMessages)) indices.add(index);
    previousDay = day;
    isFirst = false;
  });

  return indices;
};

/**
 * Creates a group node container for horizontal flows (branches or contributions)
 */
const createGroupNode = (
  groupId: string,
  yPosition: number,
  childCount: number,
  branchLane = 0,
): Node => {
  const groupWidth = (childCount * NODE_HEIGHT) + ((childCount - 1) * BRANCH_NODE_GAP) + (2 * BRANCH_GROUP_PADDING);
  const groupHeight = NODE_HEIGHT + BRANCH_GROUP_PADDING;

  return {
    id: groupId,
    type: 'group',
    position: { x: 0, y: yPosition - BRANCH_Y_OFFSET },
    data: {
      label: '',
      branchLane,
    },
    style: {
      width: groupWidth,
      height: groupHeight,
    },
    zIndex: 0,
  };
};

/**
 * Creates edges between nodes in a horizontal chain
 */
const createChainEdges = (
  nodeIds: string[],
  edges: Edge[],
  edgePrefix: string,
): void => {
  for (let i = 0; i < nodeIds.length - 1; i++) {
    edges.push({
      id: `edge-${edgePrefix}-chain-${nodeIds[i]}-to-${nodeIds[i + 1]}`,
      source: nodeIds[i],
      target: nodeIds[i + 1],
      sourceHandle: 'right-source',
      targetHandle: 'left-target',
    });
  }
};

/**
 * Determines if a message should have a branch visualization
 */
export const shouldHaveBranch = (msg: Message | undefined): boolean => {
  return Boolean(
    msg && (
      msg.reply_to_id ||
      (msg.state === 'bot_message' || msg.state === 'knowledge_service_error') &&
      (
        (msg.metadata && msg.metadata.reasoning) ||
        (msg.metadata && msg.metadata.rewritten_question) ||
        (msg.data_source_items_count > 0 && msg.data_source_items)
      )
    )
  );
};

/**
 * Creates branch flow nodes and edges for a message with metadata
 */
export const createBranchFlow = (
  nodeId: string,
  nextMsg: Message,
  nextNodeId: string | null,
  yPosition: number,
  nodes: Node[],
  edges: Edge[],
  branchLane = 0,
): void => {
  const subFlowId = `${nodeId}-subflow`;
  const branchNodes: Node[] = [];
  const branchNodeIds: string[] = [];

  const createBranchNode = ({
    id,
    type,
    branchIndex,
    metadata,
    dataSourceItems,
    dataSourceItemsCount
  } : {
      id: string;
      type: string;
      branchIndex: number;
      metadata?: Message['metadata'];
      dataSourceItems?: Message['data_source_items'];
      dataSourceItemsCount?: number;
    }): Node => {
    return {
      id,
      position: { x: 0, y: BRANCH_Y_OFFSET },
      data: {
        type,
        isFirst: false,
        isLast: false,
        branchIndex,
        parentId: nodeId,
        metadata,
        dataSourceItems,
        dataSourceItemsCount
      },
      type: 'branchNode',
      parentId: subFlowId,
      extent: 'parent',
      zIndex: 1,
    };
  };

  let branchIndex = 0;

  if (nextMsg.metadata?.reasoning || nextMsg.metadata?.rewritten_question) {
    const reasoningNode = createBranchNode({
      id: `${nodeId}-branch-${branchIndex}`,
      type: 'rewriter',
      branchIndex: branchIndex++,
      metadata: nextMsg.metadata
    });
    branchNodes.push(reasoningNode);
    branchNodeIds.push(reasoningNode.id);
  }

  if (nextMsg.data_source_items_count) {
    const dataSourceItems = createBranchNode({
      id: `${nodeId}-branch-${branchIndex}`,
      type: 'data_source_items',
      branchIndex: branchIndex++,
      dataSourceItems: nextMsg.data_source_items,
      dataSourceItemsCount: nextMsg.data_source_items_count,
    });
    branchNodes.push(dataSourceItems);
    branchNodeIds.push(dataSourceItems.id);
  }

  if (branchNodes.length > 0) {
    // Mark first and last nodes
    branchNodes[0] = {
      ...branchNodes[0],
      data: {
        ...branchNodes[0].data,
        isFirst: true,
      }
    };

    branchNodes[branchNodes.length - 1] = {
      ...branchNodes[branchNodes.length - 1],
      data: {
        ...branchNodes[branchNodes.length - 1].data,
        isLast: true,
      }
    };

    // Create group container
    nodes.push(createGroupNode(
      subFlowId,
      yPosition,
      branchNodes.length,
      branchLane,
    ));
    nodes.push(...branchNodes);

    // Entry edge: source message to first branch node
    edges.push({
      id: `edge-${nodeId}-to-branch-entry`,
      source: nodeId,
      target: branchNodeIds[0],
      sourceHandle: 'right-source',
      targetHandle: 'left-target',
    });

    // Chain edges between branch nodes
    createChainEdges(branchNodeIds, edges, 'branch');

    // Exit edge: last branch node to next message
    if (nextNodeId) {
      edges.push({
        id: `edge-branch-exit-${branchNodeIds[branchNodeIds.length - 1]}-to-${nextNodeId}`,
        source: branchNodeIds[branchNodeIds.length - 1],
        sourceHandle: 'bottom-source',
        target: nextNodeId,
        targetHandle: 'right-target',
      });
    }
  } else {
    // Guaranteed non-null: createBranchFlow is only ever called with a real next message.
    edges.push({
      id: `direct-reply-${nodeId}-to-${nextNodeId}`,
      source: nodeId,
      sourceHandle: 'right-source',
      target: nextNodeId!,
      targetHandle: 'right-target',
    });
  }
};

/**
 * Creates contribution flow nodes and edges after a contribution_processing node
 */
export const createContributionFlow = (
  syntheticId: string,
  contributionMessages: Message[],
  yPosition: number,
  nodes: Node[],
  edges: Edge[],
  nextNodeId: string | null,
) => {
  const subFlowId = `${syntheticId}-contribution-subflow`;
  const contributionNodes: Node[] = [];
  const contributionNodeIds: string[] = [];

  contributionMessages.forEach((msg: Message, contributionIndex: number) => {
    const nodeId = `${syntheticId}-contribution-${contributionIndex}`;

    contributionNodes.push({
      id: nodeId,
      position: { x: 0, y: BRANCH_Y_OFFSET },
      data: {
        id: msg.id,
        body: msg.body,
        type: msg.state,
        isFirst: contributionIndex === 0,
        isLast: contributionIndex === contributionMessages.length - 1,
        hasBranch: false,
        metadata: msg.metadata,
        messageObject: msg,
        branchIndex: contributionIndex,
        parentId: syntheticId,
      },
      type: 'contributionNode',
      parentId: subFlowId,
      extent: 'parent',
      zIndex: 1,
    });

    contributionNodeIds.push(nodeId);
  });

  // Create group container
  nodes.push(createGroupNode(subFlowId, yPosition, contributionNodes.length));
  nodes.push(...contributionNodes);

  // Entry edge: synthetic processing node to first contribution
  edges.push({
    id: `edge-${syntheticId}-to-contribution-entry`,
    source: syntheticId,
    target: contributionNodeIds[0],
    sourceHandle: 'right-source',
    targetHandle: 'left-target',
  });

  // Chain edges between contribution nodes
  createChainEdges(contributionNodeIds, edges, 'contribution');

  // Exit edge: last contribution node to next message node
  if (nextNodeId) {
    edges.push({
      id: `edge-contribution-exit-${contributionNodeIds[contributionNodeIds.length - 1]}-to-${nextNodeId}`,
      source: contributionNodeIds[contributionNodeIds.length - 1],
      sourceHandle: 'bottom-source',
      target: nextNodeId,
      targetHandle: 'right-target',
    });
  }
};

/**
 * Calculates the Y position for a node based on container dimensions and message index
 */
export const calculateNodeYPosition = (
  index: number,
  messageCount: number,
  containerHeight: number,
  NODE_SPACING: number,
  NODE_HEIGHT: number,
  BOTTOM_PADDING: number
): number => {
  const totalNodesHeight = (messageCount - 1) * NODE_SPACING + NODE_HEIGHT;
  const containerCenter = containerHeight / 2;
  const halfContainerFitsNodes = totalNodesHeight <= containerCenter;

  if (halfContainerFitsNodes) {
    return containerCenter - ((messageCount - 1 - index) * NODE_SPACING);
  } else if (totalNodesHeight <= containerHeight) {
    const excessHeight = totalNodesHeight - containerCenter;
    const lastNodeY = containerCenter + excessHeight;
    return lastNodeY - ((messageCount - 1 - index) * NODE_SPACING);
  } else {
    return containerHeight - ((messageCount - index) * NODE_SPACING) - BOTTOM_PADDING;
  }
};

export type PositionSlot = {
  /** Stable identifier for a vertical row, derived from message id — never from array index */
  key: string;
  /** Distance from the previous row's position to this one; defaults to NODE_SPACING */
  spacing?: number;
};

const slotSpacing = (slot: PositionSlot) => slot.spacing ?? NODE_SPACING;

/**
 * Assigns a Y position to each slot, reusing any position already known from
 * `previousPositions` so that a row already on screen never moves when more
 * history loads before or after it. Only slots with no previously known
 * neighbor at all fall back to the compact/bottom-anchored layout used for a
 * brand new flow.
 */
export const computeSlotYPositions = (
  slots: PositionSlot[],
  previousPositions: ReadonlyMap<string, number>,
  containerHeight: number
): Map<string, number> => {
  const positions = new Map<string, number>();

  if (slots.length === 0) {
    return positions;
  }

  const anchorIndex = slots.findIndex(slot => previousPositions.has(slot.key));

  if (anchorIndex === -1) {
    // Position along the grid in NODE_SPACING units, so rows with a custom spacing fit the same formula
    let gridIndex = 0;
    const totalGridUnits = 1 + slots.slice(1).reduce((sum, slot) => sum + slotSpacing(slot) / NODE_SPACING, 0);

    slots.forEach((slot, index) => {
      if (index > 0) {
        gridIndex += slotSpacing(slot) / NODE_SPACING;
      }

      const y = calculateNodeYPosition(
        gridIndex,
        totalGridUnits,
        containerHeight,
        NODE_SPACING,
        NODE_HEIGHT,
        BOTTOM_PADDING
      );

      positions.set(slot.key, y);
    });

    return positions;
  }

  positions.set(slots[anchorIndex].key, previousPositions.get(slots[anchorIndex].key)!);

  for (let i = anchorIndex + 1; i < slots.length; i++) {
    const slot = slots[i];

    if (previousPositions.has(slot.key)) {
      positions.set(slot.key, previousPositions.get(slot.key)!);
      continue;
    }

    const previousY = positions.get(slots[i - 1].key)!;
    positions.set(slot.key, previousY + slotSpacing(slot));
  }

  for (let i = anchorIndex - 1; i >= 0; i--) {
    const slot = slots[i];

    if (previousPositions.has(slot.key)) {
      positions.set(slot.key, previousPositions.get(slot.key)!);
      continue;
    }

    const nextSlot = slots[i + 1];
    const nextY = positions.get(nextSlot.key)!;
    positions.set(slot.key, nextY - slotSpacing(nextSlot));
  }

  return positions;
};

const isShallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
};

const getGroupWidth = (children: Node[], nodeWidths: Record<string, number>) => (
  children.reduce((sum, child) => sum + (nodeWidths[child.id] || NODE_HEIGHT) + BRANCH_NODE_GAP, 0)
  - BRANCH_NODE_GAP + 2 * BRANCH_GROUP_PADDING
);

/**
 * Positions all nodes in the flow based on their type and measured widths.
 *
 * `previousNodes` holds the last correctly-positioned object per node id.
 * Group/branch/contribution nodes are rebuilt from a fresh placeholder every
 * time `flow` recomputes, so comparing against that placeholder can never
 * confirm "nothing changed" even once widths have settled — comparing
 * against the last real computed value instead lets those nodes reuse a
 * stable reference across unrelated width measurements and pagination.
 *
 * For right-to-left languages the layout is mirrored within `containerWidth`.
 */
export const positionNodes = (
  nodes: Node[],
  nodeWidths: Record<string, number>,
  previousNodes: ReadonlyMap<string, Node> = new Map(),
  { rtl, containerWidth }: { rtl: boolean; containerWidth: number } = { rtl: false, containerWidth: 0 }
): Node[] => {
  // Build parent-to-children map for efficient lookups
  const childrenByParent = new Map<string, Node[]>();
  nodes.forEach(node => {
    if (node.parentId) {
      if (!childrenByParent.has(node.parentId)) {
        childrenByParent.set(node.parentId, []);
      }
      childrenByParent.get(node.parentId)!.push(node);
    }
  });

  // Single pass: adjust all node positions
  return nodes.map(node => {
    let nextX = node.position.x;
    let nextWidth = node.style?.width;

    // Child nodes in groups: calculate position based on siblings
    if (node.parentId) {
      const siblings = childrenByParent.get(node.parentId) || [];
      const nodeIndex = siblings.findIndex(s => s.id === node.id);

      let currentX = BRANCH_GROUP_PADDING;
      for (let i = 0; i < nodeIndex; i++) {
        const siblingWidth = nodeWidths[siblings[i].id] || NODE_HEIGHT;
        currentX += siblingWidth + BRANCH_NODE_GAP;
      }

      nextX = currentX;
    }

    // Group nodes: position to the right of main flow, accounting for parent width
    else if (node.type === 'group') {
      // Extract parent node ID from group ID
      const parentId = node.id.replace(/-contribution-subflow$/, '').replace(/-subflow$/, '');
      const parentWidth = nodeWidths[parentId] || NODE_HEIGHT;
      const branchLane = (node.data?.branchLane as number | undefined) ?? 0;
      nextX =
        MAIN_FLOW_X_OFFSET +
        parentWidth +
        BRANCH_NODE_GAP +
        branchLane * BRANCH_LANE_SPACING;

      const childNodes = childrenByParent.get(node.id) || [];

      if (childNodes.length > 0) {
        nextWidth = getGroupWidth(childNodes, nodeWidths);
      }
    }

    // Date nodes have no edges; they sit centered on the line between the messages
    else if (node.type === 'dateNode') {
      nextX = MAIN_FLOW_X_OFFSET + MAIN_FLOW_LINE_X_OFFSET - (nodeWidths[node.id] ?? 0) / 2;
    }

    // Main flow nodes: fixed X offset
    else {
      nextX = MAIN_FLOW_X_OFFSET;
    }

    if (rtl) {
      if (node.parentId) {
        const groupWidth = getGroupWidth(childrenByParent.get(node.parentId) || [], nodeWidths);
        nextX = groupWidth - nextX - (nodeWidths[node.id] || NODE_HEIGHT);
      } else {
        const width = node.type === 'group' ? Number(nextWidth ?? 0) : (nodeWidths[node.id] ?? 0);
        nextX = containerWidth - nextX - width;
      }
    }

    // Reuse the last computed object for this id if nothing has actually
    // changed, even though `node` itself is a fresh placeholder this render.
    // Its data counts: a node that stops being first or last must get its handles.
    // Checked before the guard below, which would return the fresh placeholder.
    const cached = previousNodes.get(node.id);
    const cachedWidthMatches = nextWidth === undefined || cached?.style?.width === nextWidth;

    if (cached && cached.position.x === nextX && cached.position.y === node.position.y && cachedWidthMatches && isShallowEqual(cached.data, node.data)) {
      return cached;
    }

    // Idempotency guard
    const widthUnchanged = nextWidth === undefined || nextWidth === node.style?.width;

    if (nextX === node.position.x && widthUnchanged) {
      return node; // return original reference
    }

    return {
      ...node,
      position: { x: nextX, y: node.position.y },
      ...(nextWidth !== undefined && {
        style: {
          ...node.style,
          width: nextWidth,
        },
      }),
    };
  });
};

type Rect = { x: number; y: number; width: number; height: number };
type Viewport = { x: number; y: number; zoom: number };
type Size = { width: number; height: number };

// Whether the span [start, start + length] in flow coordinates fits in `limit` pixels of the container
const isSpanVisible = (start: number, length: number, offset: number, zoom: number, limit: number) => {
  const screenStart = start * zoom + offset;

  return screenStart >= 0 && screenStart + length * zoom <= limit;
};

/**
 * Where to center the view, in flow coordinates, to bring `rect` into view; null when it is already
 * fully visible. Moves only vertically when the rect is horizontally visible, so the flow doesn't
 * slide sideways (and clip its branches) just to reveal a node further up or down.
 */
export const getRevealCenter = (rect: Rect, viewport: Viewport, container: Size): { x: number; y: number } | null => {
  const horizontallyVisible = isSpanVisible(rect.x, rect.width, viewport.x, viewport.zoom, container.width);
  const verticallyVisible = isSpanVisible(rect.y, rect.height, viewport.y, viewport.zoom, container.height);

  if (horizontallyVisible && verticallyVisible) return null;

  return {
    x: horizontallyVisible ? (container.width / 2 - viewport.x) / viewport.zoom : rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
};

/**
 * Handles node dimension changes and updates the nodeWidths map
 */
export const handleNodeDimensionChange = (
  change: NodeChange,
  prevWidths: Record<string, number>
): Record<string, number> | null => {
  if (change.type === 'dimensions' && change.dimensions) {
    const newWidth = change.dimensions.width;

    // Only update if width actually changed to avoid infinite loops
    if (prevWidths[change.id] === newWidth) {
      return null;
    }

    return {
      ...prevWidths,
      [change.id]: newWidth,
    };
  }

  return null;
};
