export default {
  "extends": "stylelint-config-standard",
  "ignoreFiles": ["node_modules/**"],
  "defaultSeverity": "error",
  "plugins": [
      "stylelint-order",
      "stylelint-declaration-strict-value"
  ],
  "rules": {
      "alpha-value-notation": "number",
      "at-rule-no-unknown": true,
      "color-named": "never",
      "color-no-hex": true,
      "color-no-invalid-hex": true,
      "comment-empty-line-before": ["always", {
          "ignore": ["stylelint-commands"]
      }],
      "custom-property-pattern": null,
      "declaration-empty-line-before": null,
      "max-nesting-depth": [4, {
        "ignoreAtRules": ["media", "supports", "keyframes"]
      }],
      "order/properties-alphabetical-order": true,
      "property-no-vendor-prefix": null,
      "rule-empty-line-before": [
          "always", {
              "except": ["first-nested", "after-single-line-comment"]
          }
      ],
      "scale-unlimited/declaration-strict-value": [
          ["/color/", "fill", "stroke", "font-size", "border-radius", "z-index", "box-shadow", "font", "font-weight"],
          {
              "ignoreValues": ["transparent", "inherit", "currentColor", "currentcolor", "none", "underline", "medium", "unset", "light", "dark"]
          }
      ],
      "selector-class-pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$",
      "selector-type-case": null,
      "selector-pseudo-class-no-unknown": true,
      "declaration-no-important": true,
      "selector-max-id": 0,
      "no-descending-specificity": null,
      "shorthand-property-no-redundant-values": true,
      "property-layout-mappings": ["flow-relative", {
          "ignoreProperties": [
              "/^(min-|max-)?(width|height)$/",
              "/^contain-intrinsic-(width|height)$/",
              "/^(top|bottom)$/",
              "/^(margin|padding|scroll-margin|scroll-padding)-(top|bottom)$/",
              "/^border-(top|bottom)(-width|-style|-color)?$/",
              "/-radius$/",
              "/^overflow-[xy]$/",
              "/^overscroll-behavior-[xy]$/"
          ]
      }],
      "value-keyword-layout-mappings": "flow-relative",
      // property-layout-mappings only sees single-side properties, so the physical inset shorthand slips through
      "declaration-property-value-disallowed-list": [
          { "inset": ["/.+/"] },
          { "message": "Use inset-block-start/-end and inset-inline-start/-end instead of the inset shorthand, so the position mirrors in RTL" }
      ]
  },
  "overrides": [
      {
          // :global()/:local() only mean anything to postcss-modules, which Vite only runs
          // against *.module.css files — in a plain stylesheet they ship as invalid CSS and the
          // browser silently drops the whole rule (caught the hard way when forms.module.css was
          // demoted to a plain forms.css and its `:global(.suwali-icon)` rule went dead).
          "files": ["**/*.module.css"],
          "rules": {
              "selector-pseudo-class-no-unknown": [
                  true,
                  {
                      "ignorePseudoClasses": ["global"]
                  }
              ],
              // CSS Modules classes are referenced as JS object properties (styles.statCard), so
              // they follow camelCase; plain global stylesheets have no such constraint and follow
              // ordinary CSS kebab-case instead (see the base selector-class-pattern rule). A
              // module.css file can also select classes it doesn't own — vendor DOM reached
              // through :global(...) (react-flow__*, recharts-*, mdxeditor-*, cm-*) or one of our
              // own established global classes (.suwali-icon, .layout-*) — and every one of those
              // is hyphenated, so a hyphen is treated as "this isn't a local token, skip the check".
              "selector-class-pattern": "^([a-z][a-zA-Z0-9]*|[a-zA-Z0-9_-]*-[a-zA-Z0-9_-]*)$"
          }
      }
  ],
  "languageOptions": {
      "directionality": {
          "block": "top-to-bottom",
          "inline": "left-to-right"
      }
  }
};
