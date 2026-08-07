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
checks for updates through `electron-updater` when the app is packaged unless
`V2_DISABLE_AUTO_UPDATE=1` is set.

Version numbering policy (two feeds, one mechanism):

- Public builds keep the plain `package.json` version (e.g. `2.2.0`) and run
  with `allowPrerelease=false`, so only stable public releases are considered.
- Internal builds are packaged as `<base>-internal.<UTC timestamp>` (see
  `build-internal-installer.ps1`), so every internal build is strictly newer
  than the previous one. The desktop process detects the `-internal.` marker
  at runtime and enables `allowPrerelease` for internal builds only, which
  makes the internal feed's prerelease releases apply. Do not change the
  version while a build is running; the script restores `package.json`
  afterwards.

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

> **S-H1 update integrity (Round 7):** `autoUpdater.autoDownload` is disabled —
> the app only *notifies* about a new version and downloads the installer after
> the user explicitly confirms on the desktop settings page ("下载更新"), then
> requires a second confirmation to install. On Windows, electron-updater's
> `NsisUpdater` only enforces Authenticode publisher verification when the
> electron-builder config sets `build.win.publisherName`. Configure it (e.g.
> `"publisherName": ["CN=<your company name>"]`) **only after** a CA-issued
> code-signing certificate is in place via `CSC_LINK`/`CSC_KEY_PASSWORD`;
> setting a publisher name that does not match the actual certificate will
> make every update fail signature verification. Keep the default
> `verifyUpdateCodeSignature` behavior — never assign it a boolean value.

The repository ships a local development certificate (`certs/signing-cert.pfx`)
so local packaging works without secrets. The release pipeline deliberately
rejects it: `verify:signature` fails when the installer is signed with a
self-signed certificate (subject contains "Dental Clinic Dev"/"self-signed" or
issuer equals subject). A CA-issued code signing certificate must be configured
via the `CSC_LINK`/`CSC_KEY_PASSWORD` secrets before public distribution. If
you are only distributing internally, this workflow is not required; use the
internal release path below.

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

It generates a temporary self-signed certificate, packages the installer
under an `-internal.<UTC timestamp>` version suffix (so internal-feed updates
always apply), verifies package/update metadata, and runs the installer smoke.
Windows will warn about the unknown publisher; do not treat this as a public
signed release. See [docs/release-modes.md](../../docs/release-modes.md) for
the full comparison.

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
