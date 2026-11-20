/*
 * Script to count strings and words in the source language (en.json) JSON file.
 *
 * From apps/frontend/lang/
 * Usage: node scripts/word-count.js
 *
 */
import { readFileSync } from "fs";

const inputFile = "en.json";
const rawData = readFileSync(inputFile, "utf-8");
const data = JSON.parse(rawData);

let totalWordCount = 0;

for (const key in data) {
  if (Object.hasOwn(data, key)) {
    let wordCount = data[key].defaultMessage.split(' ').length;
    totalWordCount += wordCount;
  }
}

console.log(`Total string count: ${Object.keys(data).length}`);
console.log(`Total word count: ${totalWordCount}`);
