# Production Admin Bootstrap

The packaged application never ships default admin credentials. The bundled
`apps/v2/legacy/dental.sqlite` is sanitized before release: it contains the
legacy schema but no users, password hashes, refresh tokens, or audit rows.

## First production start

With an empty database the packaged app shows a first-run setup wizard on the
login screen: the clinic operator enters and confirms a new admin password,
and the API creates the `admin` account. No environment variable is required
for this path.

Operators who prefer to pre-provision the password (e.g. unattended installs)
can still set:

```powershell
$env:V2_ADMIN_PASSWORD = '<a strong random password, at least 6 chars>'
```

On first start the API creates the `admin` user with that password instead of
showing the wizard. Log in and change the password from the employee/user
management screen.

For an existing legacy database with real users, the legacy import preserves
those users; `V2_ADMIN_PASSWORD` is only needed when the imported database has
no `admin` account.
