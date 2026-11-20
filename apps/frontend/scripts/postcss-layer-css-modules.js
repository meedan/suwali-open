// Wraps each compiled CSS Module's rules in a cascade layer, so a shared ui-component's styles and
// a feature/page's styles never tie on specificity when both target the same DOM node (e.g. a
// `className` prop passed down onto a shared component) — the winner used to depend on chunk
// load order, which is not something a reader can see from the code.
//
// The two layer names here (components.shared, components.feature) must match the manifest
// declared in src/index.css — that file is always loaded first (a static <link> in index.html,
// before any JS), so it establishes layer order for the whole app regardless of which component
// chunk's CSS happens to load next.
//
// Runs after Vite's own CSS Modules transform, so `root.source.input.file` sees the already-hashed
// selectors (e.g. `._statCard_7am3q_9`), not the authored `.statCard`.
const layerForFile = (file) =>
  file.includes('/src/ui-components/') ? 'components.shared' : 'components.feature';

export default function layerCssModules() {
  return {
    postcssPlugin: 'layer-css-modules',
    Once(root, { AtRule }) {
      const file = root.source?.input?.file;
      if (!file || !file.endsWith('.module.css')) return;
      if (root.first?.type === 'atrule' && root.first.name === 'layer') return; // idempotent (dev HMR reprocesses files)

      const wrapper = new AtRule({ name: 'layer', params: layerForFile(file) });
      wrapper.append(root.nodes);
      root.removeAll();
      root.append(wrapper);
    },
  };
}
layerCssModules.postcss = true;
