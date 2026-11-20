import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import FieldHeading from './FieldHeading';

describe('FieldHeading', () => {
  it('shows the label, which a group can be labelled by', () => {
    render(
      <fieldset aria-labelledby="heading-id">
        <FieldHeading id="heading-id" label="Pick one" />
      </fieldset>
    );

    expect(screen.getByRole('group', { name: 'Pick one' })).toBeInTheDocument();
  });

  it('shows the description when there is one', () => {
    render(<FieldHeading id="heading-id" label="Pick one" description="Choose how it should work." />);

    expect(screen.getByText('Choose how it should work.')).toBeInTheDocument();
  });

  it('shows no description when there is none', () => {
    const { container } = render(<FieldHeading id="heading-id" label="Pick one" />);

    expect(container.querySelector('p')).not.toBeInTheDocument();
  });
});
