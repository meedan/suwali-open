/*
 * Script to find duplicated translatable strings in en.json
 *
 * From apps/frontend/lang/
 * Usage: node scripts/find-duplicated.js
 *
 * Example output (as written to duplicated.txt):
 *
 * String:	"Send" [2]
 * Keys:	  global.send|messageNode.directionSend
 *
 * Duplicated string ids are | separated so they can be easily searched for in VSCode.
 *
 */
import { readFileSync, writeFileSync } from "fs";

const inputFile = "en.json";
const outputFile = "duplicated.txt";

const rawData = readFileSync(inputFile, "utf-8");
const data = JSON.parse(rawData);

const duplicated = {};
let totalRedundancy = 0;

const translatables = Object.entries(data).map(([key, value]) => {
  if (!duplicated[value.defaultMessage]) {
    duplicated[value.defaultMessage] = {
      count: 1,
      keys: [key],
    };
  } else {
    duplicated[value.defaultMessage].count += 1;
    duplicated[value.defaultMessage].keys.push(key);
    totalRedundancy += 1;
  }
});

const output = Object.entries(duplicated).filter(([str, info]) => info.count > 1).map(([str, info]) => {
  return `String:\t"${str}" [${info.count}]\nKeys:\t${info.keys.join('|')}\n`;
}).join('\n');

writeFileSync(outputFile, output, "utf-8");

console.log(`Number of duplicated strings: ${totalRedundancy}`);
console.log(`Duplicated strings written to ${outputFile}`);
