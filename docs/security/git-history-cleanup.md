# Git History Credential Cleanup Runbook

## Why

Historical commits contain development default passwords that were removed from
the current worktree. Anyone with access to the
repository history can still read those strings. Run this procedure before the
repository is shared publicly.

## Preconditions

- Owner approval to rewrite history and force-push all branches/tags.
- A clean worktree (`git status` shows no changes).
- A full backup that is kept outside the repository after the rewrite.
- Coordination with everyone who has clones or open pull requests; the rewrite
  changes every commit hash.

## Backup

```powershell
git clone --mirror https://github.com/1290464284-ship-it/rongyi.git `
  $env:TEMP\rongyi-history-backup.git
```

Keep this backup until the new history is verified.

## Install git-filter-repo

```powershell
python -m pip install git-filter-repo
```

## Redact default passwords

Create a temporary replacement file, for example `history-redact.txt`:

```text
<old-default-password>==>REDACTED
<another-old-default-password>==>REDACTED
```

Then rewrite history from a fresh clone (never run this against a working
checkout that must keep its current remote):

```powershell
git clone https://github.com/1290464284-ship-it/rongyi.git $env:TEMP\rongyi-clean
cd $env:TEMP\rongyi-clean
git filter-repo --replace-text history-redact.txt
```

Also scan for other secrets and private keys before publishing:

```powershell
git log --all -G'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' -- .
git log --all -G'AKIA[0-9A-Z]{16}' -- .
```

## Verify the rewrite

```powershell
git log --all -S'<old-default-password>' --oneline -- .
git log --all -S'<another-old-default-password>' --oneline -- .
```

Both commands must return no output. Also confirm the current branch still
contains the latest commits:

```powershell
git log --oneline -5
```

## Publish

```powershell
git remote add origin https://github.com/1290464284-ship-it/rongyi.git
git push --force --all origin
git push --force --tags origin
```

After the push, verify remote history:

```powershell
gh api repos/1290464284-ship-it/rongyi/commits --paginate `
  --jq '.[] | .sha' | Out-Null
```

## Post-rewrite actions

- Rotate any credentials that appeared in history, even if they were only
  development defaults.
- Recreate affected GitHub Releases if any release asset embedded a default
  credential.
- Notify all clone owners to re-clone; stale clones keep the old hashes.
- Keep the backup for a defined retention period, then delete it.

## Local verification after rewrite

Run the normal delivery gates on the rewritten branch:

```powershell
pnpm --filter @dental/v2 typecheck
pnpm --filter @dental/v2 test
pnpm --filter @dental/v2 test:coverage
pnpm --filter @dental/v2 security:scan
```
