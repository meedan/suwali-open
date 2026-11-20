import { createIntl } from 'react-intl';
import type { TooltipPayloadEntry } from 'recharts';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { calculateYAxisDomain, makeCountTooltipFormatter } from './chart';

const intl = createIntl({ locale: 'en' });
const entry = (dataKey: string) => ({ dataKey }) as TooltipPayloadEntry;

describe('calculateYAxisDomain', () => {
  it('returns 1 when dataMax is 0 to avoid an empty chart', () => {
    expect(calculateYAxisDomain(0)).toBe(1);
  });

  it('returns ceil(dataMax * 1.1) to add padding above the max value', () => {
    expect(calculateYAxisDomain(10)).toBe(11);
  });

  it('rounds up to the nearest integer', () => {
    expect(calculateYAxisDomain(9)).toBe(10); // 9 * 1.1 = 9.9 → ceil → 10
    expect(calculateYAxisDomain(91)).toBe(101); // 91 * 1.1 = 100.1 → ceil → 101
  });
});

describe('makeCountTooltipFormatter', () => {
  it('renders a colored-dot row combining the series name and the formatted count', () => {
    const formatter = makeCountTooltipFormatter({ complete: '#123456' }, intl);

    const [row] = formatter(1234, 'Complete', entry('complete'))!;
    const { container, getByText } = render(<>{row}</>);

    expect(getByText('Complete: 1,234')).toBeInTheDocument();
    expect(container.querySelector('span[style*="123456"]')).toBeTruthy();
  });

  it('returns null for a non-numeric value, e.g. a stacked bar segment with no data', () => {
    const formatter = makeCountTooltipFormatter({ complete: '#123456' }, intl);

    expect(formatter(undefined, 'Complete', entry('complete'))).toBeNull();
  });
});
