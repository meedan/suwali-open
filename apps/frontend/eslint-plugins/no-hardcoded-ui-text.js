// User-facing text must be translated. This catches the places literal English most often slips
// in: text between JSX tags, the props that render as text, and (when configured) object
// properties and function calls that end up as text on screen.
const TEXT_PROPS = new Set(['title', 'label', 'placeholder', 'aria-label', 'alt']);

const LOOKS_LIKE_URL_OR_HANDLE = /^(https?:\/\/|mailto:|www\.|@\w)/i;

// Returns the static text of a string-ish node, or null when it is dynamic.
function staticText(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map(q => q.value.cooked).join('');
  }
  return null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hard-coded user-facing text in JSX; it must be translated',
    },
    messages: {
      jsxText:
        'Hard-coded text "{{text}}" in JSX. Use <FormattedMessage> so it can be translated.',
      textProp:
        'Hard-coded text "{{text}}" in the "{{prop}}" prop. Use defineMessages + useIntl so it can be translated.',
      textProperty:
        'Hard-coded text "{{text}}" in the "{{prop}}" property. Use defineMessages + useIntl so it can be translated.',
      textCall:
        'Hard-coded text "{{text}}" passed to {{callee}}(). Use defineMessages + useIntl so it can be translated.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Strings that are intentionally never translated: brand names, language autonyms.
          allowedStrings: { type: 'array', items: { type: 'string' } },
          // Object property names that hold display text, e.g. { title: 'Untitled' }.
          textProperties: { type: 'array', items: { type: 'string' } },
          // Functions whose arguments are display text: { toast: [1, 2] } checks the 2nd and 3rd
          // arguments of toast(...).
          textCalls: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'integer', minimum: 0 } },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allowed = new Set(context.options[0]?.allowedStrings ?? []);
    const textProperties = new Set(context.options[0]?.textProperties ?? []);
    const textCalls = context.options[0]?.textCalls ?? {};

    // True when the text is something a person would read in a translated language.
    function isTranslatable(raw) {
      const text = raw.trim();
      if (!/\p{L}/u.test(text)) return false; // symbols, numbers, punctuation, percentages
      if (LOOKS_LIKE_URL_OR_HANDLE.test(text)) return false;
      return !allowed.has(text);
    }

    // Values like label="short" are often enum-like variants, not text. Only treat values as text
    // when they are more than one word, or start with a capital letter.
    function readsAsText(text) {
      return /\s/.test(text) || /^\p{Lu}/u.test(text);
    }

    return {
      JSXText(node) {
        if (isTranslatable(node.value)) {
          context.report({ node, messageId: 'jsxText', data: { text: node.value.trim() } });
        }
      },

      // {'literal'} used as a JSX child.
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXAttribute') return;
        const text = staticText(node.expression);
        if (text !== null && isTranslatable(text)) {
          context.report({ node, messageId: 'jsxText', data: { text: text.trim() } });
        }
      },

      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !TEXT_PROPS.has(node.name.name)) return;
        const value = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        const text = staticText(value);
        if (text === null || !isTranslatable(text)) return;

        const trimmed = text.trim();
        if (!readsAsText(trimmed)) return;

        context.report({
          node: value,
          messageId: 'textProp',
          data: { text: trimmed, prop: node.name.name },
        });
      },

      // { title: 'Untitled Note' }
      Property(node) {
        if (node.computed || node.parent.type !== 'ObjectExpression') return;
        const name = node.key.type === 'Identifier' ? node.key.name : node.key.value;
        if (!textProperties.has(name)) return;

        const text = staticText(node.value);
        if (text === null || !isTranslatable(text) || !readsAsText(text.trim())) return;
        context.report({
          node: node.value,
          messageId: 'textProperty',
          data: { text: text.trim(), prop: name },
        });
      },

      // toast('error', 'Something went wrong')
      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && !callee.computed
              ? callee.property.name
              : null;
        const positions = name && Object.hasOwn(textCalls, name) ? textCalls[name] : null;
        if (!positions) return;

        for (const index of positions) {
          const arg = node.arguments[index];
          const text = staticText(arg);
          if (text !== null && isTranslatable(text) && readsAsText(text.trim())) {
            context.report({ node: arg, messageId: 'textCall', data: { text: text.trim(), callee: name } });
          }
        }
      },
    };
  },
};

export default rule;
