import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import CheckboxCard from './CheckboxCard';
import type { ChoiceCardBaseProps } from './ChoiceCard';
import RadioCard from './RadioCard';

// The two cards are one component underneath, so they are tested against the same behavior
const cards = [
  { role: 'checkbox' as const, Card: (props: ChoiceCardBaseProps) => <CheckboxCard {...props} /> },
  { role: 'radio' as const, Card: (props: ChoiceCardBaseProps) => <RadioCard name="group" {...props} /> },
];

describe.each(cards)('$role card', ({ role, Card }) => {
  it('is named by its title and description, and says whether it is selected', () => {
    const { rerender } = render(<Card description="Reply in every language" selected={false} title="All languages" />);

    expect(screen.getByRole(role, { name: /All languages.*Reply in every language/ })).not.toBeChecked();

    rerender(<Card description="Reply in every language" selected title="All languages" />);

    expect(screen.getByRole(role, { name: /All languages/ })).toBeChecked();
  });

  it('calls onChange when it is clicked', () => {
    const onChange = vi.fn();
    render(<Card title="English" onChange={onChange} />);

    fireEvent.click(screen.getByRole(role, { name: 'English' }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('is one control to reach, with no button around the input', () => {
    const { container } = render(<Card selected title="English" />);

    expect(screen.getAllByRole(role)).toHaveLength(1);
    expect(container.querySelector('button')).not.toBeInTheDocument();
  });

  it('calls onChange when what is inside it is clicked, and lets that be used', () => {
    const onChange = vi.fn();
    const onInput = vi.fn();
    render(
      <Card title="Other" onChange={onChange}>
        <input aria-label="Details" onChange={onInput} />
      </Card>
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Details' }), { target: { value: 'more' } });
    fireEvent.click(screen.getByRole('textbox', { name: 'Details' }));

    expect(onInput).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('can be named for a card whose content is in children, outside the input’s label', () => {
    render(
      <Card ariaLabel="?page=2" selected>
        <span>?page=2</span>
      </Card>
    );

    expect(screen.getByRole(role, { name: '?page=2' })).toBeChecked();
  });

  it('takes a class and an id from where it is used', () => {
    const { container } = render(<Card className="custom" id="the-card" title="English" />);

    expect(container.firstChild).toHaveClass('custom');
    expect(screen.getByRole(role, { name: 'English' })).toHaveAttribute('id', 'the-card');
  });

  it('cannot be used when it is disabled', () => {
    const onChange = vi.fn();
    render(
      <Card disabled title="English" onChange={onChange}>
        <span>Details</span>
      </Card>
    );

    fireEvent.click(screen.getByRole(role, { name: 'English' }));
    fireEvent.click(screen.getByText('Details'));

    expect(screen.getByRole(role, { name: 'English' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('checkbox cards', () => {
  it('are toggled by a click on what is inside them, whether or not they are selected', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CheckboxCard selected={false} title="Other" onChange={onChange}>
        <span>Details</span>
      </CheckboxCard>
    );

    fireEvent.click(screen.getByText('Details'));
    rerender(
      <CheckboxCard selected title="Other" onChange={onChange}>
        <span>Details</span>
      </CheckboxCard>
    );
    fireEvent.click(screen.getByText('Details'));

    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('radio cards', () => {
  it('are chosen by a click on what is inside them, but not again once they are chosen', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RadioCard name="param" selected={false} title="Other" onChange={onChange}>
        <span>Details</span>
      </RadioCard>
    );

    fireEvent.click(screen.getByText('Details'));
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(
      <RadioCard name="param" selected title="Other" onChange={onChange}>
        <span>Details</span>
      </RadioCard>
    );

    fireEvent.click(screen.getByText('Details'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('are one group when they share a name', () => {
    render(
      <>
        <RadioCard name="tone" title="Journalist" value="journalist" />
        <RadioCard name="tone" title="Advocate" value="advocate" />
      </>
    );

    expect(screen.getByRole('radio', { name: 'Journalist' })).toHaveAttribute('name', 'tone');
    expect(screen.getByRole('radio', { name: 'Advocate' })).toHaveAttribute('name', 'tone');
  });
});
