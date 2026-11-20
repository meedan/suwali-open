/*
 * Script to convert a translations Source JSON (react-intl format) file (e.g., en.json) into a TSV file.
 *
 * This is useful for translators who prefer working with spreadsheets or using GOOGLETRANSLATE function in Google Sheets.
 *
 * Usage:
 *
 * From apps/frontend/lang/
 * $ node scripts/json-flat-to-tsv.js
*/
import { readFileSync, writeFileSync } from "fs";

const inputFile = "en.json";
const outputFile = "en.tsv";

const rawData = readFileSync(inputFile, "utf-8");
const data = JSON.parse(rawData);

const translatables = Object.entries(data).map(([key, value]) => `${key}\t${value.defaultMessage}`);

writeFileSync(outputFile, translatables.join('\n'), "utf-8");

console.log(`TSV file written to ${outputFile}`);
