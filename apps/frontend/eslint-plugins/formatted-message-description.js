// A message without a description is mistranslated: the description is the only context
// translators see. Covers <FormattedMessage> and the descriptors passed to defineMessages().
const MESSAGE_DEFINERS = new Set(['defineMessages', 'defineMessage']);

// The static text of a string literal, or null when the value is dynamic and can't be checked.
function staticString(node) {
  if (node?.type === 'JSXExpressionContainer') return staticString(node.expression);
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map(q => q.value.cooked).join('');
  }
  return null;
}

function propName(prop) {
  if (prop.computed) return null;
  return prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a non-empty description on <FormattedMessage> and defineMessages() descriptors',
    },
    messages: {
      missingDescription:
        'This message needs a "description"; it is what translators see.',
      emptyDescription: 'The "description" of a message must not be empty.',
    },
    schema: [],
  },
  create(context) {
    // `description` is the node to point at when present, otherwise the message itself.
    function report(messageNode, description, hasDescription) {
      if (!hasDescription) {
        context.report({ node: messageNode, messageId: 'missingDescription' });
        return;
      }
      const text = staticString(description);
      if (text !== null && text.trim() === '') {
        context.report({ node: description, messageId: 'emptyDescription' });
      }
    }

    // A descriptor object: { id, defaultMessage, description }.
    function checkDescriptor(objectNode) {
      if (objectNode.type !== 'ObjectExpression') return;
      // A spread may supply the description; we can't tell statically.
      if (objectNode.properties.some(p => p.type === 'SpreadElement')) return;

      const description = objectNode.properties.find(p => propName(p) === 'description');
      report(objectNode, description?.value, Boolean(description));
    }

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'FormattedMessage') return;
        if (node.attributes.some(attr => attr.type === 'JSXSpreadAttribute')) return;

        const description = node.attributes.find(
          attr => attr.type === 'JSXAttribute' && attr.name.name === 'description',
        );
        report(node, description?.value, Boolean(description));
      },

      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || !MESSAGE_DEFINERS.has(node.callee.name)) return;
        const [arg] = node.arguments;

        if (node.callee.name === 'defineMessage') {
          if (arg) checkDescriptor(arg);
          return;
        }
        // defineMessages({ key: { id, defaultMessage, description }, ... })
        if (arg?.type !== 'ObjectExpression') return;
        for (const prop of arg.properties) {
          if (prop.type === 'Property') checkDescriptor(prop.value);
        }
      },
    };
  },
};

export default rule;
