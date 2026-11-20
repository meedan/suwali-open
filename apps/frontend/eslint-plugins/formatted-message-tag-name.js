// A <FormattedMessage> renders into the element named by its `tagName` prop, so an element that holds nothing
// but one message does not need to be written around it: <p><FormattedMessage … /></p> is the same markup as
// <FormattedMessage … tagName="p" />, which keeps the element and its text where a translator reads them.
//
// Only a wrapper that `tagName` can stand in for is reported: a plain HTML element with no attributes (it has
// nowhere to put a className or a key), holding one self-closing message and nothing else.

const isMessage = node =>
  node.type === 'JSXElement' &&
  node.openingElement.name.type === 'JSXIdentifier' &&
  node.openingElement.name.name === 'FormattedMessage';

// A plain HTML element, such as `p`, as components start with a capital and can't be named by tagName
const isHtmlElement = node =>
  node.openingElement.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.openingElement.name.name);

// Whitespace with a line break in it is dropped by JSX, so what is left is the one child it is around
const isIgnorable = child => child.type === 'JSXText' && /^\s*$/.test(child.value) && child.value.includes('\n');

const hasAttribute = (node, name) =>
  node.openingElement.attributes.some(attr => attr.type === 'JSXAttribute' && attr.name.name === name);

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Use the tagName prop of <FormattedMessage> instead of an element that wraps only that message',
    },
    messages: {
      useTagName:
        'Use <FormattedMessage tagName="{{tag}}" /> instead of a <{{tag}}> that wraps only the message.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        if (!isHtmlElement(node) || node.openingElement.attributes.length > 0) return;

        const children = node.children.filter(child => !isIgnorable(child));
        if (children.length !== 1) return;

        const [message] = children;
        // With children it renders them, which tagName can't be; and with a tagName of its own, the wrapper is another level
        if (!isMessage(message) || !message.openingElement.selfClosing || hasAttribute(message, 'tagName')) return;

        context.report({
          node,
          messageId: 'useTagName',
          data: { tag: node.openingElement.name.name },
        });
      },
    };
  },
};

export default rule;
