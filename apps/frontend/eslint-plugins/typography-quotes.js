import { messageTextVisitors } from './message-text.js';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require typographic double quotes (“ ”) around quoted text in defaultMessage and description strings of translation messages',
    },
    messages: {
      straightQuote:
        'Use typographic quotes (“ ”) instead of a straight double quote (") or &quot; in {{prop}} strings.',
    },
    schema: [],
  },
  create(context) {
    // A JSX attribute string decodes &quot; to ", so one check covers both spellings.
    return messageTextVisitors((propName, node, text) => {
      if (text.includes('"')) {
        context.report({ node, messageId: 'straightQuote', data: { prop: propName } });
      }
    });
  },
};

export default rule;
