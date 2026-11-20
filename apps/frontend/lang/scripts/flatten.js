/*
 * Script to flatten a translations JSON file (e.g., pt.json) by extracting only the defaultMessage values.
 *
 * From apps/frontend/lang/
 * Usage: node scripts/flatten.js <locale>.json
 *
 * Example input:
 * {
 *   "global.cancel": {
 *     "defaultMessage": "Cancel",
 *     "description": "Reusable Cancel button label",
 *   },
 * }
 *
 * Example output:
 * {
 *   "global.cancel": "Cancel",
 * }
 *
 */
import { readFileSync, writeFileSync } from "fs";

// Get input file from command-line argument
const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node flatten.js <inputFile>");
  process.exit(1);
}
const outputFile = inputFile;

const rawData = readFileSync(inputFile, "utf-8");
const data = JSON.parse(rawData);

// Flatten JSON
const flatJson = {};
for (const key in data) {
  if (Object.hasOwn(data, key)) {
    flatJson[key] = data[key].defaultMessage;
  }
}

writeFileSync(outputFile, JSON.stringify(flatJson, null, 2), "utf-8");

console.log(`Flattened JSON written to ${outputFile}`);
