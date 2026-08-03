# Git Security Rules

This repo includes local guardrails to reduce accidental secret leaks.

## What is protected

- `.gitignore` blocks common generated and secret-bearing files.
- `pre-commit` hook scans staged files for sensitive patterns.
- `pre-push` hook scans all tracked files before any push.
- Explicit filename blocking for `.env`, private keys, and certificates.

## Setup (already applied in this workspace)

```bash
git config core.hooksPath .githooks
```

## Daily use

- Keep real secrets in local environment variables or secret managers.
- Commit only placeholders in `.env.example`.
- Run manual scan any time:

```bash
npm run scan:secrets
npm run scan:secrets:all
```

## If a leak is detected

1. Remove or rotate the secret immediately.
2. Delete it from Git history if it was committed.
3. Force-push cleaned history only when coordinated with collaborators.
