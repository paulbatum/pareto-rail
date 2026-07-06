#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const id = args.id;
if (!id) fail('Missing --id <id>');
if (!/^[a-z][a-z0-9-]*$/.test(id)) fail('Level id must match /^[a-z][a-z0-9-]*$/');

const title = args.title ?? titleFromId(id);
const bpm = args.bpm === undefined ? 120 : Number(args.bpm);
if (!Number.isFinite(bpm) || bpm <= 0) fail('BPM must be a positive number');

const root = process.cwd();
const levelDir = path.join(root, 'src', 'levels', id);
if (await exists(levelDir)) fail(`Refusing to overwrite existing level directory: src/levels/${id}`);

const registryPath = path.join(root, 'src', 'levels', 'index.ts');
const registry = await readFile(registryPath, 'utf8');
if (registry.includes(`id: '${id}'`) || registry.includes(`aliases: ['${id}'`)) {
  fail(`Refusing to add duplicate level id or alias: ${id}`);
}

const names = namesForId(id);
await mkdir(path.join(levelDir, 'visuals'), { recursive: true });
await Promise.all([
  writeFile(path.join(levelDir, 'index.ts'), indexTs({ id, title, bpm, ...names })),
  writeFile(path.join(levelDir, 'gameplay.ts'), gameplayTs({ bpm, ...names })),
  writeFile(path.join(levelDir, 'audio.ts'), audioTs({ bpm, ...names })),
  writeFile(path.join(levelDir, 'visuals', 'index.ts'), visualsTs()),
  writeFile(path.join(levelDir, 'level.md'), levelMd({ id, title })),
]);

await writeFile(registryPath, appendRegistry(registry, { id, title, exportName: names.exportName }));
console.log(`Scaffolded src/levels/${id}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`);
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function titleFromId(value) {
  return value.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function namesForId(value) {
  const parts = value.split('-').filter(Boolean);
  const pascal = parts.map((part) => part[0].toUpperCase() + part.slice(1)).join('');
  const camel = pascal[0].toLowerCase() + pascal.slice(1);
  const constant = parts.join('_').toUpperCase();
  return { pascal, camel, constant, exportName: `${camel}Level` };
}

function appendRegistry(source, { id, title, exportName }) {
  const metadataLine = `  { id: '${id}', title: '${escapeSingle(title)}' },`;
  const withMetadata = source.replace(/(export const levelMetadatas: LevelMetadata\[] = \[[\s\S]*?)(\n\];)/, `$1\n${metadataLine}$2`);
  if (withMetadata === source) fail('Could not find levelMetadatas array in src/levels/index.ts');

  const caseBlock = `    case '${id}':\n      return (await import('./${id}')).${exportName};\n`;
  const withSwitch = withMetadata.replace(/(    default:\n      throw new Error\(`Unknown level: \$\{matched\.id\}`\);\n)/, `${caseBlock}$1`);
  if (withSwitch === withMetadata) fail('Could not find getLevelById default case in src/levels/index.ts');
  return withSwitch;
}

function escapeSingle(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function indexTs({ id, title, exportName, constant, camel }) {
  return `import type { LevelDefinition } from '../../engine/types';\nimport { createLockOnRunner } from '../../engine/lock-on-runner';\nimport { createAudio } from './audio';\nimport { ${constant}_BPM, ${camel}Gameplay } from './gameplay';\nimport {\n  createEnemyMesh,\n  createEnvironment,\n  createProjectileMesh,\n  createReticle,\n  installVisualEventHandlers,\n  setEnemyDenied,\n  setEnemyLocked,\n  setReticleActive,\n} from './visuals';\n\nexport const ${exportName}: LevelDefinition = {\n  id: '${id}',\n  title: '${escapeSingle(title)}',\n  description: 'TODO: replace this scaffold description.',\n  bpm: ${constant}_BPM,\n  post: {\n    clearColor: 0x000000,\n    bloom: { strength: 0.5, threshold: 0.7, radius: 0.1 },\n    vignette: { inner: 0.3, outer: 1.0, strength: 0.5 },\n  },\n  createAudio,\n  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {\n    createEnvironment(scene);\n    installVisualEventHandlers(bus, scene);\n\n    const game = createLockOnRunner({\n      scene,\n      camera,\n      canvas,\n      bus,\n      hud,\n      onPause,\n      onFullscreen,\n      startTip,\n      level: ${camel}Gameplay,\n      visuals: {\n        createEnemyMesh,\n        setEnemyLocked,\n        setEnemyDenied,\n        createProjectileMesh,\n        createReticle,\n        setReticleActive,\n      },\n    });\n\n    return {\n      update(dt) {\n        game.update(dt);\n      },\n      dispose() {\n        game.dispose();\n      },\n    };\n  },\n};\n`;
}

function gameplayTs({ bpm, pascal, camel, constant }) {
  return `import { CatmullRomCurve3, Vector3 } from 'three';\nimport type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';\n\nexport const ${constant}_BPM = ${bpm};\nexport const ${constant}_RUN_DURATION = 45;\n\nexport type ${pascal}EnemyKind = string;\nexport type ${pascal}SpawnData = Record<string, never>;\n\nexport function create${pascal}Rail() {\n  // TODO: replace this plain placeholder curve with the level's authored rail.\n  return new CatmullRomCurve3(\n    [\n      new Vector3(0, 0, 0),\n      new Vector3(0, 0, -40),\n      new Vector3(0, 0, -80),\n      new Vector3(0, 0, -120),\n    ],\n    false,\n    'catmullrom',\n    0.5,\n  );\n}\n\nexport const ${constant}_SPAWN_TIMELINE: Array<LockOnSpawnEntry<${pascal}EnemyKind, ${pascal}SpawnData>> = [];\n\nexport const ${camel}Gameplay: LockOnRunnerLevel<${pascal}EnemyKind, ${pascal}SpawnData> = {\n  duration: ${constant}_RUN_DURATION,\n  bpm: ${constant}_BPM,\n  createRail: create${pascal}Rail,\n  spawnTimeline: ${constant}_SPAWN_TIMELINE,\n  updateEnemy() {\n    // TODO: replace this stub when the spawn timeline gains authored enemies.\n    return false;\n  },\n};\n`;
}

function audioTs({ constant }) {
  return `import type { EventBus } from '../../events';\nimport { createLevelAudioKit, createStepTransport } from '../../engine/audio-kit';\nimport { emitBeatAt, secondsPerStep } from '../../engine/music';\nimport { ${constant}_BPM } from './gameplay';\n\n// Spine: keep arrangement, harmony, section structure, and timing decisions here.\n// Move synth voice construction to leaf files as this level grows. This scaffold\n// intentionally emits beat events while playing silence.\nconst BEAT_SECONDS = secondsPerStep(${constant}_BPM, 1);\nconst SCHEDULE_AHEAD = 0.16;\nconst SCHEDULER_MS = 25;\n\nexport function createAudio(bus: EventBus) {\n  let contextRef: AudioContext | null = null;\n  let silentOutput: GainNode | null = null;\n\n  const transport = createStepTransport({\n    stepSeconds: BEAT_SECONDS,\n    scheduleAhead: SCHEDULE_AHEAD,\n    startDelay: 0.06,\n    onStep({ index, time }) {\n      if (contextRef) emitBeatAt(bus, contextRef, time, index, index % 4 === 0);\n    },\n  });\n\n  return createLevelAudioKit({\n    schedulerMs: SCHEDULER_MS,\n    onCreateContext(context) {\n      contextRef = context;\n      silentOutput = context.createGain();\n      silentOutput.gain.value = 0;\n      silentOutput.connect(context.destination);\n      transport.start(context);\n    },\n    onSchedule(context) {\n      transport.schedule(context);\n    },\n    onDispose() {\n      silentOutput?.disconnect();\n      silentOutput = null;\n      contextRef = null;\n    },\n  });\n}\n`;
}

function visualsTs() {
  return `import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry } from 'three';\nimport type { Object3D } from 'three';\nimport type { EventBus } from '../../../events';\nimport { glyphOnCells } from '../../../engine/glyphs';\n\n// Spine: keep palette and event choreography decisions here. Move mesh\n// construction to leaf files as this level grows. These flat magenta primitive\n// placeholders are intentionally unshippable.\nconst MAGENTA = 0xff00ff;\nconst material = () => new MeshBasicMaterial({ color: MAGENTA, side: DoubleSide });\n\nexport function createEnvironment(_scene: Scene) {\n  // Empty by design: replace with authored environment geometry.\n}\n\nexport function installVisualEventHandlers(_bus: EventBus, _scene: Scene) {\n  // Empty by design: replace with authored event choreography.\n}\n\nexport function createEnemyMesh(kind: string, letter?: string) {\n  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');\n  return new Mesh(new SphereGeometry(0.75, 8, 6), material());\n}\n\nexport function setEnemyLocked(mesh: Object3D, locked: boolean) {\n  mesh.scale.setScalar(locked ? 1.25 : 1);\n}\n\nexport function setEnemyDenied(mesh: Object3D) {\n  mesh.scale.setScalar(0.75);\n}\n\nexport function createProjectileMesh() {\n  return new Mesh(new SphereGeometry(0.16, 8, 4), material());\n}\n\nexport function createReticle() {\n  return new Mesh(new RingGeometry(0.5, 0.56, 24), material());\n}\n\nexport function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {\n  reticle.visible = true;\n  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.1 : 0));\n}\n\nfunction createLetterMesh(character: string) {\n  const group = new Group();\n  const cells = glyphOnCells(character);\n  const geometry = new BoxGeometry(0.24, 0.24, 0.08);\n  for (const cell of cells) {\n    const block = new Mesh(geometry, material());\n    block.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);\n    group.add(block);\n  }\n  group.add(new Mesh(new TorusGeometry(0.95, 0.025, 6, 24), material()));\n  return group;\n}\n`;
}

function levelMd({ id, title }) {
  return `# ${title}\n\nTODO: one short paragraph naming the world, mood, and what makes this level recognizable at a glance and by ear.\n\n## Visual language\nTODO.\n\n## Musical language\nTODO.\n\n## Mechanical signature\nTODO.\n\n## What to read\n- \`src/levels/${id}/index.ts\`\n- \`src/levels/${id}/gameplay.ts\`\n- \`src/levels/${id}/audio.ts\`\n- \`src/levels/${id}/visuals/index.ts\`\n\n## Status & notes\nTODO. Preserve owner notes on regeneration.\n`;
}
