// In order to fix ReferenceError: Prism is not defined
// Explictly importing and setting `window.Prism` in attempt
// to ensure it's set before MarkdownEditor is loaded
import Prism from 'prismjs';

globalThis.Prism ??= Prism;
