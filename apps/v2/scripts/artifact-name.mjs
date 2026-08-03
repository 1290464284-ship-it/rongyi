export function installerFileName(pkg) {
  const template = pkg.build.artifactName ?? `${pkg.build.productName} Setup ${pkg.version}.${'ext'}`;
  return template
    .replaceAll('${version}', pkg.version)
    .replaceAll('${ext}', 'exe');
}
