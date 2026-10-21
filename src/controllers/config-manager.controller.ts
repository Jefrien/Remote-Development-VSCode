import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { ServerItem } from '../types';
import LocalizationManager from './localization.controller';

interface Config {
    servers: ServerItem[];
}

/**
 * Manages the configuration file for the Remote Development extension.
 */
export default class ConfigManager {
    private static instance: ConfigManager;
    private configPath: string;
    private configDocumentUri?: string;
    private readonly configEditorUri = vscode.Uri.parse('remote-development-config:/config.json');
    private editorContent = new Uint8Array();
    private readonly editorFileEvents = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.editorFileEvents.event;
    private readonly context: vscode.ExtensionContext;

    /**
     * Initializes the ConfigManager with the extension context.
     * Registers the command to open the config file in the editor.
     * @param context The extension context
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.configPath = path.join(
            context.globalStorageUri.fsPath,
            'remote-development-jdevs',
            'config.json'
        );

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider('remote-development-config', this, {
                isCaseSensitive: true
            }),
            this.editorFileEvents
        );

        // Register command to open the config file
        context.subscriptions.push(
            vscode.commands.registerCommand('remote-development.open-config', async () => {
                try {
                    await this.openInEditor();
                } catch (error) {
                    vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error opening configuration file'));
                    console.error('Error opening config:', error);
                }
            })
        );

        context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => {
            if (event.document.uri.toString() !== this.configDocumentUri) {
                return;
            }

            event.waitUntil(this.prepareConfigDocumentForSave(event.document));
        }));
    }

    /**
     * Gets the singleton instance of ConfigManager.
     * @param context The extension context
     * @returns The singleton instance
     */
    public static getInstance(context: vscode.ExtensionContext): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager(context);
        }
        return ConfigManager.instance;
    }

    /**
     * Returns the default configuration.
     * @returns Default configuration object
     */
    private getDefaultConfig(): Config {
        return { servers: [] };
    }

    /**
     * Ensures the config file exists and is valid.
     * Creates the file with default config if it doesn't exist or is empty.
     */
    private async ensureConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
            // Check if file is empty
            const data = await fs.readFile(this.configPath, 'utf8');
            if (data.trim() === '') {
                await fs.writeFile(
                    this.configPath,
                    JSON.stringify(this.getDefaultConfig(), null, 2),
                    { encoding: 'utf8', mode: 0o600 }
                );
                await fs.chmod(this.configPath, 0o600);
            }
        } catch (error) {
            // If file doesn't exist, create directory and file with default config
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            await fs.writeFile(
                this.configPath,
                JSON.stringify(this.getDefaultConfig(), null, 2),
                { encoding: 'utf8', mode: 0o600 }
            );
            await fs.chmod(this.configPath, 0o600);
        }
        await fs.chmod(this.configPath, 0o600);
    }

    /**
     * Opens the config file in the editor.
     */
    async openInEditor(): Promise<void> {
        try {
            const config = await this.loadConfig();
            this.editorContent = Buffer.from(JSON.stringify(config, null, 2), 'utf8');
            const document = await vscode.workspace.openTextDocument(this.configEditorUri);
            this.configDocumentUri = document.uri.toString();
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error('Error opening config:', error);
            throw new Error('Failed to open configuration file');
        }
    }

    /**
     * Saves data to the config file.
     * @param data The configuration data to save
     */
    async saveConfig(data: Config): Promise<void> {
        try {
            await this.ensureConfig();
            const normalized = this.validateConfig(data);
            const metadata: Config = { servers: [] };

            for (const server of normalized.servers) {
                const id = server.id ?? randomUUID();
                const password = server.password;
                if (password && password !== '<stored in VS Code SecretStorage>') {
                    await this.context.secrets.store(this.passwordKey(id), password);
                } else if (password === '') {
                    await this.context.secrets.delete(this.passwordKey(id));
                }

                const { password: _password, ...withoutPassword } = server;
                metadata.servers.push({
                    ...withoutPassword,
                    id,
                    password: '<stored in VS Code SecretStorage>'
                });
            }

            await fs.writeFile(this.configPath, JSON.stringify(metadata, null, 2), {
                encoding: 'utf8',
                mode: 0o600
            });
            await fs.chmod(this.configPath, 0o600);
        } catch (error) {
            console.error('Error saving config:', error);
            throw new Error('Failed to save configuration');
        }
    }

    /**
     * Loads the configuration from the config file.
     * @returns The loaded configuration
     */
    async loadConfig(): Promise<Config> {
        try {
            await this.ensureConfig();
            const data = await fs.readFile(this.configPath, 'utf8');
            const parsed = this.validateConfig(JSON.parse(data));
            const servers = await Promise.all(parsed.servers.map(async (server) => ({
                ...server,
                password: server.password === '<stored in VS Code SecretStorage>'
                    ? await this.context.secrets.get(this.passwordKey(server.id ?? ''))
                    : server.password
            })));

            // Migrate legacy plaintext passwords and assign stable IDs immediately.
            if (parsed.servers.some(server => server.password || !server.id)) {
                await this.saveConfig({ servers });
            }
            return { servers };
        } catch (error) {
            console.error('Error loading config:', error);
            throw new Error('Failed to load configuration');
        }
    }

    async saveServerFingerprint(server: ServerItem, fingerprint: string): Promise<void> {
        const config = await this.loadConfig();
        const storedServer = config.servers.find(candidate =>
            (server.id && candidate.id === server.id)
            || (candidate.host === server.host
                && candidate.username === server.username
                && candidate.port === server.port
                && candidate.path === server.path)
        );
        if (!storedServer) {
            throw new Error('Server configuration was not found');
        }
        storedServer.hostFingerprint = fingerprint;
        await this.saveConfig(config);
    }

    private passwordKey(id: string): string {
        return `remote-development.password.${id}`;
    }

    private validateConfig(value: unknown): Config {
        if (!value || typeof value !== 'object' || !Array.isArray((value as Config).servers)) {
            throw new Error('Configuration must contain a servers array');
        }

        const servers = (value as Config).servers.map((server, index) => {
            if (!server || typeof server !== 'object') {
                throw new Error(`Invalid server at index ${index}`);
            }
            const candidate = server as ServerItem;
            const fields = [candidate.name, candidate.host, candidate.username, candidate.path];
            if (fields.some(field => typeof field !== 'string' || !field.trim() || field.length > 4096 || /[\u0000-\u001f\u007f]/.test(field))) {
                throw new Error(`Invalid server fields at index ${index}`);
            }
            if (candidate.host.includes('/') || candidate.host.includes('\\') || /\s/.test(candidate.host)) {
                throw new Error(`Invalid host at index ${index}`);
            }
            if (candidate.path.split(/[\\/]/).includes('..')) {
                throw new Error(`Invalid remote base path at index ${index}`);
            }
            if (candidate.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(candidate.id)) {
                throw new Error(`Invalid server ID at index ${index}`);
            }
            if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) {
                throw new Error(`Invalid port at index ${index}`);
            }
            if (candidate.type !== undefined && candidate.type !== 'sftp' && candidate.type !== 'ftp') {
                throw new Error(`Invalid protocol at index ${index}`);
            }
            if (candidate.password !== undefined && (typeof candidate.password !== 'string' || candidate.password.length > 4096 || /[\u0000-\u001f\u007f]/.test(candidate.password))) {
                throw new Error(`Invalid password at index ${index}`);
            }
            if (candidate.ftpSecure !== undefined && typeof candidate.ftpSecure !== 'boolean') {
                throw new Error(`Invalid FTP security setting at index ${index}`);
            }
            if (candidate.hostFingerprint !== undefined && (typeof candidate.hostFingerprint !== 'string' || (candidate.hostFingerprint !== '' && !/^[a-f0-9]{64}$/i.test(candidate.hostFingerprint)))) {
                throw new Error(`Invalid host fingerprint at index ${index}`);
            }
            return { ...candidate };
        });

        return { servers };
    }

    private async prepareConfigDocumentForSave(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
        const parsed = this.validateConfig(JSON.parse(document.getText()));
        const normalized = {
            servers: parsed.servers.map(server => ({ ...server, id: server.id ?? randomUUID() }))
        };
        await this.saveConfig(normalized);
        // Keep the editable document readable, including passwords, while the
        // persisted configuration remains sanitized by saveConfig().
        return [];
    }

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        this.assertEditorUri(uri);
        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: Date.now(),
            size: this.editorContent.byteLength
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        if (uri.path === '/') {
            return [['config.json', vscode.FileType.File]];
        }
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    readFile(uri: vscode.Uri): Uint8Array {
        this.assertEditorUri(uri);
        return this.editorContent;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
        this.assertEditorUri(uri);
        this.editorContent = content;
    }

    delete(uri: vscode.Uri, _options: { recursive: boolean }): void {
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    rename(oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean }): void {
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }

    private assertEditorUri(uri: vscode.Uri): void {
        if (uri.toString() !== this.configEditorUri.toString()) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }
}
