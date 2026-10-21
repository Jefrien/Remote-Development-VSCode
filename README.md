# Remote Development for VS Code

Manage remote files from Visual Studio Code over SFTP/SSH and FTPS.

Remote Development provides a lightweight file explorer for remote servers:
browse directories, open files locally for editing, upload changes, create and
rename files or folders, delete entries, and change permissions.

## Features

- SFTP/SSH connections with host-key fingerprint verification.
- FTPS connections only; plain FTP is rejected.
- Remote file and folder explorer inside VS Code.
- Open remote files in the editor and upload saved changes.
- Context-menu uploads from any local file.
- Symlink entries are visible and file symlinks can be opened.
- Automatic connection health checks and one retry after transport failures.
- Remote base-directory protection and local temporary-file protection.
- Passwords stored in VS Code SecretStorage instead of the JSON file.
- English and Spanish translations, including a manually selectable extension language.

## Requirements

- Visual Studio Code `1.94.0` or newer.
- Node.js 24 LTS for development and packaging.
- A reachable SFTP or FTPS server.

## Install from source

```bash
git clone https://github.com/Jefrien/Remote-Development-VSCode.git
cd Remote-Development-VSCode
npm ci
npm run compile
npm run lint
```

Open the directory in VS Code and press `F5` to launch an Extension Development
Host.

## Run tests

```bash
npm test
```

The first run downloads the pinned VS Code test runtime defined in
`.vscode-test.mjs`. It is generated locally under `.vscode-test/` and must not
be committed. If the download fails, check DNS, proxy, VPN, or firewall access
to `update.code.visualstudio.com`.

## Configuration

Run **Remote Development: Config** from the Remote Development view. The
extension opens an editable JSON document. Passwords are visible while that
temporary editor is open, but are stored in VS Code SecretStorage when saved;
the persisted JSON contains a SecretStorage placeholder instead of the
password.

Example:

```json
{
  "servers": [
    {
      "name": "My SFTP server",
      "host": "example.com",
      "username": "deploy",
      "password": "your-password",
      "port": 22,
      "path": "/",
      "type": "sftp",
      "hostFingerprint": "64-character SHA-256 hex fingerprint"
    },
    {
      "name": "My FTPS server",
      "host": "ftp.example.com",
      "username": "deploy",
      "password": "your-password",
      "port": 21,
      "path": "/public_html",
      "type": "ftp",
      "ftpSecure": true
    }
  ]
}
```

For SFTP, the first connection shows the received host-key fingerprint. Choose
**Trust once** or **Trust always**. A changed fingerprint is rejected until the
user explicitly reviews it. FTPS certificate validation remains enabled.

## Language selection

The extension initially follows the VS Code locale when it is English or
Spanish. Use **Remote Development: Change Language** to override it. The
selection is stored in VS Code global extension state. Reload the VS Code
window after changing it so contributed command and view titles refresh.

Translation files are in [`l10n/`](l10n/), and the workflow is documented in
[`I18N.md`](I18N.md).

## Common commands

- **Remote Development: Choose Connection** — load and connect to a server.
- **Remote Development: Config** — edit server configuration.
- **Remote Development: Change Language** — select English or Spanish.
- **Remote Development: Save and Upload** — upload the currently open remote file.

Most file operations are available from the remote explorer context menu.

## Project structure

```text
src/extension.ts                              Extension activation
src/controllers/config-manager.controller.ts  Config and SecretStorage
src/controllers/localization.controller.ts    Manual language selection
src/controllers/ftp.controller.ts             FTP/FTPS/SFTP transport
src/controllers/explorer.controller.ts        Remote tree provider
src/controllers/files.controller.ts           File commands
src/controllers/directories.controller.ts     Directory commands
src/utils/index.ts                            Path and filesystem safeguards
l10n/                                          Runtime translations
src/test/                                      Extension regression tests
```

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.
Bug reports and feature requests should use the GitHub issue templates. For
security-sensitive reports, follow [`SECURITY.md`](SECURITY.md) instead of
opening a public issue.

## Development checks

Before submitting a PR, run:

```bash
npm run compile
npm run lint
npm test
git diff --check
```

To build a VSIX locally with Node 24:

```bash
fnm exec --using v24.14.0 npx --no-install vsce package
```

## License and support

This project is distributed under the license in [`LICENCE.txt`](LICENCE.txt).
Issues and pull requests are welcome. For security issues, use the private
reporting process described in [`SECURITY.md`](SECURITY.md).
