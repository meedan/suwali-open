import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importPlugin from 'eslint-plugin-import';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint'
import suwali from './eslint-plugins/index.js'

// Shared by the main block and the override below, because flat config replaces a rule's options
// instead of merging them.
const noParentImports = {
  group: ['../*'],
  message: 'Do not traverse back using relative imports. Use @aliases.',
};
const noNetworkLayerOutsideServices = {
  group: ['**/NetworkLayer'],
  // HttpError, sanitizeApiErrors and the response types are fine anywhere: components need them to
  // handle errors. The rest is what makes API calls.
  importNames: ['NetworkLayer', 'API_BASE_URL', 'getAuthToken', 'setAuthToken', 'clearAuthToken', 'getDefaultHeaders'],
  message: 'API calls go through src/services/. Add or reuse a function in the matching *Service.ts.',
};

export default tseslint.config(
  { ignores: ['dist', '.vite'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, jsxA11y.flatConfigs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'jsx-a11y/recommended': jsxA11y,
      'react': react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'import': importPlugin,
      'simple-import-sort': simpleImportSort,
      'suwali': suwali,
    },
    rules: {
      'jsx-a11y/anchor-ambiguous-text': 'error',
      'jsx-a11y/prefer-tag-over-role': 'error',
      'react/jsx-no-target-blank': 'error',
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [noParentImports, noNetworkLayerOutsideServices] },
      ],
      // Combine class names with clsx, so what is joined, and when, reads the same everywhere. Messages that are
      // rendered in JSX are <FormattedMessage>s: intl.formatMessage() is for plain strings, such as an aria-label
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name=/[cC]lassName$/] TemplateLiteral[expressions.length>0]',
          message: 'Combine class names with clsx() instead of a template literal.',
        },
        {
          selector: ":matches(JSXElement, JSXFragment) > JSXExpressionContainer > CallExpression:matches([callee.property.name='formatMessage'], [callee.name='formatMessage'])",
          message: 'Render a message that ends up inside JSX with <FormattedMessage id defaultMessage description />, not intl.formatMessage(). Spread a descriptor ({...x}) only when it is chosen at runtime.',
        },
      ],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // External packages
            [
              '^[a-z]',
              '^@(?!(root|components|hooks|services|customTypes|ui-components|helpers|pages|constants|layouts|contexts|trial-banners|styles|lang)/)',
            ],
            // Internal alias groups (each its own section, ordered by dependency layer)
            ['^@customTypes/'],
            ['^@constants/'],
            ['^@helpers/'],
            ['^@services/'],
            ['^@root/'],
            ['^@contexts/'],
            ['^@hooks/'],
            ['^@ui-components/'],
            ['^@layouts/'],
            ['^@components/'],
            ['^@trial-banners/'],
            ['^@pages/'],
            ['^@lang/'],
            ['^@styles/'],
            // Relative imports
            ['^\\.'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      'import/no-duplicates': 'error',
      'comma-spacing': ['error', { before: false, after: true }],
      'suwali/formatted-message-description': 'error',
      'suwali/formatted-message-key': 'error',
      'suwali/formatted-message-tag-name': 'error',
      'suwali/no-hardcoded-ui-text': ['error', {
        allowedStrings: [
          // Brand names are never translated.
          'Suwali', 'WhatsApp', 'Telegram', 'SMS', 'RCS', 'Signal',
          // Language names are shown in their own language so speakers can find them.
          'English', 'Español', 'Français', 'Português', 'العربية', 'हिन्दी',
        ],
        // Object properties that hold display text, e.g. { title: 'Untitled Note' }.
        textProperties: ['title', 'label', 'message', 'placeholder', 'text', 'heading'],
        // Functions whose arguments are display text. toast(variant, message, title) from useToast.
        textCalls: { toast: [1, 2] },
      }],
      'suwali/typography-apostrophes': 'error',
      'suwali/typography-quotes': 'error',
    },
  },
  {
    // The service layer is the one place allowed to call the API, and tests mock it.
    files: ['src/services/**', 'src/NetworkLayer.ts', '**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noParentImports] }] },
  },
  {
    // Tests and Playwright specs use literal text on purpose.
    files: ['**/*.test.{ts,tsx}', 'src/test/**', 'tests/**'],
    rules: { 'suwali/no-hardcoded-ui-text': 'off' },
  },
)
