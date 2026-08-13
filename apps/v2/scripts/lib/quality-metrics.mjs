function normalizeOpenApiPath(path) {
  const trimmed = path.startsWith('/api/v2') ? (path.slice('/api/v2'.length) || '/') : path;
  return trimmed.replace(/:[A-Za-z0-9_]+/g, (segment) => `{${segment.slice(1)}}`);
}

export function coverageStats(data) {
  const files = data && typeof data === 'object' ? Object.values(data) : [];
  let statements = 0;
  let branches = 0;
  let functions = 0;
  let lines = 0;
  let statementsHit = 0;
  let branchesHit = 0;
  let functionsHit = 0;
  let linesHit = 0;

  for (const file of files) {
    for (const count of Object.values(file.s ?? {})) {
      statements += 1;
      if (count > 0) statementsHit += 1;
    }
    for (const counts of Object.values(file.b ?? {})) {
      if (!Array.isArray(counts)) continue;
      for (const count of counts) {
        branches += 1;
        if (count > 0) branchesHit += 1;
      }
    }
    for (const count of Object.values(file.f ?? {})) {
      functions += 1;
      if (count > 0) functionsHit += 1;
    }
    const statementLines = new Set();
    const coveredLines = new Set();
    for (const [key, location] of Object.entries(file.statementMap ?? {})) {
      const line = location?.start?.line;
      if (typeof line !== 'number') continue;
      statementLines.add(line);
      if (Number(file.s?.[key] ?? 0) > 0) coveredLines.add(line);
    }
    lines += statementLines.size;
    linesHit += coveredLines.size;
  }

  return {
    statements: statements ? statementsHit / statements : 1,
    branches: branches ? branchesHit / branches : 1,
    functions: functions ? functionsHit / functions : 1,
    lines: lines ? linesHit / lines : 1,
  };
}

export function mutationScore(mutants) {
  const all = Array.isArray(mutants) ? mutants : [];
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  for (const mutant of all) {
    if (mutant.status === 'Killed' || mutant.status === 'Timeout') killed += 1;
    else if (mutant.status === 'Survived') survived += 1;
    else if (mutant.status === 'NoCoverage') noCoverage += 1;
  }
  const total = killed + survived + noCoverage;
  return {
    killed,
    survived,
    noCoverage,
    score: total ? killed / total : null,
  };
}

export function openApiPathMetrics({ coreDoc, generatedDoc, routeEntries } = {}) {
  const corePaths = Object.keys(coreDoc?.paths ?? {});
  const generatedPaths = Object.keys(generatedDoc?.paths ?? {});
  const documented = new Set([...corePaths, ...generatedPaths]);
  const routes = Array.isArray(routeEntries) ? routeEntries : [];
  const uniqueRoutes = new Set(
    routes.map((route) => `${String(route.method ?? '').toUpperCase()} ${normalizeOpenApiPath(String(route.path ?? ''))}`),
  );
  const uniqueRoutePaths = new Set(routes.map((route) => normalizeOpenApiPath(String(route.path ?? ''))));
  let coveredRoutePaths = 0;
  for (const routePath of uniqueRoutePaths) {
    if (documented.has(routePath)) coveredRoutePaths += 1;
  }
  return {
    corePaths: corePaths.length,
    generatedPaths: generatedPaths.length,
    documentedPaths: documented.size,
    routeEntries: routes.length,
    uniqueRoutes: uniqueRoutes.size,
    uniqueRoutePaths: uniqueRoutePaths.size,
    routePathCoverage: uniqueRoutePaths.size ? coveredRoutePaths / uniqueRoutePaths.size : 1,
  };
}
