import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import rule from './typography-apostrophes.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

ruleTester.run('typography-apostrophes', rule, {
  valid: [
    '<FormattedMessage id="a" defaultMessage="Don’t panic" description="Reassures the user" />',
    '<FormattedMessage id="a" defaultMessage={`Don’t panic`} description="x" />',
    // Dynamic values can't be checked statically.
    '<FormattedMessage id="a" defaultMessage={msg} description={desc} />',
    'const messages = defineMessages({ a: { id: "a", defaultMessage: "Don’t", description: "x" } })',
    'const m = defineMessage({ id: "a", defaultMessage: "Don’t", description: "x" })',
    'intl.formatMessage({ id: "a", defaultMessage: "Don’t", description: "x" })',

    // Not translation messages: the same prop and key names on other components and objects.
    '<RadioCard title="Plan" description="Don\'t miss this" />',
    '<Card defaultMessage="it\'s" />',
    '<foo.Card description="it\'s" />',
    '<input placeholder="Don\'t" className="it\'s" />',
    'const x = { name: "it\'s" }',
    'const option = { description: "Don\'t panic", defaultMessage: "it\'s" }',
    'const options = [{ label: "Plan", description: "Don\'t miss this" }]',
    'foo({ description: "Don\'t panic" })',
    'foo({ key: { description: "Don\'t panic" } })',
    'defineThings({ key: { description: "Don\'t panic" } })',
    'intl.formatNumber({ description: "Don\'t panic" })',
    // Only the first argument of formatMessage is the descriptor.
    'intl.formatMessage(messages.a, { description: "Don\'t panic" })',
    // Computed keys are not descriptors.
    'defineMessages({ [key]: { id: "a", description: "x" } })',
  ],
  invalid: [
    {
      code: '<FormattedMessage id="a" defaultMessage="Don\'t panic" description="x" />',
      errors: [{ messageId: 'straightApostrophe', data: { prop: 'defaultMessage' } }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage="x" description="Introduces the term \'internal\'" />',
      errors: [{ messageId: 'straightApostrophe', data: { prop: 'description' } }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage={"Don\'t panic"} description="x" />',
      errors: [{ messageId: 'straightApostrophe' }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage={`Don\'t panic`} description="x" />',
      errors: [{ messageId: 'straightApostrophe' }],
    },
    {
      code: 'const messages = defineMessages({ a: { id: "a", defaultMessage: "Don\'t", description: "It\'s" } })',
      errors: [{ messageId: 'straightApostrophe' }, { messageId: 'straightApostrophe' }],
    },
    {
      code: 'const m = defineMessage({ id: "a", defaultMessage: "Don\'t", description: "x" })',
      errors: [{ messageId: 'straightApostrophe' }],
    },
    {
      code: 'intl.formatMessage({ id: "a", defaultMessage: "x", description: "It\'s" })',
      errors: [{ messageId: 'straightApostrophe' }],
    },
  ],
});
