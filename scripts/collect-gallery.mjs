#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildBuiltInNotes, buildGallery, renderBuiltInNotesModule } from './level-gallery.mjs';

const root = process.cwd();

const gallery = await buildGallery(root);
await writeFile(path.join(root, 'docs', 'level-gallery.md'), gallery);

const notes = await buildBuiltInNotes(root);
const generatedDir = path.join(root, 'src', 'app', 'generated');
await mkdir(generatedDir, { recursive: true });
await writeFile(path.join(generatedDir, 'built-in-notes.ts'), renderBuiltInNotesModule(notes));

console.log(`Wrote docs/level-gallery.md and src/app/generated/built-in-notes.ts from ${notes.length} built-in level cards`);
