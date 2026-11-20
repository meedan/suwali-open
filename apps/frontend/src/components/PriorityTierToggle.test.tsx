import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PriorityTierToggle from './PriorityTierToggle';

const renderComponent = (props: React.ComponentProps<typeof PriorityTierToggle>) =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <TooltipPrimitive.Provider>
        <PriorityTierToggle {...props} />
      </TooltipPrimitive.Provider>
    </IntlProvider>
  );

const markImportant = { name: /mark this item as important for chatbot responses/i };
const markDefault = { name: /mark this item as default priority for chatbot responses/i };

describe('PriorityTierToggle', () => {
  it('offers to mark as important when the tier is default', () => {
    renderComponent({ priorityTier: 1 });
    expect(screen.getByRole('button', markImportant)).toBeInTheDocument();
  });

  it('offers to mark as default when the tier is important', () => {
    renderComponent({ priorityTier: 2 });
    expect(screen.getByRole('button', markDefault)).toBeInTheDocument();
  });

  // the low tier is not important, so it must read like tier 1 rather than like tier 2
  it('offers to mark as important when the tier is low', () => {
    renderComponent({ priorityTier: -1 });
    expect(screen.getByRole('button', markImportant)).toBeInTheDocument();
    expect(screen.queryByRole('button', markDefault)).not.toBeInTheDocument();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    renderComponent({ priorityTier: 1, onToggle });
    fireEvent.click(screen.getByRole('button', markImportant));
    expect(onToggle).toHaveBeenCalled();
  });

  // the toggle sits in a row cell whose own click opens the preview (see DataSourcesDocumentsPanel)
  it('does not let the click reach the clickable cell it sits in', () => {
    const onCellClick = vi.fn();
    const onToggle = vi.fn();
    render(
      <IntlProvider locale="en" messages={{}}>
        <TooltipPrimitive.Provider>
          <table>
            <tbody>
              <tr>
                <td onClick={onCellClick}>
                  <PriorityTierToggle priorityTier={1} onToggle={onToggle} />
                </td>
              </tr>
            </tbody>
          </table>
        </TooltipPrimitive.Provider>
      </IntlProvider>
    );

    fireEvent.click(screen.getByRole('button', markImportant));
    expect(onToggle).toHaveBeenCalled();
    expect(onCellClick).not.toHaveBeenCalled();
  });
});
