import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useDebounce } from 'use-debounce';
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react';

import type { Message } from '@customTypes/message';

import { PAGINATION_WINDOW_SIZE } from '@constants/App';

import {
  collectContributionMessages,
  computeSlotYPositions,
  createBranchFlow,
  createContributionFlow,
  DATE_TO_MESSAGE_SPACING,
  getDateSeparatorIndices,
  getNodeType,
  getRevealCenter,
  handleNodeDimensionChange,
  MAIN_FLOW_X_OFFSET,
  MESSAGE_NODE_OUTER_HEIGHT,
  NODE_SPACING,
  positionNodes,
  type PositionSlot,
  shouldHaveBranch,
} from '@helpers/flow';
import { prefersReducedMotion } from '@helpers/motion';

import { fetchMessagesPaginated } from '@services/ConversationsService';

import { useMessageHighlight } from '@contexts/MessageSelectContext';

import { useBidirectionalInfiniteScroll } from '@hooks/useBidirectionalInfiniteScroll';
import { useFlowDirection } from '@hooks/useFlowDirection';

import { useTheme } from '@components/ThemeProvider';

import styles from './ConversationFlow.module.css';
import BranchNode from './flow/BranchNode';
import ContributionNode from './flow/ContributionNode';
import DateNode from './flow/DateNode';
import LoadMoreNode from './flow/LoadMoreNode';
import MessageNode from './flow/MessageNode';

import '@styles/vendor-xyflow.css';

const nodeTypes = {
  branchNode: BranchNode,
  messageNode: MessageNode,
  contributionNode: ContributionNode,
  dateNode: DateNode,
  loadMoreNode: LoadMoreNode,
};

const ConversationFlow = ({ className }: { className?: string }) => {
  const params = useParams();
  const conversationId = params.conversationId || null;
  const { highlightMessageId, clearMessageHighlight } = useMessageHighlight();
  const { theme } = useTheme();
  const { isRtl } = useFlowDirection();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 0 means "not yet measured" — see the containerHeight > 0 guard around
  // positionCacheRef below, which avoids permanently caching positions
  // computed against this placeholder before the real size is known.
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(300);
  const [nodeWidths, setNodeWidths] = useState<Record<string, number>>({});
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  // The highlight from a permalink is centered by the logic below, so only later changes are revealed here
  const revealedHighlightIdRef = useRef<number | null>(highlightMessageId);
  const prevOldestMessageRef = useRef<Message | null>(null);
  const prevNewestMessageRef = useRef<Message | null>(null);
  // Set by the load more nodes: the end that should grow and the message there now
  const userLoadRef = useRef<{ edge: 'oldest' | 'newest'; id: number } | null>(null);
  // Keyed by stable message id (never array index), so a node already on
  // screen never moves when more history loads before or after it.
  const positionCacheRef = useRef<Map<string, number>>(new Map());
  // Last correctly-positioned node object per id, so group/branch/contribution
  // nodes (whose x/width depend on measured widths) stay reference-stable
  // across unrelated width measurements and pagination — see positionNodes.
  const positionedNodeCacheRef = useRef<Map<string, Node>>(new Map());

  const [searchParams] = useSearchParams();
  const parsedMessageId = Number.parseInt(searchParams.get('messageId') ?? '', 10);
  const initialAroundId = Number.isSafeInteger(parsedMessageId) ? parsedMessageId : null;

  const [centerAroundId, setCenterAroundId] = useState<number | null>(initialAroundId);

  const messagesQuery = useBidirectionalInfiniteScroll<Message>({
    queryKey: [`/conversations/${conversationId}/messages`],
    queryFn: (aroundId, windowSize) => fetchMessagesPaginated(conversationId!, aroundId, windowSize, 'created_at', 'desc'),
    initialAroundId, // Backend should resolve to latest message when null
    windowSize: PAGINATION_WINDOW_SIZE,
    enabled: Boolean(conversationId),
  });

  // Debounce so rapid scroll-triggered pagination in the messages panel doesn't
  // thrash the flow layout and camera pan on every intermediate fetch.
  // `leading: true` keeps the initial load (and the first fetch of any new
  // scroll burst) instant, only coalescing the rapid updates that follow.
  const [debouncedItems] = useDebounce(messagesQuery.items, 500, { leading: true });

  const messages = useMemo<Message[]>(() => [...debouncedItems].reverse(), [debouncedItems]);

  const { fetchNext, fetchPrevious } = messagesQuery;

  // Messages the user asks for load in place, so the view they chose isn't panned or re-zoomed
  const loadEarlier = useCallback(() => {
    userLoadRef.current = { edge: 'oldest', id: messages[0].id };
    fetchNext();
  }, [messages, fetchNext]);

  const loadNewer = useCallback(() => {
    userLoadRef.current = { edge: 'newest', id: messages[messages.length - 1].id };
    fetchPrevious();
  }, [messages, fetchPrevious]);

  // Pre-calculate branch status for all messages to avoid repeated checks
  const messageBranchStatus = useMemo(
    () => messages.map(msg => shouldHaveBranch(msg)),
    [messages]
  );

  useEffect(() => {
    if (!wrapperRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height, width } = entry.contentRect;
        setContainerHeight(height);
        setContainerWidth(width);
      }
    });

    resizeObserver.observe(wrapperRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const flow = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    if (messages.length === 0) {
      return { nodes, edges };
    }

    const messageCount = messages.length;

    // Tracks horizontal lanes occupied by unanswered questions.
    // A lane is released when the corresponding question receives a reply.
    const occupiedBranchLanes = new Set<number>();
    const branchLaneByMessageId = new Map<number, number>();

    const allocateBranchLane = (): number => {
      let lane = 0;

      while (occupiedBranchLanes.has(lane)) {
        lane++;
      }

      occupiedBranchLanes.add(lane);
      return lane;
    };

    const releaseBranchLane = (lane: number): void => {
      occupiedBranchLanes.delete(lane);
    };

    messages.forEach((msg) => {
      if (msg.reply_to_id) {
        const lane = branchLaneByMessageId.get(msg.reply_to_id);

        if (lane !== undefined) {
          releaseBranchLane(lane);
        }
      }

      const hasResponse = messages.some(
        response => response.reply_to_id === msg.id
      );

      if (hasResponse) {
        const lane = allocateBranchLane();
        branchLaneByMessageId.set(msg.id, lane);
      }
    });

    // Track which message indices are in contribution flows (should be skipped in main flow)
    const contributionFlowIndices = new Set<number>();
    // Messages a contribution flow loops back into, which need a handle on their right side
    const contributionExitIndices = new Set<number>();

    // Pre-scan: identify contribution flow messages
    messages.forEach((msg, index) => {
      if (msg.state === 'user_contribution_started') {
        // Collect contribution flow messages after this user_contribution_started
        const { nextIndex } = collectContributionMessages(messages, index + 1);

        // Mark all contribution indices to skip in main flow
        for (let i = index + 1; i < nextIndex; i++) {
          contributionFlowIndices.add(i);
        }

        if (nextIndex > index + 1 && nextIndex < messages.length) {
          contributionExitIndices.add(nextIndex);
        }
      }
    });

    const dateSeparatorIndices = getDateSeparatorIndices(messages, contributionFlowIndices, messagesQuery.hasNext);
    const dateNodeId = (msg: Message) => `date-${msg.id}`;
    const firstMainFlowIndex = messages.findIndex((_, index) => !contributionFlowIndices.has(index));

    // Build the ordered list of vertical rows that need a Y position, keyed by
    // stable message id (not array index) so a row already on screen never
    // moves when more history loads before or after it.
    const slots: PositionSlot[] = [];

    messages.forEach((msg, index) => {
      if (contributionFlowIndices.has(index)) return;

      const hasDateNode = dateSeparatorIndices.has(index);

      if (hasDateNode) {
        slots.push({ key: dateNodeId(msg) });
      }

      slots.push({
        key: `msg-${msg.id}`,
        ...(hasDateNode && { spacing: DATE_TO_MESSAGE_SPACING }),
      });

      if (msg.state === 'user_contribution_started') {
        slots.push({ key: `synthetic-${msg.id}` });
      }
    });

    // No cached slot means a jump replaced the window; the old window's positions would overlap the new one later
    if (!slots.some(slot => positionCacheRef.current.has(slot.key))) {
      positionCacheRef.current.clear();
    }

    const slotPositions = computeSlotYPositions(slots, positionCacheRef.current, containerHeight);

    // Don't persist positions computed against containerHeight before it's
    // been measured for real — otherwise they'd be locked in permanently.
    if (containerHeight > 0) {
      slotPositions.forEach((y, key) => positionCacheRef.current.set(key, y));
    }

    /**
     * Determines the source node ID for a main flow edge
     * Returns null if the edge should be skipped (handled by another flow)
     */
    const getMainFlowEdgeSource = (currentIndex: number): string | null => {
      if (currentIndex === 0) return null;

      const previousIndex = currentIndex - 1;

      // If previous message is in a contribution flow, edge is handled by createContributionFlow
      if (contributionFlowIndices.has(previousIndex)) {
        return null;
      }

      const previousMsg = messages[previousIndex];

      // If previous message started a contribution flow, connect from its synthetic node
      if (previousMsg.state === 'user_contribution_started') {
        return `synthetic-${previousMsg.id}`;
      }

      // Standard case: connect from previous message
      return `msg-${previousMsg.id}`;
    };

    messages.forEach((msg: Message, index: number) => {
      // Skip messages that are in contribution flows
      if (contributionFlowIndices.has(index)) {
        return;
      }

      const currentMessageHasBranch = messageBranchStatus[index];
      const nodeId = `msg-${msg.id}`;
      const yPosition = slotPositions.get(nodeId)!;

      const nextMsgIndex = messages.findIndex(m => m.reply_to_id === msg.id);
      const nextMsg = nextMsgIndex && messages[nextMsgIndex];
      // The branch edge comes from the replied-to message, so without a loaded parent there is nothing to attach to
      const parentLoaded = Boolean(msg.reply_to_id) && messages.some(m => m.id === msg.reply_to_id);
      const hasBranch = Boolean(nextMsg) || (currentMessageHasBranch && parentLoaded);
      const nextNodeId = nextMsg ? `msg-${nextMsg.id}` : null;

      const hasDateNode = dateSeparatorIndices.has(index);
      const dateNodeStartsFlow = hasDateNode && index === firstMainFlowIndex;

      if (hasDateNode) {
        nodes.push({
          id: dateNodeId(msg),
          position: { x: MAIN_FLOW_X_OFFSET, y: slotPositions.get(dateNodeId(msg))! },
          data: {
            date: msg.created_at,
            isFirst: dateNodeStartsFlow,
          },
          type: 'dateNode',
        });
      }

      // Create the main message node
      nodes.push({
        id: nodeId,
        position: { x: MAIN_FLOW_X_OFFSET, y: yPosition },
        data: {
          id: msg.id,
          body: msg.body,
          type: msg.state,
          isFirst: index === 0 && !hasDateNode && !messagesQuery.hasNext,
          isLast: index === messageCount - 1 && msg.state !== 'user_contribution_started' && !messagesQuery.hasPrevious,
          hasBranch: hasBranch,
          hasContributionExit: contributionExitIndices.has(index),
          metadata: msg.metadata,
          dataSourceItems: msg.data_source_items,
          dataSourceItemsCount: msg.data_source_items_count,
          topics: msg.topic_names,
          messageObject: msg,
        },
        type: getNodeType(msg.state),
      });

      if (dateNodeStartsFlow) {
        edges.push({
          id: `edge-main-${dateNodeId(msg)}-to-${nodeId}`,
          source: dateNodeId(msg),
          target: nodeId,
          sourceHandle: 'bottom-source',
        });
      }

      // Handle edges for main flow (only if current message doesn't have its own branch handling)
      const sourceId = getMainFlowEdgeSource(index);

      if (sourceId) {
        edges.push({
          id: `edge-main-${sourceId}-to-${nodeId}`,
          source: sourceId,
          target: nodeId,
          sourceHandle: 'bottom-source',
        });
      }

      // If this is a user_contribution_started, inject a synthetic processing node and contribution flow
      if (msg.state === 'user_contribution_started') {
        const syntheticId = `synthetic-${msg.id}`;
        const syntheticYPosition = slotPositions.get(syntheticId)!;

        // Collect contribution flow messages using helper
        const { contributionMessages, nextIndex } = collectContributionMessages(messages, index + 1);

        const hasContributionFlow = contributionMessages.length > 0;
        const afterContributionNodeId = nextIndex < messages.length ? `msg-${messages[nextIndex].id}` : null;

        nodes.push({
          id: syntheticId,
          position: { x: MAIN_FLOW_X_OFFSET, y: syntheticYPosition },
          data: {
            body: '',
            type: 'contribution_processing',
            isFirst: false,
            isLast: !afterContributionNodeId && !messagesQuery.hasPrevious,
            hasBranch: hasContributionFlow,
            metadata: null,
          },
          type: 'messageNode',
        });

        // Edge from user_contribution_started to synthetic processing node
        edges.push({
          id: `edge-${nodeId}-to-${syntheticId}`,
          source: nodeId,
          target: syntheticId,
        });

        // The main flow continues straight down, like it does past a branch
        if (afterContributionNodeId) {
          edges.push({
            id: `edge-${syntheticId}-to-${afterContributionNodeId}`,
            source: syntheticId,
            sourceHandle: 'bottom-source',
            target: afterContributionNodeId,
          });
        }

        // Create contribution flow if there are contribution messages
        if (hasContributionFlow) {
          createContributionFlow(
            syntheticId,
            contributionMessages,
            syntheticYPosition,
            nodes,
            edges,
            afterContributionNodeId
          );
        }
      }

      if (hasBranch && nextMsg) {
        createBranchFlow(
          nodeId,
          nextMsg,
          nextNodeId,
          yPosition,
          nodes,
          edges,
          branchLaneByMessageId.get(msg.id) ?? 0,
        );
      }
    });

    // Messages are fetched newest-first, so older ones are the "next" page
    if (slots.length > 0) {
      const firstKey = `msg-${messages[firstMainFlowIndex].id}`;
      const lastKey = slots[slots.length - 1].key;

      if (messagesQuery.hasNext) {
        const id = 'load-earlier';

        nodes.unshift({
          id,
          position: { x: MAIN_FLOW_X_OFFSET, y: slotPositions.get(firstKey)! - NODE_SPACING },
          data: { direction: 'earlier', loading: messagesQuery.isLoadingNext, onClick: loadEarlier },
          type: 'loadMoreNode',
        });
        edges.push({ id: `edge-${id}-to-${firstKey}`, source: id, target: firstKey, sourceHandle: 'bottom-source' });
      }

      if (messagesQuery.hasPrevious) {
        const id = 'load-newer';

        nodes.push({
          id,
          position: { x: MAIN_FLOW_X_OFFSET, y: slotPositions.get(lastKey)! + NODE_SPACING },
          data: { direction: 'newer', loading: messagesQuery.isLoadingPrevious, onClick: loadNewer },
          type: 'loadMoreNode',
        });
        edges.push({ id: `edge-${lastKey}-to-${id}`, source: lastKey, target: id, sourceHandle: 'bottom-source' });
      }
    }

    return { nodes, edges };
  }, [
    messages,
    containerHeight,
    messageBranchStatus,
    messagesQuery.hasNext,
    messagesQuery.hasPrevious,
    messagesQuery.isLoadingNext,
    messagesQuery.isLoadingPrevious,
    loadEarlier,
    loadNewer,
  ]);

  const positionedFlow = useMemo(() => {
    if (flow.nodes.length === 0) {
      return flow;
    }

    const nodes = positionNodes(
      flow.nodes,
      nodeWidths,
      positionedNodeCacheRef.current,
      { rtl: isRtl, containerWidth }
    );

    positionedNodeCacheRef.current = new Map(nodes.map(node => [node.id, node]));

    return {
      nodes,
      edges: flow.edges,
    };
  }, [flow, nodeWidths, isRtl, containerWidth]);

  const centerViewOnNode = useCallback((targetNode: Node | null) => {
    const instance = reactFlowInstanceRef.current;

    if (targetNode?.position) {
      // Keep the user's zoom; a linear pan avoids the zoom-out arc of the default smooth interpolation
      instance?.setCenter(
        containerWidth / 2,
        targetNode.position.y,
        {
          zoom: instance.getZoom(),
          duration: prefersReducedMotion() ? 0 : 800,
          interpolate: 'linear',
        }
      );
      setCenterAroundId(null);
    }
  }, [containerWidth]);

  // Center the view on the oldest-before-pageload message when older messages are loaded
  // or on the message specified by the messageId query param on initial load
  useEffect(() => {
    if (messages.length === 0 || positionedFlow.nodes.length === 0) return;

    const oldestMessage = messages[0];
    const newestMessage = messages[messages.length - 1];
    const prevOldestMessage = prevOldestMessageRef.current;
    const prevNewestMessage = prevNewestMessageRef.current;
    prevOldestMessageRef.current = oldestMessage;
    prevNewestMessageRef.current = newestMessage;
    let targetNode: Node | null = null;

    const userLoad = userLoadRef.current;
    const loadedInPlace = Boolean(userLoad) && (userLoad!.edge === 'oldest' ? oldestMessage.id !== userLoad!.id : newestMessage.id !== userLoad!.id);
    if (loadedInPlace) userLoadRef.current = null;

    if (centerAroundId) {
      targetNode = positionedFlow.nodes.find(node => node.data.id === centerAroundId) ?? null;
    } else if (prevOldestMessage && prevNewestMessage && oldestMessage.id !== prevOldestMessage.id && newestMessage.id !== prevNewestMessage.id) {
      // Both ends moved, so the window was replaced by a jump rather than extended by pagination
      if (new Date(newestMessage.created_at) < new Date(prevNewestMessage.created_at)) {
        // Show the start of the flow in the upper part of the view, in line with the messages panel
        const top = Math.min(...positionedFlow.nodes.filter(node => !node.parentId).map(node => node.position.y));
        const instance = reactFlowInstanceRef.current;
        const zoom = instance?.getZoom() ?? 1;

        // The view's half height in flow units shrinks as the user zooms in
        instance?.setCenter(containerWidth / 2, top + (containerHeight / 2 / zoom) - NODE_SPACING, { zoom, duration: prefersReducedMotion() ? 0 : 800, interpolate: 'linear' });
      } else {
        targetNode = positionedFlow.nodes.find(node => node.data.id === newestMessage.id) ?? null;
      }
    } else if (loadedInPlace) {
      // The user loaded these from a load more node, so leave the camera where they put it
    } else if (prevOldestMessage && oldestMessage.id !== prevOldestMessage.id) {
      const previousOldestNode = positionedFlow.nodes.find(node => node.data.id === prevOldestMessage.id);
      targetNode = previousOldestNode || positionedFlow.nodes[0];
    } else if (prevNewestMessage && newestMessage.id !== prevNewestMessage.id) {
      const previousNewestNode = positionedFlow.nodes.find(node => node.data.id === prevNewestMessage.id);
      targetNode = previousNewestNode || positionedFlow.nodes[positionedFlow.nodes.length - 1];
    }

    if (targetNode) {
      centerViewOnNode(targetNode);
    }
  }, [messages, positionedFlow.nodes, centerAroundId, centerViewOnNode, containerWidth, containerHeight]);

  // Bring a message highlighted from the conversation into view, keeping the user's zoom
  useEffect(() => {
    if (highlightMessageId === null) {
      revealedHighlightIdRef.current = null;
      return;
    }

    if (revealedHighlightIdRef.current === highlightMessageId) return;

    const instance = reactFlowInstanceRef.current;
    const node = positionedFlow.nodes.find(n => n.data.id === highlightMessageId);
    const internalNode = node && instance?.getInternalNode(node.id);

    // A hidden flow has no size to reveal anything in; this runs again once it is shown
    if (containerHeight === 0) return;

    // The node may not exist or be measured yet; this runs again when the flow updates
    const width = node && nodeWidths[node.id];

    if (!instance || !internalNode || !width) return;

    revealedHighlightIdRef.current = highlightMessageId;

    // React Flow's own `measured` stays empty here, as node changes are not applied back to the nodes
    const { x, y } = internalNode.internals.positionAbsolute;
    const height = MESSAGE_NODE_OUTER_HEIGHT;
    const center = getRevealCenter({ x, y, width, height }, instance.getViewport(), { width: containerWidth, height: containerHeight });

    if (center) {
      instance.setCenter(center.x, center.y, { zoom: instance.getZoom(), duration: prefersReducedMotion() ? 0 : 800, interpolate: 'linear' });
    }
  }, [highlightMessageId, positionedFlow.nodes, nodeWidths, containerWidth, containerHeight]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((change) => {
        setNodeWidths((prevWidths) => {
          const updated =
            handleNodeDimensionChange(
              change,
              prevWidths
            );

          return updated ?? prevWidths;
        });
      });
    },
    []
  );

  const onPaneClick = useCallback(() => {
    clearMessageHighlight();
  }, [clearMessageHighlight]);

  return (
    <div className={clsx(styles.wrapper, className)} ref={wrapperRef}>
      <ReactFlow
        colorMode={theme}
        nodes={positionedFlow.nodes}
        edges={positionedFlow.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onPaneClick={onPaneClick}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        maxZoom={3}
        minZoom={0.35}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        edgesFocusable={false}
        nodesConnectable={false}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Background className={styles.flowBackground} patternClassName={styles.flowBackgroundPattern} gap={20} size={2} variant={BackgroundVariant.Dots} />
        <Controls orientation="horizontal" showInteractive={false} position={isRtl ? 'bottom-left' : 'bottom-right'} />
      </ReactFlow>
    </div>
  );
};

export default ConversationFlow;
