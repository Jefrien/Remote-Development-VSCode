# Contributing

Thanks for helping improve Remote Development.

## Before you start

1. Search existing issues and pull requests.
2. For larger changes, open an issue first so the design can be discussed.
3. Never include passwords, private keys, host fingerprints from private infrastructure, or server logs containing sensitive data.

## Local setup

```bash
git clone https://github.com/Jefrien/Remote-Development-VSCode.git
cd Remote-Development-VSCode
npm ci
```

Use Node.js 24 LTS. Run the extension with `F5` in VS Code or use the checks
below.

## Pull request workflow

```bash
git checkout -b fix/short-description
# make focused changes
git diff --check
npm run compile
npm run lint
npm test
git commit -m "fix: describe the change"
git push origin fix/short-description
```

Open a pull request against `main`. Keep each PR focused, explain the user
impact, and include tests or a manual verification checklist. If behavior,
configuration, security, or commands changed, update the README or the related
documentation in the same PR.

## Code conventions

- TypeScript with strict compiler checks.
- Prefer small controllers and reusable utilities over duplicated transport logic.
- Validate remote paths before every remote operation.
- Keep passwords in SecretStorage; never commit credentials or log them.
- Use `LocalizationManager` for user-facing runtime text.
- Preserve both English and Spanish locale keys and placeholders.
- Keep changes compatible with the minimum VS Code engine in `package.json`.

## Testing expectations

Add a regression test for every bug fix when practical. At minimum, run:

```bash
npm run compile
npm run lint
npm test
```

Network-dependent tests may require access to
`update.code.visualstudio.com` on the first run.

## Commit messages

Use a short, descriptive subject. Conventional prefixes are encouraged:
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, and `chore:`.

## Review checklist

- Does the change handle both SFTP and FTPS where applicable?
- Are base-directory and local-path boundaries still enforced?
- Are errors actionable and translated?
- Are tests and documentation updated?
- Does the VSIX still contain only required runtime files?
