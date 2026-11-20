// Shared by the typography rules: finds the static defaultMessage and description strings of
// react-intl messages, wherever they are declared.
const MESSAGE_PROPS = new Set(['defaultMessage', 'description']);

// Returns the static text of a string-ish node (string literal, or template literal with no
// expressions), or null if the value is dynamic and can't be checked.
function staticText(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map(q => q.value.cooked).join('');
  }
  return null;
}

const MESSAGE_COMPONENT = 'FormattedMessage';

function calleeName(call) {
  const { callee } = call;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) return callee.property.name;
  return null;
}

// True when the object is a react-intl message descriptor ({ id, defaultMessage, description }):
//   defineMessage({ ... })              - the object is the argument
//   intl.formatMessage({ ... })         - the object is the first argument
//   defineMessages({ key: { ... } })    - the object is a value of the argument
function isMessageDescriptor(objectNode) {
  const { parent } = objectNode;
  if (parent.type === 'CallExpression' && parent.arguments[0] === objectNode) {
    const name = calleeName(parent);
    return name === 'defineMessage' || name === 'formatMessage';
  }
  if (parent.type === 'Property' && parent.value === objectNode) {
    const group = parent.parent;
    return (
      group.type === 'ObjectExpression' &&
      group.parent.type === 'CallExpression' &&
      group.parent.arguments[0] === group &&
      calleeName(group.parent) === 'defineMessages'
    );
  }
  return false;
}


// Returns the visitors that call `check(propName, node, text)` for every static message string.
export function messageTextVisitors(check) {
  function visit(propName, valueNode) {
    // JSX attributes wrap non-string-literal values in an expression container.
    const node = valueNode?.type === 'JSXExpressionContainer' ? valueNode.expression : valueNode;
    const text = staticText(node);
    if (text !== null) check(propName, node, text);
  }

  return {
    // <FormattedMessage defaultMessage="..." description="..." />
    // Other components can have their own `description` props that are not translation messages.
    JSXAttribute(node) {
      if (node.name.type !== 'JSXIdentifier' || !MESSAGE_PROPS.has(node.name.name)) return;
      const element = node.parent;
      if (element.name.type !== 'JSXIdentifier' || element.name.name !== MESSAGE_COMPONENT) return;
      visit(node.name.name, node.value);
    },
    // defineMessages({ key: { defaultMessage: '...', description: '...' } })
    // Unrelated objects can have a `description` key too, so only descriptors are checked.
    Property(node) {
      if (node.computed || node.parent.type !== 'ObjectExpression') return;
      const name = node.key.type === 'Identifier' ? node.key.name : node.key.value;
      if (!MESSAGE_PROPS.has(name) || !isMessageDescriptor(node.parent)) return;
      visit(name, node.value);
    },
  };
}
