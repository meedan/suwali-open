// Suwali's custom ESLint rules, registered under the `suwali` namespace in eslint.config.js.
//
// To add a rule:
//   1. Create eslint-plugins/<rule-name>.js exporting the rule object (see typography-apostrophes.js).
//   2. Create eslint-plugins/<rule-name>.test.js with RuleTester cases.
//   3. Register it below and enable it in eslint.config.js as 'suwali/<rule-name>'.
//   4. Delete the matching prose rule / review-checklist item from the AGENTS.md files.
import formattedMessageDescription from './formatted-message-description.js';
import formattedMessageKey from './formatted-message-key.js';
import formattedMessageTagName from './formatted-message-tag-name.js';
import noHardcodedUiText from './no-hardcoded-ui-text.js';
import typographyApostrophes from './typography-apostrophes.js';
import typographyQuotes from './typography-quotes.js';

export default {
  rules: {
    'formatted-message-description': formattedMessageDescription,
    'formatted-message-key': formattedMessageKey.rules['formatted-message-key'],
    'formatted-message-tag-name': formattedMessageTagName,
    'no-hardcoded-ui-text': noHardcodedUiText,
    'typography-apostrophes': typographyApostrophes,
    'typography-quotes': typographyQuotes,
  },
};
