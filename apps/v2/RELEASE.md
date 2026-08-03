# Dental Clinic V2 - Release Artifacts

## Generated Artifacts

- `release-v2/Dental Clinic V2 Setup 2.0.0.exe`
- `release-v2/Dental Clinic V2 Setup 2.0.0.exe.blockmap`
- `release-v2/latest.yml`

`release-v2/win-unpacked/` is a transient electron-builder output and is
normally removed from the workspace after the GitHub Release is verified.

## Install

Run the NSIS installer on a 64-bit Windows machine. The installer is not
production-code-signed until `CSC_LINK` and `CSC_KEY_PASSWORD` are supplied in
the release pipeline.

## Post-Install Verification

1. Start the app.
2. Log in with the configured clinic credentials.
3. Confirm the API starts on a random local port.
4. Confirm the bundled legacy compatibility database is copied from
   `resources/legacy/dental.sqlite` into Electron `userData/data`.
5. Confirm dashboard, patients, charges, inventory, follow-ups, backups, and settings pages open.
6. Confirm the app exits through the tray and restarts the API when the window is reopened.

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

The release workflow also runs upgrade smoke automatically on Windows when a
previous `v2-*` release exists.

## Signing

The `v2-release.yml` workflow requires `CSC_LINK` and `CSC_KEY_PASSWORD` GitHub
Secrets. `CSC_LINK` must be a PKCS12 certificate file or its base64 content.
The workflow fails before packaging when either secret is missing.

The repository is currently configured with the local self-signed
`certs/signing-cert.pfx` to keep the release pipeline green. Replace it with a
CA-issued code signing certificate before public distribution.

## Offline Restore

```powershell
pnpm --filter @dental/v2 restore:backup <backup.sqlite|backup.sqlite.enc> <target.sqlite>
```

For encrypted backups, set `V2_BACKUP_KEY` to the same value used by the app.
