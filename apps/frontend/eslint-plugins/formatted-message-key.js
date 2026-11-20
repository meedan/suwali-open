const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require key prop on JSX returned from FormattedMessage values callbacks',
    },
    messages: {
      missingKey:
        'JSX returned from a FormattedMessage values callback must have a "key" prop to avoid React warnings.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.name !== 'FormattedMessage') return;

        const valuesProp = node.attributes.find(
          attr => attr.type === 'JSXAttribute' && attr.name.name === 'values',
        );
        if (!valuesProp?.value?.expression) return;

        const obj = valuesProp.value.expression;
        if (obj.type !== 'ObjectExpression') return;

        for (const prop of obj.properties) {
          if (prop.type !== 'Property') continue;

          const fn = prop.value;
          if (fn.type !== 'ArrowFunctionExpression') continue;

          const jsx =
            fn.body.type === 'JSXElement'
              ? fn.body
              : fn.body.type === 'BlockStatement'
                ? getReturnedJSX(fn.body)
                : null;

          if (!jsx) continue;

          const hasKey = jsx.openingElement.attributes.some(
            attr => attr.type === 'JSXAttribute' && attr.name.name === 'key',
          );

          if (!hasKey) {
            context.report({ node: jsx, messageId: 'missingKey' });
          }
        }
      },
    };
  },
};

function getReturnedJSX(block) {
  for (const stmt of block.body) {
    if (stmt.type === 'ReturnStatement' && stmt.argument?.type === 'JSXElement') {
      return stmt.argument;
    }
  }
  return null;
}

const plugin = {
  rules: {
    'formatted-message-key': rule,
  },
};

export default plugin;
