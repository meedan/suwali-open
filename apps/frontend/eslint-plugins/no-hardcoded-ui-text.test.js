import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import rule from './no-hardcoded-ui-text.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

const options = [{ allowedStrings: ['WhatsApp', 'Español'] }];
const extended = [
  {
    allowedStrings: ['WhatsApp'],
    textProperties: ['title', 'label'],
    textCalls: { toast: [1, 2] },
  },
];

ruleTester.run('no-hardcoded-ui-text', rule, {
  valid: [
    // Translated text.
    '<p><FormattedMessage id="a" defaultMessage="Save" description="x" /></p>',
    // Dynamic content.
    '<p>{name}</p>',
    '<p>{count} / {total}</p>',
    // No letters: punctuation, symbols, numbers, percentages.
    '<span>—</span>',
    '<span>•</span>',
    '<span>25%</span>',
    '<span>+</span>',
    // URLs, emails and handles are not translated.
    '<a>https://example.com/signup</a>',
    '<code>@userinfobot</code>',
    // Allow-listed brand names and language autonyms.
    { code: '<span>WhatsApp</span>', options },
    { code: '<option>Español</option>', options },
    { code: '<Icon aria-label="WhatsApp" />', options },
    // Whitespace-only text between elements.
    '<div>\n  <span /> \n</div>',
    // Enum-like prop values are not text.
    '<TrustedUserStatus label="short" />',
    '<TrustedUserStatus label="long" />',
    // Props that are not user-facing text.
    '<input type="text" className="Big Title" name="Email address" />',
    // Dynamic prop values.
    '<Icon aria-label={label} />',
    '<Icon aria-label={intl.formatMessage(messages.close)} />',
    // Object properties and calls are only checked when configured.
    'const note = { title: "Untitled Note" }',
    'toast("error", "Something went wrong")',
    // Configured properties: dynamic values, enum-like values, non-text keys and brands are fine.
    { code: 'const n = { title: intl.formatMessage(messages.untitled) }', options: extended },
    { code: 'const n = { label: "short" }', options: extended },
    { code: 'const n = { type: "Untitled Note" }', options: extended },
    { code: 'const n = { label: "WhatsApp" }', options: extended },
    { code: 'const n = { title: "…" }', options: extended },
    { code: 'const n = { [title]: "Untitled Note" }', options: extended },
    { code: 'const { title = "Untitled Note" } = props', options: extended },
    // Configured calls: only the listed argument positions are checked.
    { code: 'toast("error", intl.formatMessage(messages.failed))', options: extended },
    { code: 'toast("Success", message)', options: extended },
    { code: 'track("Something went wrong")', options: extended },
  ],
  invalid: [
    { code: '<p>Add SMS for</p>', errors: [{ messageId: 'jsxText' }] },
    { code: '<p>loading</p>', errors: [{ messageId: 'jsxText' }] },
    { code: '<p>Hello <b>there</b></p>', errors: [{ messageId: 'jsxText' }, { messageId: 'jsxText' }] },
    { code: "<p>{'Hello there'}</p>", errors: [{ messageId: 'jsxText' }] },
    { code: '<p>{`Hello there`}</p>', errors: [{ messageId: 'jsxText' }] },
    // Brand names are only allowed when listed.
    { code: '<span>WhatsApp</span>', errors: [{ messageId: 'jsxText' }] },
    {
      code: '<input placeholder="Search your sources" />',
      errors: [{ messageId: 'textProp', data: { prop: 'placeholder', text: 'Search your sources' } }],
    },
    { code: '<Icon aria-label="Close" />', errors: [{ messageId: 'textProp' }] },
    { code: '<img alt="A photo of the team" />', errors: [{ messageId: 'textProp' }] },
    { code: '<Button label="Save" />', errors: [{ messageId: 'textProp' }] },
    { code: '<Button title={"Save changes"} />', errors: [{ messageId: 'textProp' }] },
    {
      code: 'const note = { title: "Untitled Note" }',
      options: extended,
      errors: [{ messageId: 'textProperty', data: { prop: 'title', text: 'Untitled Note' } }],
    },
    {
      code: 'post("/conversations", { conversation: { hub_id: id, title: "Untitled Conversation" } })',
      options: extended,
      errors: [{ messageId: 'textProperty' }],
    },
    { code: 'const n = { "label": "Open menu" }', options: extended, errors: [{ messageId: 'textProperty' }] },
    {
      code: 'toast("error", "Something went wrong")',
      options: extended,
      errors: [{ messageId: 'textCall', data: { callee: 'toast', text: 'Something went wrong' } }],
    },
    {
      code: 'toast("success", intl.formatMessage(m.done), "Saved")',
      options: extended,
      errors: [{ messageId: 'textCall' }],
    },
    {
      code: 'ui.toast("error", `Could not save`)',
      options: extended,
      errors: [{ messageId: 'textCall' }],
    },
  ],
});
