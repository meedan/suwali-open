import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import ParsedText from './ParsedText';

describe('ParsedText', () => {
  it('links every URL in a comma-separated list', () => {
    const text = 'Check out these websites: https://first-site.com/, https://second.com/, https://thirdsitenews.net/, '
      + 'https://fourthsite.com/, https://fifthsite.org/, and https://sixthsite.com/';
    render(<ParsedText text={text} />);

    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      'https://first-site.com',
      'https://second.com',
      'https://thirdsitenews.net',
      'https://fourthsite.com',
      'https://fifthsite.org',
      'https://sixthsite.com',
    ]);
  });
});
