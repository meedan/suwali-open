import { useEffect } from 'react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import MarkdownEditor from '@components/MarkdownEditor';

import MarkdownPreview from './MarkdownPreview';

vi.mock('@components/MarkdownEditor', () => ({
  default: vi.fn(),
}));

const content = '# Heading\n\nSome text.';

const renderPreview = () => render(
  <IntlProvider locale="en" messages={{}}>
    <MarkdownPreview content={content} />
  </IntlProvider>
);

describe('MarkdownPreview', () => {
  beforeEach(() => {
    vi.mocked(MarkdownEditor).mockImplementation(({ initialValue }) => <div data-testid="markdown-editor">{initialValue}</div>);
  });

  it('renders the content through MarkdownEditor', async () => {
    renderPreview();

    expect(await screen.findByTestId('markdown-editor')).toHaveTextContent('# Heading Some text.');
    expect(screen.queryByText(/couldn’t display this content with formatting/)).not.toBeInTheDocument();
  });

  it('falls back to plain text with a warning when the markdown cannot be parsed', async () => {
    vi.mocked(MarkdownEditor).mockImplementation(({ onError }) => {
      useEffect(() => {
        onError?.({ error: 'Parsing of the following markdown structure failed', source: '```\ncode\n```' });
      }, [onError]);
      return <div data-testid="markdown-editor" />;
    });

    const { container } = renderPreview();

    await waitFor(() => {
      expect(screen.getByText(/couldn’t display this content with formatting/)).toBeInTheDocument();
    });
    expect(container).toHaveTextContent('# HeadingSome text.');
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
  });
});
