// usage: node append.mjs <source> <target> [--replace]
// Appends <source> to <target> (or replaces it), with LF line endings and no BOM.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [source, target, mode] = process.argv.slice(2);
const clean = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const add = clean(readFileSync(source, 'utf8'));
const before = mode === '--replace' || !existsSync(target) ? '' : clean(readFileSync(target, 'utf8'));
writeFileSync(target, before + add);
console.log(`${target}: ${(before + add).split('\n').length - 1} lines`);
