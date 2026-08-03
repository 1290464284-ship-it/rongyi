# Refactor V2 - Release Checklist

## Local Build

```powershell
cd D:\Desktop\rongyi\source
pnpm install
pnpm --filter @dental/v2 typecheck
pnpm --filter @dental/v2 test:coverage
pnpm --filter @dental/v2 build
pnpm --filter @dental/v2 electron:compile
```

## Packaging

Use a local mirror when the default Electron download is blocked:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm --filter @dental/v2 exec electron-builder --publish never --config.npmRebuild=false
```

Output:

- `apps/v2/release-v2/Dental-Clinic-V2-Setup-<version>.exe`
- `apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe`

The `win-unpacked` directory is transient; it exists on the release runner
during `verify:package` and can be removed locally after upload.

## Code Signing

Provide these secrets to the release environment:

- `CSC_LINK`: PKCS12 certificate file or base64 content
- `CSC_KEY_PASSWORD`: certificate password

electron-builder automatically signs the executable and installer when these
are available. A real certificate must be used for public distribution.

## Crash Reporting

Set `V2_CRASH_REPORT_URL` to a JSON endpoint to receive uncaught exceptions and
unhandled promise rejections from the desktop process. If unset, crashes are
written locally under the Electron `userData/logs/desktop.log`.

## Auto Update

The desktop main process checks for updates through `electron-updater` when:

- `NODE_ENV=production`
- `V2_ENABLE_AUTO_UPDATE=1`

The release workflow must publish artifacts to the update channel configured in
the electron-builder publish provider.

## Release Verification

1. Run the full local gate suite.
2. Generate the NSIS installer.
3. Install on a clean Windows machine.
4. Confirm the API starts on a random port.
5. Confirm login, legacy data migration, backup, and print work.
6. Confirm auto-update detects and applies the next version.
