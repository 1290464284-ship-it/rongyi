// 子路径 stub（rxjs/ajax 等）不是独立依赖；scoped 包 @scope/name 是真实依赖。
export function isSubpathStub(name) {
  return name.startsWith('@')
    ? name.split('/').length !== 2
    : name.includes('/');
}
