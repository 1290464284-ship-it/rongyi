# Dental Clinic V2 - Release Artifacts

## Generated Artifacts

- `release-v2/Dental Clinic V2 Setup <version>.exe`
- `release-v2/Dental Clinic V2 Setup <version>.exe.blockmap`
- `release-v2/latest.yml`

`release-v2/win-unpacked/` is a transient electron-builder output and is
normally removed from the workspace after the GitHub Release is verified.

## Install

Run the NSIS installer on a 64-bit Windows machine. The installer is not
production-code-signed until `CSC_LINK` and `CSC_KEY_PASSWORD` are supplied in
the release pipeline. Public CA signing is optional future work and is not a
blocker for internal delivery.

## Post-Install Verification

1. Start the app.
2. Log in with the configured clinic credentials.
3. Confirm the API starts on a random local port.
4. Confirm the bundled legacy compatibility database is copied from
   `resources/legacy/dental.sqlite` into Electron `userData/data`.
5. Confirm dashboard, patients, charges, inventory, follow-ups, backups, and settings pages open.
6. Confirm the app exits through the tray and restarts the API when the window is reopened.
7. Confirm the API only listens on `127.0.0.1` and deep health/metrics require an administrator session.
8. Confirm the desktop settings page shows update events, API restart status, and window state is remembered.

## Delivery Drill

Before internal release, run the real data drill after building and compiling:

```powershell
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
pnpm --filter @dental/v2 delivery:drill
```

See `docs/delivery/delivery-drill.md` for the covered path.

## Update Channel

`latest.yml` is generated from the installer and can be published with the
installer and blockmap to the configured GitHub release. The desktop process
checks for updates through `electron-updater` when the app is packaged and
`V2_ENABLE_AUTO_UPDATE=1`.

Verify the published channel metadata with:

```powershell
$env:GH_TOKEN = gh auth token
pnpm --filter @dental/v2 run verify:remote
```

## Installer Smoke

The release workflow runs a Windows installer smoke after packaging:

```powershell
pnpm --filter @dental/v2 run installer:smoke
```

It silently installs the NSIS package to a temporary directory, starts the
installed API, verifies health, and uninstalls.

Upgrade smoke can be run with an explicit previous installer:

```powershell
pnpm --filter @dental/v2 run upgrade:smoke `
  -CurrentInstallerPath <new-installer.exe> `
  -PreviousInstallerPath <previous-installer.exe>
```

The public release workflow only considers numeric `v2-<major>.<minor>.<patch>`
releases for upgrade smoke, so internal `v2-internal-*` releases never become
the upgrade baseline.

## Signing

The `v2-release.yml` workflow requires `CSC_LINK` and `CSC_KEY_PASSWORD` GitHub
Secrets. `CSC_LINK` must be a PKCS12 certificate file or its base64 content.
The workflow fails before packaging when either secret is missing.

The repository is currently configured with the local self-signed
`certs/signing-cert.pfx` to keep the release pipeline green. Replace it with a
CA-issued code signing certificate before public distribution. The release
workflow now fails when the installer is signed with a self-signed development
certificate. If you are only distributing internally, this workflow is not
required; use the internal release path below.

Verify a local installer locally:

```powershell
pnpm --filter @dental/v2 run verify:signature
```

## Internal Build

If you only distribute to machines you control, a free self-signed internal
build is available:

```powershell
pnpm --filter @dental/v2 electron:dist:internal
```

It generates a temporary self-signed certificate, packages the installer,
verifies package/update metadata, and runs the installer smoke. Windows will
warn about the unknown publisher; do not treat this as a public signed release.
See [docs/release-modes.md](../../docs/release-modes.md) for the full comparison.

### GitHub Internal Release

Run the `V2 Internal Release` GitHub Actions workflow manually to publish a
self-signed internal release to a `v2-internal-<version>` tag. This is free,
does not require CA secrets, and uploads the installer, blockmap, and
`latest.yml` for controlled machines.

## Offline Restore

```powershell
pnpm --filter @dental/v2 restore:backup <backup.sqlite|backup.sqlite.enc> <target.sqlite>
```

For encrypted backups, set `V2_BACKUP_KEY` to the same value used by the app.
