const fs = require('fs');
const path = require('path');

const directories = [
  'src/modules',
  'src/common/services',
  'src/common/utils'
];

function findLargeFunctions(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const functions = [];
  
  let inFunction = false;
  let functionName = '';
  let startLine = 0;
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"' || char === "'") {
        if (!inString || stringChar === char) {
          inString = !inString;
          stringChar = inString ? char : '';
        }
      }
      
      if (!inString) {
        if (!inFunction) {
          const funcMatch = line.slice(j).match(/^(?:function\s+(\w+)|(\(\s*\))\s*=>|(\w+)\s*=\s*(?:async\s*)?\((?:[^)]*)\)\s*=>)/);
          if (funcMatch) {
            const name = funcMatch[1] || funcMatch[3] || 'anonymous';
            const afterFunc = line.slice(j + funcMatch[0].length);
            const braceMatch = afterFunc.match(/^\s*\{/);
            if (braceMatch) {
              inFunction = true;
              functionName = name;
              startLine = i + 1;
              braceCount = 1;
              j += funcMatch[0].length + braceMatch[0].length - 1;
            }
          }
        } else {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          
          if (braceCount === 0) {
            const lineCount = i + 1 - startLine;
            if (lineCount > 100) {
              functions.push({
                name: functionName,
                startLine,
                endLine: i + 1,
                lineCount
              });
            }
            inFunction = false;
          }
        }
      }
    }
  }
  
  return functions;
}

function findComplexConditions(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const conditions = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let inString = false;
    let stringChar = '';
    let parenDepth = 0;
    let inIfCondition = false;
    let conditionStart = 0;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"' || char === "'") {
        if (!inString || stringChar === char) {
          inString = !inString;
          stringChar = inString ? char : '';
        }
      }
      
      if (!inString) {
        if (line.slice(j).startsWith('if') || line.slice(j).startsWith('else if')) {
          inIfCondition = true;
          j += line.slice(j).startsWith('else if') ? 7 : 2;
        }
        
        if (inIfCondition && char === '(') {
          parenDepth = 1;
          conditionStart = j + 1;
        } else if (parenDepth > 0) {
          if (char === '(') parenDepth++;
          if (char === ')') parenDepth--;
          
          if (parenDepth === 0) {
            const parenContent = line.slice(conditionStart, j);
            const andCount = (parenContent.match(/&&/g) || []).length;
            const orCount = (parenContent.match(/\|\|/g) || []).length;
            const total = andCount + orCount;
            
            if (total > 3) {
              conditions.push({
                line: i + 1,
                content: line.trim(),
                andCount,
                orCount,
                total
              });
            }
            inIfCondition = false;
          }
        }
      }
    }
  }
  
  return conditions;
}

function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      scanDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      const largeFuncs = findLargeFunctions(fullPath);
      const complexConditions = findComplexConditions(fullPath);
      
      if (largeFuncs.length > 0) {
        console.log(`\n=== 大函数 (>100行) - ${fullPath}`);
        largeFuncs.forEach(f => {
          console.log(`  - ${f.name}: ${f.lineCount}行 (${f.startLine}-${f.endLine})`);
        });
      }
      
      if (complexConditions.length > 0) {
        console.log(`\n=== 复杂条件 (>3个条件) - ${fullPath}`);
        complexConditions.forEach(c => {
          console.log(`  - 第${c.line}行: ${c.andCount} &&, ${c.orCount} ||, ${c.total}个条件`);
          console.log(`    ${c.content}`);
        });
      }
    }
  });
}

directories.forEach(dir => scanDirectory(dir));
