# Production Admin Bootstrap

The packaged application never ships default admin credentials. The bundled
`apps/v2/legacy/dental.sqlite` is sanitized before release: it contains the
legacy schema but no users, password hashes, refresh tokens, or audit rows.

## First production start

Before starting the packaged app for the first time, set:

```powershell
$env:V2_ADMIN_PASSWORD = '<a strong random password, at least 6 chars>'
```

On first start the API creates the `admin` user with that password. Log in and
change the password from the employee/user management screen.

If `V2_ADMIN_PASSWORD` is not set and no admin user exists, startup fails with
a clear error instead of creating default credentials.

For an existing legacy database with real users, the legacy import preserves
those users; `V2_ADMIN_PASSWORD` is only needed when the imported database has
no `admin` account.
