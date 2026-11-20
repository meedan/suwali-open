import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import rule from './typography-quotes.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

ruleTester.run('typography-quotes', rule, {
  valid: [
    '<FormattedMessage id="a" defaultMessage="Click “I accept”" description="Quotes the button" />',
    '<FormattedMessage id="a" defaultMessage={`Click “I accept”`} description="x" />',
    // Dynamic values can't be checked statically.
    '<FormattedMessage id="a" defaultMessage={msg} description={desc} />',
    'const messages = defineMessages({ a: { id: "a", defaultMessage: "Click “Go”", description: "x" } })',
    'const m = defineMessage({ id: "a", defaultMessage: "Click “Go”", description: "x" })',
    "intl.formatMessage({ id: 'a', defaultMessage: 'Click “Go”', description: 'x' })",
    // Typographic single quotes and apostrophes are not this rule's business.
    '<FormattedMessage id="a" defaultMessage="Don’t ‘panic’" description="x" />',

    // Not translation messages: the same prop and key names on other components and objects.
    "<RadioCard title=\"Plan\" description='Say \"hi\"' />",
    "<Card defaultMessage='say \"hi\"' />",
    "const option = { description: 'Say \"hi\"', defaultMessage: 'say \"hi\"' }",
    "foo({ description: 'Say \"hi\"' })",
    "intl.formatNumber({ description: 'Say \"hi\"' })",
    // Only the first argument of formatMessage is the descriptor.
    "intl.formatMessage(messages.a, { description: 'Say \"hi\"' })",
  ],
  invalid: [
    {
      code: "<FormattedMessage id=\"a\" defaultMessage='Click \"I accept\"' description=\"x\" />",
      errors: [{ messageId: 'straightQuote', data: { prop: 'defaultMessage' } }],
    },
    {
      // &quot; is decoded to a straight quote by the JSX parser.
      code: '<FormattedMessage id="a" defaultMessage="Click &quot;I accept&quot;" description="x" />',
      errors: [{ messageId: 'straightQuote', data: { prop: 'defaultMessage' } }],
    },
    {
      code: "<FormattedMessage id=\"a\" defaultMessage=\"x\" description='Introduces the term \"internal\"' />",
      errors: [{ messageId: 'straightQuote', data: { prop: 'description' } }],
    },
    {
      code: "<FormattedMessage id=\"a\" defaultMessage={'Click \"Go\"'} description=\"x\" />",
      errors: [{ messageId: 'straightQuote' }],
    },
    {
      code: "<FormattedMessage id=\"a\" defaultMessage={`Click \"Go\"`} description=\"x\" />",
      errors: [{ messageId: 'straightQuote' }],
    },
    {
      code: "const messages = defineMessages({ a: { id: 'a', defaultMessage: 'Click \"Go\"', description: 'Says \"go\"' } })",
      errors: [{ messageId: 'straightQuote' }, { messageId: 'straightQuote' }],
    },
    {
      code: "const m = defineMessage({ id: 'a', defaultMessage: 'Click \"Go\"', description: 'x' })",
      errors: [{ messageId: 'straightQuote' }],
    },
    {
      code: "intl.formatMessage({ id: 'a', defaultMessage: 'x', description: 'Says \"go\"' })",
      errors: [{ messageId: 'straightQuote' }],
    },
  ],
});
