import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDefault = path.join(appRoot, 'data', 'simulated-clinic');

function latestTempSimulatedDir() {
  const dirs = fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('v2-sim-data-'))
    .map((name) => path.join(os.tmpdir(), name))
    .filter((dir) => fs.statSync(dir).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0];
}

export function resolveSimulatedDataDir() {
  const candidates = [];
  if (process.env.V2_SIM_DATA_DIR) {
    candidates.push(path.resolve(process.env.V2_SIM_DATA_DIR));
  }
  candidates.push(repoDefault);
  candidates.push(latestTempSimulatedDir());
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'v2.sqlite'))) ?? null;
}
