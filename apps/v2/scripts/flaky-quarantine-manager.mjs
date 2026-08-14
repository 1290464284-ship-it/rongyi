import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = path.resolve(import.meta.dirname, '..');
const registryPath = path.join(appRoot, 'flaky-quarantine', 'registry.json');

function loadRegistry() {
  if (!fs.existsSync(registryPath)) {
    return { version: 1, quarantinedTests: [] };
  }
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function saveRegistry(registry) {
  registry.lastUpdated = new Date().toISOString();
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

function getQuarantinedFiles() {
  const registry = loadRegistry();
  return [...new Set(registry.quarantinedTests.map((entry) => entry.file))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command] = process.argv.slice(2);
  if (command === 'files') {
    console.log(JSON.stringify(getQuarantinedFiles()));
  } else if (command === 'list') {
    console.log(JSON.stringify(loadRegistry(), null, 2));
  } else {
    console.error('usage: node flaky-quarantine-manager.mjs <files|list>');
    process.exit(1);
  }
}

export { getQuarantinedFiles, loadRegistry, saveRegistry };
