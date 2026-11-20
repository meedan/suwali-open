import { messageTextVisitors } from './message-text.js';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require typographic apostrophes (’) in defaultMessage and description strings of translation messages',
    },
    messages: {
      straightApostrophe:
        'Use a typographic apostrophe (’) instead of a straight quote (\') in {{prop}} strings.',
    },
    schema: [],
  },
  create(context) {
    return messageTextVisitors((propName, node, text) => {
      if (text.includes("'")) {
        context.report({ node, messageId: 'straightApostrophe', data: { prop: propName } });
      }
    });
  },
};

export default rule;
