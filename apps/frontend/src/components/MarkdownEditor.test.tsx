import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import MarkdownEditor from './MarkdownEditor';

const renderEditor = (markdown: string) => {
  const onError = vi.fn();
  const { container } = render(
    <IntlProvider locale="en" messages={{}}>
      <MarkdownEditor initialValue={markdown} onError={onError} />
    </IntlProvider>
  );
  return { container, onError };
};

describe('MarkdownEditor', () => {
  it('reports the markdown as the editor writes it once it is ready, even when that is not what it was given', async () => {
    const onReady = vi.fn();
    render(
      <IntlProvider locale="en" messages={{}}>
        <MarkdownEditor initialValue={'# Title\n\n- one\n- two\n'} onReady={onReady} />
      </IntlProvider>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onReady).toHaveBeenCalledWith('# Title\n\n* one\n* two');
  });

  it('names the editable area with the label it is given', async () => {
    render(
      <IntlProvider locale="en" messages={{}}>
        <MarkdownEditor ariaLabel="Document summary" initialValue="Some text" isEditing />
      </IntlProvider>
    );

    expect(await screen.findByRole('textbox', { name: 'Document summary' })).toBeInTheDocument();
  });

  it('renders markdown as formatted content', async () => {
    const { container } = renderEditor('## Heading\n\n- one\n\n[link](https://example.org)');

    await waitFor(() => {
      expect(container.querySelector('h2')).toHaveTextContent('Heading');
    });
    expect(container.querySelector('li')).toHaveTextContent('one');
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.org');
  });

  it('reports an error instead of rendering raw HTML embedded in the markdown', async () => {
    const { container, onError } = renderEditor('See <a href="javascript:alert(1)">click me</a> and <script>alert(2)</script>');

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('script')).toHaveLength(0);
  });
});
