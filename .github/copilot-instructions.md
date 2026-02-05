# Remote Development VSCode Extension - AI Agent Guidelines

## Project Overview
A VS Code extension enabling seamless file management on remote FTP/SFTP/SSH servers through a tree view UI. Users connect to servers via credentials, then browse and edit remote files with automatic local caching.

## Architecture Pattern: Singleton Controllers

All business logic is organized as **singleton controller classes** in `src/controllers/`. Each controller manages one aspect:

- **FtpClientController**: Dual-protocol connection manager (SFTP via `ssh2-sftp-client`, FTP via `basic-ftp`)
- **ConfigManager**: Loads/saves server credentials from `~/.config/remote-dev/config.json`
- **ServersController**: Server selection UI and connection orchestration
- **ExplorerController**: Tree view provider for remote file browser, implements `TreeDataProvider` interface
- **FilesController**: File operation commands (upload, delete, rename, permissions)
- **DirectoriesController**: Folder operation commands (create, rename, delete, move)
- **StatusBarController**: Connection status indicator

**Critical convention**: Use `getInstance()` static method to access controllers (lazy-loaded singletons).

## Data Flow
1. User selects server from `ServersController.showServersSelector()` → calls `ConfigManager.loadConfig()`
2. `ServersController` initiates connection via `FtpClientController.connect(config)`
3. `ExplorerController.initServer()` populates tree with `FtpClientController.list(path)`
4. User actions (edit, delete, upload) trigger commands → routed to `FilesController` or `DirectoriesController`
5. Controllers call `FtpClientController` methods, then `ExplorerController.refresh()` updates tree

## Key Implementation Details

### Localization System (i18n)
The extension supports multiple languages with [LocalizationManager](src/controllers/localization.controller.ts):
- **Languages**: English (en) and Spanish (es) by default
- **Files**: Translation keys stored in `resources/locales/en.json` and `resources/locales/es.json`
- **Usage**: `LocalizationManager.getInstance().t('messages.keyName', arg1, arg2)` — supports variable substitution with `{0}`, `{1}`, etc.
- **Custom translations**: Users can create custom translations in `custom-translations.json` via the **Change Language** command
- **Language switching**: `remote-development.change-language` command lets users select language or edit custom translations
- **Persistence**: Language preference saved in `localization.json` alongside config

### Protocol Detection
`FtpClientController.connect()` determines protocol: **port === 21 or type === 'ftp'** → FTP client, otherwise SFTP.

### Local File Caching
Remote files are cached in system temp directory (via `getTempDirectory()`) before opening. Allows syntax highlighting and other VS Code features to work.

### Connection Lifecycle
- **Reconnection threshold**: 10 minutes—auto-reconnects if connection dropped and config set
- **Error handling**: Catches all connection errors, updates status bar, shows user notifications
- **Socket events**: Monitors FTP/SFTP socket close/error events to track disconnection

### Rights/Permissions Format
`Rights` interface stores Unix permissions as 3-char strings (user/group/other), e.g., `rwx/r-x/r-x`.

## Build & Dev Workflow

```bash
npm run watch      # TypeScript compilation in watch mode (background task: npm: 0)
npm run compile    # One-time compilation to ./out/
npm run lint       # ESLint check (warnings on naming, curly braces, eqeqeq)
npm run test       # Run unit tests (extension.test.ts)
```

**Output**: Compiled JS goes to `./out/extension.js` (main entry point in package.json).

## Important Patterns & Conventions

- **Command registration**: Commands declared in `package.json#/contributes/commands`, registered in controllers via `vscode.commands.registerCommand()`
- **Tree view**: Context menu items use `contextValue` (file/directory) to filter visible commands
- **Error messages**: All user-facing errors show via `vscode.window.showErrorMessage()` after a 10-second delay (TimeoutError class)
- **Async operations**: Wrap in `vscode.window.withProgress()` for Notification location progress UI
- **Path handling**: Use `pathServerFormat()` utility to normalize server paths (converts backslashes, removes leading /)

## Testing Entry Point
[src/test/extension.test.ts](src/test/extension.test.ts) — currently minimal; tests can verify controller initialization and command registration.

## Common Additions
- **New file operations**: Add command to `package.json#/contributes/commands`, register in `FilesController`, call `FtpClientController` method
- **New view columns**: Edit `ExplorerController.FTPItem.description` or `tooltip` getters
- **Status indicators**: Modify `StatusBarController.updateStatusBarText()` messages
- **Connection validation**: Enhance `FtpClientController.reconnector()` or error event handlers
- **New user-facing strings**: Add to `resources/locales/en.json` and `es.json`, use `LocalizationManager.getInstance().t()` instead of hardcoded strings
