function normalizeOpenApiPath(path) {
  return path.startsWith('/api/v2') ? (path.slice('/api/v2'.length) || '/') : path;
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
