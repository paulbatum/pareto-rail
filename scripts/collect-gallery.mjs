#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildGallery } from './level-gallery.mjs';

const root = process.cwd();
const gallery = await buildGallery(root);
await writeFile(path.join(root, 'docs', 'level-gallery.md'), gallery);
console.log('Wrote docs/level-gallery.md from the built-in level cards');
