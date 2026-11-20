import { FormattedMessage, IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { APP_NAME } from '@constants/App';

import usePageTitle from '@hooks/usePageTitle';

type TitleProps = {
  id: string;
  defaultMessage?: string;
  description?: string;
  values?: Record<string, string | number>;
};


const TestComponent = ({ title }: { title: React.ReactElement<TitleProps> }) => {
  usePageTitle(title);
  return null;
};


describe('usePageTitle', () => {
  it('should renders the document title in the correct order for LTR languages', () => {
    const title = (
      <FormattedMessage
        id="page.one"
        defaultMessage="Page one"
        description="Page title for test"
      />
    );

    render(
      <IntlProvider locale="en" messages={{}}>
        <TestComponent title={title} />
      </IntlProvider>
    );

    expect(document.title).toBe(`Page one | ${APP_NAME}`);
  });

  it('should renders the document title in the correct order for RTL language', () => {
  render(
    <IntlProvider locale="ar" messages={{ "page.two": "صفحة اثنان" }}>
      <TestComponent
        title={
          <FormattedMessage
            id="page.two"
            defaultMessage="Page Two"
            description="Page title test"
          />
        }
      />
    </IntlProvider>
  );

  expect(document.title).toBe(`${APP_NAME} | صفحة اثنان`);
  });
});
