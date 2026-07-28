import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');

const results = {
  godClasses: [],
  godMethods: [],
  longParameterLists: [],
  deepNesting: [],
  magicNumbers: [],
  magicStrings: [],
  deadCode: [],
  inconsistentNaming: [],
  commentIssues: [],
  duplicateCode: [],
  shotgunSurgery: [],
};

const stats = {
  totalFiles: 0,
  totalLines: 0,
  totalCodeLines: 0,
  totalClasses: 0,
  totalMethods: 0,
  totalFunctions: 0,
};

function walkDir(dir, options = {}) {
  const { exclude = ['node_modules', 'dist', 'coverage', '.git'], extensions = null } = options;
  const results = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(projectRoot, fullPath);

    if (exclude.some(ex => entry.name === ex || relativePath.startsWith(ex))) {
      continue;
    }

    if (entry.isDirectory()) {
      const subResults = walkDir(fullPath, options);
      results.push(...subResults);
    } else if (entry.isFile()) {
      if (extensions === null || extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;

  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      blankLines++;
      continue;
    }

    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith('//')) {
      commentLines++;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }

    codeLines++;
  }

  return {
    total: lines.length,
    code: codeLines,
    comment: commentLines,
    blank: blankLines,
  };
}

function findClassesAndMethods(content, filePath) {
  const lines = content.split('\n');
  const classes = [];
  const methods = [];
  
  let currentClass = null;
  let classStartLine = 0;
  let classBraceCount = 0;
  let inClass = false;
  
  let currentMethod = null;
  let methodStartLine = 0;
  let methodBraceCount = 0;
  let inMethod = false;
  
  let inString = false;
  let stringChar = '';
  
  let decoratorBuffer = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"' || char === "'" || char === '`') {
        if (!inString || stringChar === char) {
          inString = !inString;
          stringChar = inString ? char : '';
        }
        continue;
      }
      
      if (inString) continue;
      
      if (char === '/' && line[j + 1] === '/') {
        break;
      }
    }
    
    if (trimmed.startsWith('@')) {
      decoratorBuffer.push(trimmed);
      continue;
    }
    
    const classMatch = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/);
    if (classMatch && !inClass) {
      inClass = true;
      currentClass = classMatch[3];
      classStartLine = i + 1;
      classBraceCount = 0;
      decoratorBuffer = [];
      continue;
    }
    
    if (inClass) {
      const methodMatch = trimmed.match(/^(?:(public|private|protected|static|async)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/);
      const constructorMatch = trimmed.match(/^constructor\s*\(/);
      
      if ((methodMatch || constructorMatch) && !inMethod) {
        inMethod = true;
        currentMethod = methodMatch ? methodMatch[1] : 'constructor';
        methodStartLine = i + 1;
        methodBraceCount = 0;
        const paramMatch = trimmed.match(/\(([^)]*)\)/);
        const params = paramMatch ? paramMatch[1].split(',').filter(p => p.trim()).length : 0;
        methods.push({
          name: currentMethod,
          className: currentClass,
          startLine: methodStartLine,
          endLine: 0,
          lineCount: 0,
          paramCount: params,
        });
      }
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '{') {
          classBraceCount++;
          if (inMethod) methodBraceCount++;
        }
        if (char === '}') {
          classBraceCount--;
          if (inMethod) {
            methodBraceCount--;
            if (methodBraceCount === 0) {
              const lastMethod = methods[methods.length - 1];
              if (lastMethod && lastMethod.name === currentMethod) {
                lastMethod.endLine = i + 1;
                lastMethod.lineCount = i + 1 - methodStartLine;
              }
              inMethod = false;
              currentMethod = null;
            }
          }
          if (classBraceCount === 0 && !inMethod) {
            classes.push({
              name: currentClass,
              startLine: classStartLine,
              endLine: i + 1,
              lineCount: i + 1 - classStartLine,
              methods: methods.filter(m => m.className === currentClass),
            });
            inClass = false;
            currentClass = null;
          }
        }
      }
    }
    
    if (!trimmed.startsWith('@')) {
      decoratorBuffer = [];
    }
  }
  
  return { classes, methods };
}

function findDeepNesting(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  let maxDepth = 0;
  let currentDepth = 0;
  let inString = false;
  let stringChar = '';
  
  const nestingStack = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"' || char === "'" || char === '`') {
        if (!inString || stringChar === char) {
          inString = !inString;
          stringChar = inString ? char : '';
        }
        continue;
      }
      
      if (inString) continue;
      
      if (char === '/' && line[j + 1] === '/') break;
    }
    
    const controlStructures = [
      { pattern: /\bif\s*\(/, type: 'if' },
      { pattern: /\bfor\s*\(/, type: 'for' },
      { pattern: /\bwhile\s*\(/, type: 'while' },
      { pattern: /\bswitch\s*\(/, type: 'switch' },
      { pattern: /\bcatch\s*\(/, type: 'catch' },
    ];
    
    for (const struct of controlStructures) {
      if (struct.pattern.test(trimmed)) {
        currentDepth++;
        nestingStack.push({ type: struct.type, line: i + 1, depth: currentDepth });
        if (currentDepth > maxDepth) {
          maxDepth = currentDepth;
        }
        if (currentDepth > 3) {
          issues.push({
            line: i + 1,
            depth: currentDepth,
            type: struct.type,
            context: trimmed.substring(0, 80),
          });
        }
        break;
      }
    }
    
    const closeBraces = (line.match(/}/g) || []).length;
    const openBraces = (line.match(/\{/g) || []).length;
    const netClose = closeBraces - openBraces;
    
    if (netClose > 0) {
      for (let k = 0; k < netClose && nestingStack.length > 0; k++) {
        nestingStack.pop();
        currentDepth--;
      }
    }
  }
  
  return { issues, maxDepth };
}

function findMagicNumbers(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  const allowedNumbers = new Set([0, 1, 2, -1, 10, 100, 1000]);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (trimmed.includes('import ')) continue;
    if (trimmed.includes('const ') && trimmed.includes('=')) continue;
    if (trimmed.match(/^\s*(export\s+)?(const|let|var)\s+\w+\s*=/)) continue;
    
    let inString = false;
    let stringChar = '';
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"' || char === "'" || char === '`') {
        if (!inString || stringChar === char) {
          inString = !inString;
          stringChar = inString ? char : '';
        }
        continue;
      }
      
      if (inString) continue;
      
      if (char === '/' && line[j + 1] === '/') break;
    }
    
    const numberMatches = line.match(/\b\d+\.?\d*\b/g);
    if (numberMatches) {
      for (const numStr of numberMatches) {
        const num = parseFloat(numStr);
        if (!allowedNumbers.has(num) && !isNaN(num)) {
          issues.push({
            line: i + 1,
            value: numStr,
            context: trimmed.substring(0, 80),
          });
          break;
        }
      }
    }
  }
  
  return issues.slice(0, 20);
}

function findMagicStrings(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  const commonStrings = new Set([
    'id', 'name', 'status', 'createdAt', 'updatedAt', 'deletedAt',
    'success', 'error', 'fail', 'ok', 'true', 'false', 'null', 'undefined',
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH',
    'json', 'text', 'html',
    'en', 'zh', 'zh-CN',
    'admin', 'user', 'guest',
  ]);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (trimmed.includes('import ')) continue;
    if (trimmed.match(/^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*['"`]/)) continue;
    if (trimmed.includes('.message') || trimmed.includes('.toString()')) continue;
    
    const stringMatches = line.match(/['"`]([^'"`\n]{3,})['"`]/g);
    if (stringMatches) {
      for (const str of stringMatches) {
        const inner = str.slice(1, -1);
        if (inner.length > 3 && !commonStrings.has(inner.toLowerCase()) && !inner.includes(' ')) {
          if (!inner.match(/^[a-z][a-zA-Z0-9_-]*$/i)) continue;
          if (inner.includes('.')) continue;
          if (inner.includes('/')) continue;
          
          issues.push({
            line: i + 1,
            value: inner.substring(0, 50),
            context: trimmed.substring(0, 80),
          });
          break;
        }
      }
    }
  }
  
  return issues.slice(0, 10);
}

function findDeadCode(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.match(/^\/\/\s*(TODO|FIXME|HACK|XXX)/)) continue;
    
    if (trimmed.startsWith('//') && trimmed.length > 20 && !trimmed.match(/^\/\/\s*(@|param|returns|example|deprecated|see|throws)/)) {
      const codeLike = trimmed.substring(2).trim();
      if (codeLike.match(/^(const|let|var|function|class|if|for|while|return|throw|try|catch|import|export)/) ||
          codeLike.includes('=') && (codeLike.includes(';') || codeLike.includes('{'))) {
        issues.push({
          line: i + 1,
          type: 'commented-out-code',
          context: trimmed.substring(0, 80),
        });
      }
    }
  }
  
  return issues.slice(0, 10);
}

function findLongParameterLists(methods, filePath) {
  return methods
    .filter(m => m.paramCount > 5)
    .map(m => ({
      method: m.name,
      className: m.className,
      paramCount: m.paramCount,
      line: m.startLine,
    }));
}

function estimateDuplication(files) {
  const lineFingerprints = new Map();
  const duplicates = [];
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const relativePath = path.relative(projectRoot, file);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.length < 30) continue;
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import') || line.startsWith('export')) continue;
      if (line.match(/^\s*$/)) continue;
      
      const fingerprint = line.replace(/\s+/g, ' ').replace(/['"`]/g, '').toLowerCase();
      
      if (lineFingerprints.has(fingerprint)) {
        const existing = lineFingerprints.get(fingerprint);
        duplicates.push({
          line1: { file: existing.file, line: existing.line },
          line2: { file: relativePath, line: i + 1 },
          content: line.substring(0, 100),
        });
      } else {
        lineFingerprints.set(fingerprint, { file: relativePath, line: i + 1 });
      }
    }
  }
  
  return duplicates.slice(0, 30);
}

function analyzeNaming(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  
  let camelCaseCount = 0;
  let snakeCaseCount = 0;
  let pascalCaseCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (trimmed.includes('import ')) continue;
    
    const varMatches = trimmed.match(/\b(?:const|let|var)\s+(\w+)/g);
    if (varMatches) {
      for (const match of varMatches) {
        const name = match.split(/\s+/)[1];
        if (name.match(/^[a-z][a-z0-9]*$/)) {
          camelCaseCount++;
        } else if (name.match(/^[a-z][a-z0-9_]*$/)) {
          snakeCaseCount++;
        }
      }
    }
    
    const classMatches = trimmed.match(/\bclass\s+(\w+)/g);
    if (classMatches) {
      for (const match of classMatches) {
        const name = match.split(/\s+/)[1];
        if (name.match(/^[A-Z][A-Za-z0-9]*$/)) {
          pascalCaseCount++;
        }
      }
    }
  }
  
  if (snakeCaseCount > 0 && camelCaseCount > 0) {
    issues.push({
      type: 'mixed-naming',
      camelCase: camelCaseCount,
      snakeCase: snakeCaseCount,
    });
  }
  
  return issues;
}

function analyzeComments(content, filePath) {
  const lines = content.split('\n');
  const issues = [];
  
  let codeLines = 0;
  let commentLines = 0;
  let inBlockComment = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') continue;
    
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }
    
    if (trimmed.startsWith('//')) {
      commentLines++;
      continue;
    }
    
    if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }
    
    codeLines++;
  }
  
  const ratio = codeLines > 0 ? commentLines / codeLines : 0;
  
  if (ratio > 0.5) {
    issues.push({
      type: 'too-many-comments',
      ratio: (ratio * 100).toFixed(1) + '%',
      codeLines,
      commentLines,
    });
  }
  
  return issues;
}

function main() {
  console.log('开始代码坏味道审计...\n');
  
  const tsFiles = walkDir(srcDir, { extensions: ['.ts'] });
  const sourceFiles = tsFiles.filter(f => !f.endsWith('.spec.ts') && !f.endsWith('.test.ts') && !f.includes('__mocks__') && !f.includes('test-helpers') && !f.includes('test-helper'));
  
  stats.totalFiles = sourceFiles.length;
  
  console.log(`扫描文件数: ${sourceFiles.length}\n`);
  
  const allMethods = [];
  const allClasses = [];
  
  for (const file of sourceFiles) {
    const relativePath = path.relative(projectRoot, file);
    const content = fs.readFileSync(file, 'utf-8');
    const lineStats = countLines(file);
    
    stats.totalLines += lineStats.total;
    stats.totalCodeLines += lineStats.code;
    
    const { classes, methods } = findClassesAndMethods(content, file);
    allClasses.push(...classes.map(c => ({ ...c, file: relativePath })));
    allMethods.push(...methods.map(m => ({ ...m, file: relativePath })));
    
    stats.totalClasses += classes.length;
    stats.totalMethods += methods.length;
    
    for (const cls of classes) {
      if (cls.lineCount > 300) {
        results.godClasses.push({
          file: relativePath,
          className: cls.name,
          lineCount: cls.lineCount,
          startLine: cls.startLine,
          endLine: cls.endLine,
          methodCount: cls.methods.length,
        });
      }
    }
    
    for (const method of methods) {
      if (method.lineCount > 50) {
        results.godMethods.push({
          file: relativePath,
          className: method.className,
          methodName: method.name,
          lineCount: method.lineCount,
          startLine: method.startLine,
          endLine: method.endLine,
        });
      }
    }
    
    const longParams = findLongParameterLists(methods, file);
    for (const lp of longParams) {
      results.longParameterLists.push({
        file: relativePath,
        ...lp,
      });
    }
    
    const nesting = findDeepNesting(content, file);
    for (const issue of nesting.issues) {
      results.deepNesting.push({
        file: relativePath,
        ...issue,
      });
    }
    
    const magicNums = findMagicNumbers(content, file);
    for (const issue of magicNums) {
      results.magicNumbers.push({
        file: relativePath,
        ...issue,
      });
    }
    
    const magicStrs = findMagicStrings(content, file);
    for (const issue of magicStrs) {
      results.magicStrings.push({
        file: relativePath,
        ...issue,
      });
    }
    
    const deadCode = findDeadCode(content, file);
    for (const issue of deadCode) {
      results.deadCode.push({
        file: relativePath,
        ...issue,
      });
    }
    
    const namingIssues = analyzeNaming(content, file);
    for (const issue of namingIssues) {
      results.inconsistentNaming.push({
        file: relativePath,
        ...issue,
      });
    }
    
    const commentIssues = analyzeComments(content, file);
    for (const issue of commentIssues) {
      results.commentIssues.push({
        file: relativePath,
        ...issue,
      });
    }
  }
  
  results.duplicateCode = estimateDuplication(sourceFiles);
  
  const fileMethodCounts = new Map();
  for (const method of allMethods) {
    const count = fileMethodCounts.get(method.file) || 0;
    fileMethodCounts.set(method.file, count + 1);
  }
  
  const avgMethodsPerFile = allMethods.length / sourceFiles.length;
  for (const [file, count] of fileMethodCounts.entries()) {
    if (count > avgMethodsPerFile * 2 && count > 10) {
      results.shotgunSurgery.push({
        file,
        methodCount: count,
        risk: count > 20 ? 'high' : 'medium',
      });
    }
  }
  
  printReport();
}

function printReport() {
  console.log('═'.repeat(70));
  console.log('  代码坏味道审计报告');
  console.log('═'.repeat(70));
  console.log('');
  
  console.log('📊 基础统计');
  console.log('─'.repeat(70));
  console.log(`  源码文件数:      ${stats.totalFiles}`);
  console.log(`  总行数:          ${stats.totalLines.toLocaleString()}`);
  console.log(`  代码行数:        ${stats.totalCodeLines.toLocaleString()}`);
  console.log(`  类总数:          ${stats.totalClasses}`);
  console.log(`  方法总数:        ${stats.totalMethods}`);
  console.log(`  平均每类方法数:    ${(stats.totalMethods / Math.max(stats.totalClasses, 1)).toFixed(1)}`);
  console.log('');
  
  let totalIssues = 0;
  let highSeverityIssues = 0;
  let mediumSeverityIssues = 0;
  let lowSeverityIssues = 0;
  
  const issueTypes = [
    { key: 'godClasses', label: '上帝类 (>300行)', severity: 'high' },
    { key: 'godMethods', label: '上帝方法 (>50行)', severity: 'high' },
    { key: 'longParameterLists', label: '过长参数列表 (>5个)', severity: 'medium' },
    { key: 'deepNesting', label: '深层嵌套 (>3层)', severity: 'high' },
    { key: 'magicNumbers', label: '魔法数字', severity: 'medium' },
    { key: 'magicStrings', label: '魔法字符串', severity: 'low' },
    { key: 'deadCode', label: '死代码/注释代码', severity: 'medium' },
    { key: 'inconsistentNaming', label: '命名不一致', severity: 'low' },
    { key: 'commentIssues', label: '注释问题', severity: 'low' },
    { key: 'duplicateCode', label: '重复代码', severity: 'high' },
    { key: 'shotgunSurgery', label: '散弹式修改风险', severity: 'medium' },
  ];
  
  console.log('📋 坏味道汇总');
  console.log('─'.repeat(70));
  console.log('');
  
  for (const type of issueTypes) {
    const count = results[type.key].length;
    totalIssues += count;
    if (type.severity === 'high') highSeverityIssues += count;
    else if (type.severity === 'medium') mediumSeverityIssues += count;
    else lowSeverityIssues += count;
    
    const severityIcon = type.severity === 'high' ? '🔴' : type.severity === 'medium' ? '🟡' : '🟢';
    console.log(`  ${severityIcon} ${type.label.padEnd(25)} ${String(count).padStart(6)} 个`);
  }
  
  console.log('');
  console.log(`  总计问题数:        ${totalIssues} 个`);
  console.log(`  严重 (高):       ${highSeverityIssues} 个`);
  console.log(`  严重 (中):       ${mediumSeverityIssues} 个`);
  console.log(`  严重 (低):       ${lowSeverityIssues} 个`);
  console.log('');
  
  let score = 100;
  
  score -= Math.min(results.godClasses.length * 5, 15);
  score -= Math.min(results.godMethods.length * 2, 15);
  score -= Math.min(results.deepNesting.length * 1, 10);
  score -= Math.min(results.duplicateCode.length * 0.5, 10);
  score -= Math.min(results.longParameterLists.length * 1, 10);
  score -= Math.min(results.magicNumbers.length * 0.2, 5);
  score -= Math.min(results.deadCode.length * 0.3, 5);
  score -= Math.min(results.shotgunSurgery.length * 3, 10);
  
  score = Math.max(0, Math.min(100, score));
  
  console.log('⭐ 代码质量评分');
  console.log('─'.repeat(70));
  console.log('');
  console.log(`  综合评分:  ${score.toFixed(0)} / 100`);
  
  let grade = '优秀';
  let gradeColor = '🟢';
  if (score < 60) { grade = '需要关注'; gradeColor = '🔴'; }
  else if (score < 75) { grade = '一般'; gradeColor = '🟡'; }
  else if (score < 90) { grade = '良好'; gradeColor = '🔵'; }
  
  console.log(`  等级:      ${gradeColor} ${grade}`);
  console.log('');
  
  console.log('📝 详细问题列表');
  console.log('═'.repeat(70));
  
  if (results.godClasses.length > 0) {
    console.log('');
    console.log('🔴 1. 上帝类 (>300行)');
    console.log('─'.repeat(70));
    results.godClasses
      .sort((a, b) => b.lineCount - a.lineCount)
      .slice(0, 10)
      .forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.className}`);
        console.log(`     文件: ${c.file}`);
        console.log(`     行数: ${c.lineCount} 行 (${c.startLine}-${c.endLine})`);
        console.log(`     方法数: ${c.methodCount}`);
        console.log('');
      });
  }
  
  if (results.godMethods.length > 0) {
    console.log('');
    console.log('🔴 2. 上帝方法 (>50行)');
    console.log('─'.repeat(70));
    results.godMethods
      .sort((a, b) => b.lineCount - a.lineCount)
      .slice(0, 15)
      .forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.className}.${m.methodName}`);
        console.log(`     文件: ${m.file}`);
        console.log(`     行数: ${m.lineCount} 行 (${m.startLine}-${m.endLine})`);
        console.log('');
      });
  }
  
  if (results.deepNesting.length > 0) {
    console.log('');
    console.log('🔴 3. 深层嵌套 (>3层)');
    console.log('─'.repeat(70));
    results.deepNesting
      .sort((a, b) => b.depth - a.depth)
      .slice(0, 15)
      .forEach((n, i) => {
        console.log(`  ${i + 1}. 第 ${n.line} 行 - ${n.type} 嵌套深度: ${n.depth} 层`);
        console.log(`     文件: ${n.file}`);
        console.log(`     上下文: ${n.context}`);
        console.log('');
      });
  }
  
  if (results.duplicateCode.length > 0) {
    console.log('');
    console.log('🔴 4. 重复代码');
    console.log('─'.repeat(70));
    results.duplicateCode.slice(0, 10).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.line1.file}:${d.line1.line}`);
      console.log(`     ↔ ${d.line2.file}:${d.line2.line}`);
      console.log(`     内容: ${d.content.substring(0, 60)}...`);
      console.log('');
    });
  }
  
  if (results.longParameterLists.length > 0) {
    console.log('');
    console.log('🟡 5. 过长参数列表 (>5个)');
    console.log('─'.repeat(70));
    results.longParameterLists
      .sort((a, b) => b.paramCount - a.paramCount)
      .slice(0, 10)
      .forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.className}.${p.method} - ${p.paramCount} 个参数`);
        console.log(`     文件: ${p.file}:${p.line}`);
        console.log('');
      });
  }
  
  if (results.shotgunSurgery.length > 0) {
    console.log('');
    console.log('🟡 6. 散弹式修改风险');
    console.log('─'.repeat(70));
    results.shotgunSurgery
      .sort((a, b) => b.methodCount - a.methodCount)
      .slice(0, 10)
      .forEach((s, i) => {
        const riskIcon = s.risk === 'high' ? '🔴' : '🟡';
        console.log(`  ${i + 1}. ${riskIcon} ${s.file} - ${s.methodCount} 个方法`);
        console.log('');
      });
  }
  
  if (results.magicNumbers.length > 0) {
    console.log('');
    console.log('🟡 7. 魔法数字 (部分示例)');
    console.log('─'.repeat(70));
    results.magicNumbers.slice(0, 10).forEach((m, i) => {
      console.log(`  ${i + 1}. 第 ${m.line} 行 - 值: ${m.value}`);
      console.log(`     文件: ${m.file}`);
      console.log('');
    });
  }
  
  if (results.deadCode.length > 0) {
    console.log('');
    console.log('🟡 8. 死代码/注释掉的代码 (部分示例)');
    console.log('─'.repeat(70));
    results.deadCode.slice(0, 10).forEach((d, i) => {
      console.log(`  ${i + 1}. 第 ${d.line} 行`);
      console.log(`     文件: ${d.file}`);
      console.log(`     ${d.context.substring(0, 80)}`);
      console.log('');
    });
  }
  
  console.log('');
  console.log('💡 优先修复建议');
  console.log('═'.repeat(70));
  console.log('');
  
  const suggestions = [];
  
  if (results.godClasses.length > 0) {
    suggestions.push({
      priority: 1,
      title: '拆分上帝类',
      description: `有 ${results.godClasses.length} 个类超过300行，建议按职责拆分为多个小类`,
      effort: '高',
    });
  }
  
  if (results.godMethods.length > 0) {
    suggestions.push({
      priority: 2,
      title: '重构上帝方法',
      description: `有 ${results.godMethods.length} 个方法超过50行，建议提取子方法降低复杂度`,
      effort: '中高',
    });
  }
  
  if (results.deepNesting.length > 0) {
    suggestions.push({
      priority: 3,
      title: '简化深层嵌套',
      description: `有 ${results.deepNesting.length} 处嵌套超过3层，建议使用早返回、卫语句降低嵌套`,
      effort: '中',
    });
  }
  
  if (results.duplicateCode.length > 0) {
    suggestions.push({
      priority: 4,
      title: '消除重复代码',
      description: `发现 ${results.duplicateCode.length} 处重复代码，建议提取公共函数或类`,
      effort: '中',
    });
  }
  
  if (results.longParameterLists.length > 0) {
    suggestions.push({
      priority: 5,
      title: '优化参数列表',
      description: `有 ${results.longParameterLists.length} 个方法参数超过5个，考虑使用参数对象`,
      effort: '低中',
    });
  }
  
  if (results.magicNumbers.length > 0) {
    suggestions.push({
      priority: 6,
      title: '提取魔法数字/字符串',
      description: `发现多个硬编码值，建议提取为命名常量或枚举`,
      effort: '低',
    });
  }
  
  if (results.deadCode.length > 0) {
    suggestions.push({
      priority: 7,
      title: '清理死代码',
      description: `有 ${results.deadCode.length} 处注释掉的代码，建议删除或恢复`,
      effort: '低',
    });
  }
  
  for (const s of suggestions) {
    console.log(`  ${s.priority}. ${s.title}`);
    console.log(`     描述: ${s.description}`);
    console.log(`     工作量: ${s.effort}`);
    console.log('');
  }
  
  console.log('═'.repeat(70));
  console.log('  报告生成完成');
  console.log('═'.repeat(70));
}

main();
