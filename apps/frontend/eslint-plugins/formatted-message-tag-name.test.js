import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import rule from './formatted-message-tag-name.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

ruleTester.run('formatted-message-tag-name', rule, {
  valid: [
    // Already the way to write it.
    '<FormattedMessage id="a" defaultMessage="Save" description="Button label" tagName="p" />',
    // An element with an attribute can't hand it over to the message.
    '<p className={styles.note}><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></p>',
    '<th scope="col"><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></th>',
    '<li key={id}><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></li>',
    // A component can't be named by tagName.
    '<Button><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></Button>',
    '<Menu.Item><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></Menu.Item>',
    // More than the message is in it.
    '<p>Hello <FormattedMessage id="a" defaultMessage="Save" description="Button label" /></p>',
    '<p><FormattedMessage id="a" defaultMessage="Save" description="Button label" /> {count}</p>',
    '<p><Icon /><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></p>',
    '<p><FormattedMessage id="a" defaultMessage="A" description="d" /><FormattedMessage id="b" defaultMessage="B" description="d" /></p>',
    // A space on the same line is text.
    '<p> <FormattedMessage id="a" defaultMessage="Save" description="Button label" /> </p>',
    // A message that renders its children, or has a tag of its own, is not replaced by the element around it.
    '<p><FormattedMessage id="a" defaultMessage="Save" description="d">{chunks => chunks}</FormattedMessage></p>',
    '<div><FormattedMessage id="a" defaultMessage="Save" description="d" tagName="p" /></div>',
    // Not a message.
    '<p><Trans id="a" /></p>',
    '<p>{message}</p>',
    '<p></p>',
  ],
  invalid: [
    {
      code: '<p><FormattedMessage id="a" defaultMessage="Save" description="Button label" /></p>',
      errors: [{ messageId: 'useTagName', data: { tag: 'p' } }],
    },
    {
      code: '<small><FormattedMessage {...message} /></small>',
      errors: [{ messageId: 'useTagName', data: { tag: 'small' } }],
    },
    {
      // Line breaks around the message are dropped by JSX, so it is the only child.
      code: `<h2>
  <FormattedMessage id="a" defaultMessage="Save" description="Button label" />
</h2>`,
      errors: [{ messageId: 'useTagName', data: { tag: 'h2' } }],
    },
  ],
});
