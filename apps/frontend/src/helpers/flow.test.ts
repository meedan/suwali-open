import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';

import type { Message } from '@customTypes/message';

import {
  BRANCH_GROUP_PADDING,
  BRANCH_NODE_GAP,
  computeSlotYPositions,
  createBranchFlow,
  DATE_TO_MESSAGE_SPACING,
  getDateSeparatorIndices,
  getRevealCenter,
  MAIN_FLOW_LINE_X_OFFSET,
  MAIN_FLOW_X_OFFSET,
  NODE_SPACING,
  positionNodes,
  type PositionSlot,
  shouldHaveBranch,
} from './flow';

describe('shouldHaveBranch', () => {
  it('returns false for undefined message', () => {
    expect(shouldHaveBranch(undefined)).toBe(false);
  });

  it('returns false for non-branching message states', () => {
    expect(shouldHaveBranch({ state: 'user_message' } as Message)).toBe(false);
  });

  it('returns true when metadata.reasoning is present', () => {
    const msg = { state: 'bot_message', metadata: { reasoning: 'foobar' } } as Message;
    expect(shouldHaveBranch(msg)).toBe(true);
  });

  it('returns true when data_source_items_count and data_source_items are present', () => {
    const msg = { state: 'bot_message', data_source_items_count: 1, data_source_items: [{}] } as Message;
    expect(shouldHaveBranch(msg)).toBe(true);
  });
});

describe('createBranchFlow', () => {
  it('creates branch nodes and edges for reasoning and data_source_items', () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const nextMsg = {
      state: 'bot_message',
      metadata: { reasoning: 'blabla' },
      data_source_items_count: 2,
      data_source_items: [{ id: 1 }, { id: 2 }],
    } as Message;

    createBranchFlow('msg-2', nextMsg, 'msg-3', 120, nodes, edges);

    const subFlowId = 'msg-2-subflow';

    // Group node created
    const groupNode = nodes.find(n => n.id === subFlowId && n.type === 'group');
    expect(groupNode).toBeDefined();

    // Branch nodes created and attached to group
    const branch0 = nodes.find(n => n.id === 'msg-2-branch-0');
    const branch1 = nodes.find(n => n.id === 'msg-2-branch-1');
    expect(branch0).toBeDefined();
    expect(branch1).toBeDefined();
    expect(branch0?.parentId).toBe(subFlowId);
    expect(branch1?.parentId).toBe(subFlowId);

    // Entry edge from source message to first branch node
    const entryEdge = edges.find(e => e.id === 'edge-msg-2-to-branch-entry');
    expect(entryEdge).toBeDefined();
    expect(entryEdge?.source).toBe('msg-2');
    expect(entryEdge?.target).toBe('msg-2-branch-0');

    // Chain edge between branch nodes
    const expectedChainId = 'edge-branch-chain-msg-2-branch-0-to-msg-2-branch-1';
    const chainEdge = edges.find(e => e.id === expectedChainId);
    expect(chainEdge).toBeDefined();

    // Exit edge from last branch node to the next message's node id
    const exitEdgeId = 'edge-branch-exit-msg-2-branch-1-to-msg-3';
    const exitEdge = edges.find(e => e.id === exitEdgeId);
    expect(exitEdge).toBeDefined();
    expect(exitEdge?.source).toBe('msg-2-branch-1');
    expect(exitEdge?.target).toBe('msg-3');
  });

  it('creates branch nodes and edges for rewritten_question', () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const nextMsg = {
      state: 'bot_message',
      metadata: { rewritten_question: 'what is this?' },
    } as Message;

    createBranchFlow('msg-1', nextMsg, 'msg-2', 100, nodes, edges);

    const subFlowId = 'msg-1-subflow';

    // Group node created
    const groupNode = nodes.find(n => n.id === subFlowId && n.type === 'group');
    expect(groupNode).toBeDefined();

    // Single branch node created and attached to group
    const branch0 = nodes.find(n => n.id === 'msg-1-branch-0');
    expect(branch0).toBeDefined();
    expect(branch0?.parentId).toBe(subFlowId);
    expect(branch0?.data?.type).toBe('rewriter');
    expect(branch0?.data?.metadata).toEqual(nextMsg.metadata);
    expect(branch0?.data?.isFirst).toBe(true);
    expect(branch0?.data?.isLast).toBe(true);

    // Entry edge from source message to first branch node
    const entryEdge = edges.find(e => e.id === 'edge-msg-1-to-branch-entry');
    expect(entryEdge).toBeDefined();
    expect(entryEdge?.source).toBe('msg-1');
    expect(entryEdge?.target).toBe('msg-1-branch-0');

    // No chain edge should exist for a single branch node
    const chainEdge = edges.find(e => e.id?.startsWith('edge-branch-chain-'));
    expect(chainEdge).toBeUndefined();

    // Exit edge from last branch node to the next message's node id
    const exitEdgeId = 'edge-branch-exit-msg-1-branch-0-to-msg-2';
    const exitEdge = edges.find(e => e.id === exitEdgeId);
    expect(exitEdge).toBeDefined();
    expect(exitEdge?.source).toBe('msg-1-branch-0');
    expect(exitEdge?.target).toBe('msg-2');
  });

  it('creates direct edge between source and target when there are no branch nodes to create', () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const nextMsg = { state: 'bot_message' } as Message;

    createBranchFlow('msg-0', nextMsg, 'msg-1', 100, nodes, edges);

    expect(nodes.length).toBe(0);
    expect(edges.length).toBe(1);
  });
});

describe('computeSlotYPositions', () => {
  const slots = (keys: string[]): PositionSlot[] =>
    keys.map(key => ({ key }));

  it('lays out slots top-to-bottom on a fresh load with no previous positions', () => {
    const positions = computeSlotYPositions(slots(['a', 'b', 'c']), new Map(), 1000);

    expect(positions.get('b')! - positions.get('a')!).toBe(NODE_SPACING);
    expect(positions.get('c')! - positions.get('b')!).toBe(NODE_SPACING);
  });

  it('does not move an already-positioned slot when a new slot is appended after it', () => {
    const previous = new Map([['a', 500], ['b', 590]]);

    const positions = computeSlotYPositions(slots(['a', 'b', 'c']), previous, 1000);

    expect(positions.get('a')).toBe(500);
    expect(positions.get('b')).toBe(590);
    expect(positions.get('c')).toBe(590 + NODE_SPACING);
  });

  it('does not move an already-positioned slot when a new slot is prepended before it', () => {
    const previous = new Map([['b', 590], ['c', 680]]);

    const positions = computeSlotYPositions(slots(['a', 'b', 'c']), previous, 1000);

    expect(positions.get('b')).toBe(590);
    expect(positions.get('c')).toBe(680);
    expect(positions.get('a')).toBe(590 - NODE_SPACING);
  });

  describe('with a slot that has its own spacing', () => {
    const withDate: PositionSlot[] = [
      { key: 'a' },
      { key: 'date' },
      { key: 'b', spacing: DATE_TO_MESSAGE_SPACING },
    ];

    it('uses it on a fresh load', () => {
      const positions = computeSlotYPositions(withDate, new Map(), 1000);

      expect(positions.get('date')! - positions.get('a')!).toBe(NODE_SPACING);
      expect(positions.get('b')! - positions.get('date')!).toBe(DATE_TO_MESSAGE_SPACING);
    });

    it('uses it when extending forward from an anchor', () => {
      const positions = computeSlotYPositions(withDate, new Map([['a', 500], ['date', 590]]), 1000);

      expect(positions.get('b')).toBe(590 + DATE_TO_MESSAGE_SPACING);
    });

    it('uses it when extending backward from an anchor', () => {
      const positions = computeSlotYPositions(withDate, new Map([['b', 700]]), 1000);

      expect(positions.get('date')).toBe(700 - DATE_TO_MESSAGE_SPACING);
      expect(positions.get('a')).toBe(700 - DATE_TO_MESSAGE_SPACING - NODE_SPACING);
    });
  });

  it('returns an empty map for no slots', () => {
    expect(computeSlotYPositions([], new Map(), 1000).size).toBe(0);
  });
});

describe('getDateSeparatorIndices', () => {
  const at = (day: number, hour: number) => ({ created_at: new Date(2026, 9, day, hour).toISOString() } as Message);

  it('marks the first message and each message that starts a new day', () => {
    const messages = [at(27, 9), at(27, 17), at(28, 8), at(30, 8), at(30, 9)];

    expect([...getDateSeparatorIndices(messages, new Set())]).toEqual([0, 2, 3]);
  });

  it('skips the first message when older messages are not loaded, since its day may have started earlier', () => {
    const messages = [at(27, 9), at(28, 8), at(28, 9)];

    expect([...getDateSeparatorIndices(messages, new Set(), true)]).toEqual([1]);
  });

  it('treats the first main-flow message as the first one, even if a contribution message precedes it', () => {
    const messages = [at(27, 9), at(28, 9), at(28, 10)];

    expect([...getDateSeparatorIndices(messages, new Set([0]), true)]).toEqual([]);
  });

  it('returns nothing without messages', () => {
    expect(getDateSeparatorIndices([], new Set()).size).toBe(0);
  });

  it('compares against the previous main-flow message, skipping contribution flow messages', () => {
    const messages = [at(27, 9), at(28, 9), at(28, 10)];

    expect([...getDateSeparatorIndices(messages, new Set([1]))]).toEqual([0, 2]);
  });
});

describe('positionNodes', () => {
  it('centers a date node on the line through the main flow nodes', () => {
    const nodes: Node[] = [
      { id: 'msg-1', type: 'messageNode', position: { x: 0, y: 0 }, data: {} },
      { id: 'date-1', type: 'dateNode', position: { x: 0, y: 40 }, data: {} },
    ];

    const positioned = positionNodes(nodes, { 'date-1': 80 });

    expect(positioned[0].position.x).toBe(MAIN_FLOW_X_OFFSET);
    expect(positioned[1].position.x).toBe(MAIN_FLOW_X_OFFSET + MAIN_FLOW_LINE_X_OFFSET - 40);
  });
});

describe('positionNodes node reuse', () => {
  const buildNode = (data: Record<string, unknown>): Node => (
    { id: 'msg-1', type: 'messageNode', position: { x: MAIN_FLOW_X_OFFSET, y: 0 }, data }
  );

  it('returns the previous object for an unchanged main flow node', () => {
    const [first] = positionNodes([buildNode({ isLast: false })], {});
    const [second] = positionNodes([buildNode({ isLast: false })], {}, new Map([[first.id, first]]));

    expect(second).toBe(first);
  });

  it('returns a new object when the node data changes', () => {
    const [first] = positionNodes([buildNode({ isLast: false })], {});
    const [second] = positionNodes([buildNode({ isLast: true })], {}, new Map([[first.id, first]]));

    expect(second).not.toBe(first);
  });

  it('returns a new object when the node moves vertically', () => {
    const [first] = positionNodes([buildNode({})], {});
    const moved = { ...buildNode({}), position: { x: MAIN_FLOW_X_OFFSET, y: 50 } };
    const [second] = positionNodes([moved], {}, new Map([[first.id, first]]));

    expect(second).not.toBe(first);
  });
});

describe('positionNodes right-to-left', () => {
  const rtl = { rtl: true, containerWidth: 1000 };

  it('mirrors main flow nodes so their right edges line up', () => {
    const nodes: Node[] = [
      { id: 'a', type: 'messageNode', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'messageNode', position: { x: 0, y: 90 }, data: {} },
    ];

    const positioned = positionNodes(nodes, { a: 200, b: 120 }, new Map(), rtl);

    expect(positioned[0].position.x + 200).toBe(1000 - MAIN_FLOW_X_OFFSET);
    expect(positioned[1].position.x + 120).toBe(1000 - MAIN_FLOW_X_OFFSET);
  });

  it('keeps the date node centered on the mirrored line', () => {
    const nodes: Node[] = [{ id: 'date-1', type: 'dateNode', position: { x: 0, y: 0 }, data: {} }];

    const [date] = positionNodes(nodes, { 'date-1': 80 }, new Map(), rtl);

    expect(date.position.x + 40).toBe(1000 - MAIN_FLOW_X_OFFSET - MAIN_FLOW_LINE_X_OFFSET);
  });

  it('places a group on the opposite side of its parent and orders its children right to left', () => {
    const nodes: Node[] = [
      { id: 'msg-1', type: 'messageNode', position: { x: 0, y: 0 }, data: {} },
      { id: 'msg-1-subflow', type: 'group', position: { x: 0, y: 0 }, data: {}, style: { width: 0 } },
      { id: 'c0', type: 'branchNode', parentId: 'msg-1-subflow', position: { x: 0, y: 0 }, data: {} },
      { id: 'c1', type: 'branchNode', parentId: 'msg-1-subflow', position: { x: 0, y: 0 }, data: {} },
    ];
    const widths = { 'msg-1': 200, c0: 100, c1: 100 };

    const [parent, group, first, second] = positionNodes(nodes, widths, new Map(), rtl);
    const groupWidth = group.style!.width as number;

    // The group's right edge sits a gap away from the parent's left edge
    expect(group.position.x + groupWidth).toBe(parent.position.x - BRANCH_NODE_GAP);
    // The first child is at the group's inline start, now its right side
    expect(first.position.x).toBeGreaterThan(second.position.x);
    expect(first.position.x + 100).toBe(groupWidth - BRANCH_GROUP_PADDING);
  });

  it('does not reuse a previous node whose data changed, such as one that stops being first when older messages load', () => {
    const before: Node[] = [{ id: 'a', type: 'messageNode', position: { x: 0, y: 0 }, data: { isFirst: true } }];
    const widths = { a: 200 };
    const cache = new Map(positionNodes(before, widths, new Map(), rtl).map(node => [node.id, node]));

    const after: Node[] = [{ id: 'a', type: 'messageNode', position: { x: 0, y: 0 }, data: { isFirst: false } }];
    const [node] = positionNodes(after, widths, cache, rtl);

    expect(node.data.isFirst).toBe(false);
  });

  it('reuses the previous node when its position and data are unchanged', () => {
    const nodes: Node[] = [{ id: 'a', type: 'messageNode', position: { x: 0, y: 0 }, data: { isFirst: true } }];
    const widths = { a: 200 };
    const cache = new Map(positionNodes(nodes, widths, new Map(), rtl).map(node => [node.id, node]));

    const [node] = positionNodes(
      [{ id: 'a', type: 'messageNode', position: { x: 0, y: 0 }, data: { isFirst: true } }],
      widths,
      cache,
      rtl
    );

    expect(node).toBe(cache.get('a'));
  });
});

describe('getRevealCenter', () => {
  const container = { width: 400, height: 300 };
  const rect = { x: 50, y: 100, width: 100, height: 50 };

  it('is null when the rect is fully inside the container', () => {
    expect(getRevealCenter(rect, { x: 0, y: 0, zoom: 1 }, container)).toBeNull();
  });

  it('centers vertically and keeps the horizontal position when only the vertical position is off', () => {
    // The view is panned 30px right, so its horizontal center is at flow x = (200 - 30) / 1
    expect(getRevealCenter(rect, { x: 30, y: 200, zoom: 1 }, container)).toEqual({ x: 170, y: 125 });
  });

  it('centers on the rect when it is horizontally out of view too', () => {
    expect(getRevealCenter(rect, { x: -80, y: 200, zoom: 1 }, container)).toEqual({ x: 100, y: 125 });
  });

  it('treats a partly cut off rect as out of view', () => {
    expect(getRevealCenter(rect, { x: 0, y: -120, zoom: 1 }, container)).not.toBeNull();
  });

  it('accounts for the pan and zoom', () => {
    // 200 * 2 + 0 = 400 on screen, past the 300px height
    expect(getRevealCenter({ ...rect, y: 200 }, { x: 0, y: 0, zoom: 2 }, container)).not.toBeNull();
    expect(getRevealCenter({ ...rect, y: 200 }, { x: 0, y: -300, zoom: 2 }, container)).toBeNull();
  });
});
