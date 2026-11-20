#!/bin/bash
set -e
npm run lint
npm run build
npm run watch:bundle-size
npm run extract
npm run check:unused-css
npm run check:unused-code
npm run test:unit
