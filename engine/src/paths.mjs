// Where the lets engine keeps state. Everything lives under ~/.lets (override with LETS_HOME).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOME = process.env.LETS_HOME || path.join(os.homedir(), '.lets');

export const DIRS = {
  home: HOME,
  run: path.join(HOME, 'run'),
  uploads: path.join(HOME, 'uploads'),
  exports: path.join(HOME, 'exports'),
  uniques: path.join(HOME, 'uniques'),
  stores: path.join(HOME, 'stores'),
  entity: path.join(HOME, 'entity'),
  entitySkills: path.join(HOME, 'entity', 'skills'),
  router: path.join(HOME, 'router'),
  logs: path.join(HOME, 'logs'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

/** True when `child` is inside `parent` (both resolved). */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
