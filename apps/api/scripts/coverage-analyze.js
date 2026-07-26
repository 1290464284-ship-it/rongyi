const fs = require('fs');

const lcov = fs.readFileSync('coverage/lcov.info', 'utf8');
const blocks = lcov.split('end_of_record').filter(b => b.trim());

const data = blocks.map(b => {
  const lines = b.split('\n');
  const fn = lines.find(l => l.startsWith('SF:'))?.slice(3) || '';
  const lh = parseInt(lines.find(l => l.startsWith('LH:'))?.slice(3) || '0');
  const lf = parseInt(lines.find(l => l.startsWith('LF:'))?.slice(3) || '0');
  const fh = parseInt(lines.find(l => l.startsWith('FNH:'))?.slice(4) || '0');
  const ff = parseInt(lines.find(l => l.startsWith('FNF:'))?.slice(4) || '0');
  const brh = parseInt(lines.find(l => l.startsWith('BRH:'))?.slice(4) || '0');
  const brf = parseInt(lines.find(l => l.startsWith('BRF:'))?.slice(4) || '0');
  return {
    file: fn,
    lines: lf,
    hit: lh,
    pct: lf ? (lh / lf * 100).toFixed(1) : '100',
    fnPct: ff ? (fh / ff * 100).toFixed(1) : '100',
    brPct: brf ? (brh / brf * 100).toFixed(1) : '100',
  };
}).filter(d => d.lines > 0 && d.file.includes('src') && !d.file.includes('.spec.'));

const byModule = {};
for (const d of data) {
  const parts = d.file.replace(/\\/g, '/').split('/');
  const idx = parts.indexOf('modules');
  const module = parts.slice(idx, idx + 2).join('/');
  if (!byModule[module]) byModule[module] = { lines: 0, hit: 0, fn: 0, fnHit: 0, br: 0, brHit: 0 };
  byModule[module].lines += d.lines;
  byModule[module].hit += d.hit;
}

const moduleSummary = Object.entries(byModule).map(([name, m]) => ({
  name,
  lines: m.lines,
  pct: m.lines ? (m.hit / m.lines * 100).toFixed(1) : '100',
})).sort((a, b) => parseFloat(a.pct) - parseFloat(b.pct));

console.log('=== Modules by lowest coverage ===');
for (const m of moduleSummary) {
  console.log(`${m.pct.padStart(5)}%  ${m.lines.toString().padStart(5)} lines  ${m.name}`);
}

console.log('\n=== 40 lowest coverage files ===');
const sorted = data.sort((a, b) => parseFloat(a.pct) - parseFloat(b.pct));
for (const d of sorted.slice(0, 40)) {
  console.log(`${d.pct.padStart(5)}%  ${d.lines.toString().padStart(4)} lines  ${d.file}`);
}
