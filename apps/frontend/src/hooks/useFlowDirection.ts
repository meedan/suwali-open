import { Direction } from 'radix-ui';
import { Position } from '@xyflow/react';

// React Flow positions are physical, so the flow is mirrored for right-to-left languages:
// branches and contribution flows open towards the inline end, and handles follow
export const useFlowDirection = () => {
  const isRtl = Direction.useDirection() === 'rtl';

  return {
    isRtl,
    inlineStart: isRtl ? Position.Right : Position.Left,
    inlineEnd: isRtl ? Position.Left : Position.Right,
    popoverSide: isRtl ? 'left' : 'right',
  } as const;
};
