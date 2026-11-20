import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import rule from './formatted-message-description.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

ruleTester.run('formatted-message-description', rule, {
  valid: [
    '<FormattedMessage id="a" defaultMessage="Save" description="Button label to save changes" />',
    '<FormattedMessage id="a" defaultMessage="Save" description={"Button label"} />',
    // Dynamic descriptions can't be checked statically.
    '<FormattedMessage id="a" defaultMessage="Save" description={desc} />',
    // A spread may supply the description.
    '<FormattedMessage {...message} />',
    // Other components are not checked.
    '<Trans id="a" defaultMessage="Save" />',
    'const m = defineMessages({ save: { id: "a", defaultMessage: "Save", description: "Button label" } })',
    'const m = defineMessages({ save: { id: "a", defaultMessage: "Save", description: desc } })',
    'const m = defineMessages({ save: { ...base } })',
    'const m = defineMessages(messages)',
    'const m = defineMessage({ id: "a", defaultMessage: "Save", description: "Button label" })',
    // Calls that merely look similar are not checked.
    'const m = defineThings({ save: { id: "a" } })',
  ],
  invalid: [
    {
      code: '<FormattedMessage id="a" defaultMessage="Save" />',
      errors: [{ messageId: 'missingDescription' }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage="Save"></FormattedMessage>',
      errors: [{ messageId: 'missingDescription' }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage="Save" description="" />',
      errors: [{ messageId: 'emptyDescription' }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage="Save" description="   " />',
      errors: [{ messageId: 'emptyDescription' }],
    },
    {
      code: '<FormattedMessage id="a" defaultMessage="Save" description={""} />',
      errors: [{ messageId: 'emptyDescription' }],
    },
    {
      code: 'const m = defineMessages({ save: { id: "a", defaultMessage: "Save" } })',
      errors: [{ messageId: 'missingDescription' }],
    },
    {
      code: 'const m = defineMessages({ a: { id: "a", defaultMessage: "A", description: "ok" }, b: { id: "b", defaultMessage: "B" } })',
      errors: [{ messageId: 'missingDescription' }],
    },
    {
      code: 'const m = defineMessages({ save: { id: "a", defaultMessage: "Save", description: "" } })',
      errors: [{ messageId: 'emptyDescription' }],
    },
    {
      code: 'const m = defineMessage({ id: "a", defaultMessage: "Save" })',
      errors: [{ messageId: 'missingDescription' }],
    },
  ],
});
