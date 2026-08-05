import fs from 'node:fs';

export function filesExist(paths) {
  const missing = paths.filter((file) => !fs.existsSync(file));
  if (missing.length === 0) return true;
  for (const file of missing) {
    console.error(`missing artifact: ${file}`);
  }
  process.exit(1);
}
