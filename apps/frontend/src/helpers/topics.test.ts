import { describe, expect, it } from 'vitest';

import type { TopTopic } from '@services/HubService';

import { selectGapTopic } from './topics';

const topic = (id: number, name: string, asks: number, documents: number): TopTopic => ({
  id,
  name,
  messages: { '2026-07-01': 1, '2026-08-01': asks },
  data_source_items: { '2026-07-01': 1, '2026-08-01': documents },
});

describe('selectGapTopic', () => {
  it('returns undefined when there are no topics', () => {
    expect(selectGapTopic([])).toBeUndefined();
  });

  it('picks the thinnest coverage among the most asked topics', () => {
    const thin = topic(2, 'Thinly covered', 90, 1);

    expect(selectGapTopic([
      topic(1, 'Well covered', 100, 10),
      thin,
      topic(3, 'Rarely asked', 5, 1),
    ])).toBe(thin);
  });
});
