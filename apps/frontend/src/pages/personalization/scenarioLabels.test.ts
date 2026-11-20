import { describe, expect, it } from 'vitest';

import { scenarioGroups, scenarios } from './scenarioLabels';

describe('scenarioLabels', () => {
  it('puts every scenario in exactly one group, so each can be chosen in the form', () => {
    const grouped = scenarioGroups.flatMap(({ scenarios }) => scenarios);

    expect([...grouped].sort()).toEqual([...scenarios].sort());
  });
});
