import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { ServerItem } from '../types';
import LocalizationManager from './localization.controller';
import { assertUniqueServerIds } from '../utils';

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
    private configPanel?: vscode.WebviewPanel;
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
                    await this.openConfigUi();
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

    private async openConfigUi(): Promise<void> {
        const config = await this.loadConfig();
        if (this.configPanel) {
            this.configPanel.reveal(vscode.ViewColumn.Active);
            await this.configPanel.webview.postMessage({ type: 'config', config });
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'remote-development-config',
            'Remote Development: Config',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'templates'))]
            }
        );
        this.configPanel = panel;
        panel.webview.html = await this.getConfigWebviewHtml(panel.webview);
        const stateTimer = setInterval(() => {
            void this.postConnectionState(panel).catch(() => undefined);
        }, 1000);
        panel.onDidDispose(() => {
            clearInterval(stateTimer);
            if (this.configPanel === panel) {
                this.configPanel = undefined;
            }
        }, undefined, this.context.subscriptions);

        panel.webview.onDidReceiveMessage(async message => {
            try {
                switch (message?.type) {
                    case 'ready':
                        await panel.webview.postMessage({ type: 'config', config });
                        await this.postConnectionState(panel);
                        break;
                    case 'save':
                        await this.saveConfig(message.config);
                        await panel.webview.postMessage({ type: 'saved', config: await this.loadConfig() });
                        await this.postConnectionState(panel);
                        vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Configuration saved'));
                        break;
                    case 'connect':
                        await vscode.commands.executeCommand('remote-development.connect-server', message.serverId);
                        await this.postConnectionState(panel);
                        break;
                    case 'disconnect':
                        await vscode.commands.executeCommand('remote-development.disconnect-server');
                        await this.postConnectionState(panel);
                        break;
                    case 'state':
                        await this.postConnectionState(panel);
                        break;
                    case 'open-json':
                        await this.openInEditor();
                        break;
                    case 'select-private-key': {
                        const selection = await vscode.window.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: false,
                            canSelectMany: false,
                            openLabel: LocalizationManager.getInstance().t('Select private key')
                        });
                        const keyPath = selection?.[0]?.fsPath;
                        if (keyPath) {
                            await panel.webview.postMessage({ type: 'private-key-selected', path: keyPath });
                        }
                        break;
                    }
                }
            } catch (error: any) {
                await panel.webview.postMessage({
                    type: 'error',
                    message: error instanceof SyntaxError
                        ? 'Invalid JSON configuration'
                        : error?.message || 'Unable to save configuration'
                });
            }
        }, undefined, this.context.subscriptions);
    }

    private async postConnectionState(panel: vscode.WebviewPanel): Promise<void> {
        const state = await vscode.commands.executeCommand('remote-development.connection-state');
        await panel.webview.postMessage({ type: 'connection-state', state });
    }

    private async getConfigWebviewHtml(webview: vscode.Webview): Promise<string> {
        const nonce = randomUUID().replace(/-/g, '');
        const spanish = LocalizationManager.getInstance().getLanguage() === 'es';
        const labels = spanish ? {
            title: 'Conexiones', subtitle: 'Administra tus servidores remotos', openJson: 'Abrir en JSON',
            add: 'Nueva conexión', empty: 'Aún no hay conexiones', emptyHint: 'Agrega tu primer servidor para comenzar.',
            selectHint: 'Selecciona una conexión para editarla.', details: 'Detalles de conexión', name: 'Nombre',
            host: 'Host', username: 'Usuario', password: 'Contraseña', privateKeyPath: 'Ruta de clave privada', passphrase: 'Passphrase de la clave', port: 'Puerto', path: 'Ruta remota',
            authMethod: 'Método de autenticación', passwordAuth: 'Contraseña', keyAuth: 'Clave privada', chooseKey: 'Elegir archivo', protocol: 'Protocolo', secure: 'Usar FTPS seguro', save: 'Guardar conexión', delete: 'Eliminar',
            saved: 'Configuración guardada', newConnection: 'Nueva conexión', sftpHint: 'SFTP / SSH',
            ftpHint: 'FTP sobre TLS', passwordHint: 'Se guardará de forma segura en SecretStorage', privateKeyHint: 'Opcional; por ejemplo ~/.ssh/id_ed25519', passphraseHint: 'Opcional; se guardará en SecretStorage',
            required: 'Obligatorio', confirmDelete: '¿Eliminar esta conexión?', invalid: 'Completa los campos obligatorios.',
            search: 'Buscar conexiones...', all: 'Todos', connected: 'Conectado', connecting: 'Conectando',
            disconnected: 'Desconectado', connect: 'Conectar', disconnect: 'Desconectar', duplicate: 'Duplicar',
            advanced: 'Opciones avanzadas', fingerprint: 'Huella SFTP', showPassword: 'Mostrar contraseña',
            hidePassword: 'Ocultar contraseña', noMatches: 'No hay coincidencias.'
        } : {
            title: 'Connections', subtitle: 'Manage your remote servers', openJson: 'Open in JSON',
            add: 'New connection', empty: 'No connections yet', emptyHint: 'Add your first server to get started.',
            selectHint: 'Select a connection to edit it.', details: 'Connection details', name: 'Name',
            host: 'Host', username: 'Username', password: 'Password', privateKeyPath: 'Private key path', passphrase: 'Key passphrase', port: 'Port', path: 'Remote path',
            authMethod: 'Authentication method', passwordAuth: 'Password', keyAuth: 'Private key', chooseKey: 'Choose file', protocol: 'Protocol', secure: 'Use secure FTPS', save: 'Save connection', delete: 'Delete',
            saved: 'Configuration saved', newConnection: 'New connection', sftpHint: 'SFTP / SSH',
            ftpHint: 'FTP over TLS', passwordHint: 'Stored securely in SecretStorage', privateKeyHint: 'Optional; for example ~/.ssh/id_ed25519', passphraseHint: 'Optional; stored in SecretStorage',
            required: 'Required', confirmDelete: 'Delete this connection?', invalid: 'Complete the required fields.',
            search: 'Search connections...', all: 'All', connected: 'Connected', connecting: 'Connecting',
            disconnected: 'Disconnected', connect: 'Connect', disconnect: 'Disconnect', duplicate: 'Duplicate',
            advanced: 'Advanced options', fingerprint: 'SFTP fingerprint', showPassword: 'Show password',
            hidePassword: 'Hide password', noMatches: 'No matching connections.'
        };
        const templateDirectory = path.join(this.context.extensionPath, 'templates');
        const [template, styleUri, scriptUri] = await Promise.all([
            fs.readFile(path.join(templateDirectory, 'config-manager.html'), 'utf8'),
            Promise.resolve(webview.asWebviewUri(vscode.Uri.file(path.join(templateDirectory, 'config-manager.css'))).toString()),
            Promise.resolve(webview.asWebviewUri(vscode.Uri.file(path.join(templateDirectory, 'config-manager.js'))).toString())
        ]);
        const labelsJson = JSON.stringify(labels).replace(/</g, '\\u003c');
        const values: Record<string, string> = {
            __LANG__: spanish ? 'es' : 'en',
            __CSP_SOURCE__: webview.cspSource,
            __NONCE__: nonce,
            __TITLE__: labels.title,
            __SUBTITLE__: labels.subtitle,
            __OPEN_JSON__: labels.openJson,
            __ADD__: labels.add,
            __SEARCH__: labels.search,
            __ALL__: labels.all,
            __SELECT_HINT__: labels.selectHint,
            __EMPTY_HINT__: labels.emptyHint,
            __LABELS__: labelsJson,
            __STYLE_URI__: styleUri,
            __SCRIPT_URI__: scriptUri
        };
        return Object.entries(values).reduce((html, [token, value]) => html.replaceAll(token, value), template);
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

            let previousIds = new Set<string>();
            try {
                const previous = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as Config;
                previousIds = new Set(
                    previous.servers
                        ?.map(server => server.id)
                        .filter((id): id is string => typeof id === 'string')
                );
            } catch {
                // A missing or invalid previous file will be replaced below.
            }

            for (const server of normalized.servers) {
                const id = server.id ?? randomUUID();
                const password = server.password;
                if (password && password !== '<stored in VS Code SecretStorage>') {
                    await this.context.secrets.store(this.passwordKey(id), password);
                } else if (password === undefined || password === '') {
                    await this.context.secrets.delete(this.passwordKey(id));
                }
                const passphrase = server.passphrase;
                if (passphrase && passphrase !== '<stored in VS Code SecretStorage>') {
                    await this.context.secrets.store(this.passphraseKey(id), passphrase);
                } else if (passphrase === undefined || passphrase === '') {
                    await this.context.secrets.delete(this.passphraseKey(id));
                }
                previousIds.delete(id);

                const { password: _password, passphrase: _passphrase, ...withoutSecrets } = server;
                metadata.servers.push({
                    ...withoutSecrets,
                    id,
                    password: '<stored in VS Code SecretStorage>',
                    ...(passphrase !== undefined ? { passphrase: '<stored in VS Code SecretStorage>' } : {})
                });
            }

            for (const removedId of previousIds) {
                await this.context.secrets.delete(this.passwordKey(removedId));
                await this.context.secrets.delete(this.passphraseKey(removedId));
            }

            const temporaryPath = `${this.configPath}.${randomUUID()}.tmp`;
            try {
                await fs.writeFile(temporaryPath, JSON.stringify(metadata, null, 2), {
                    encoding: 'utf8',
                    mode: 0o600
                });
                await fs.chmod(temporaryPath, 0o600);
                await fs.rename(temporaryPath, this.configPath);
            } finally {
                await fs.unlink(temporaryPath).catch(() => undefined);
            }
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
                id: server.id ?? randomUUID(),
                password: server.password === '<stored in VS Code SecretStorage>'
                    ? await this.context.secrets.get(this.passwordKey(server.id ?? ''))
                    : server.password,
                passphrase: server.passphrase === '<stored in VS Code SecretStorage>'
                    ? await this.context.secrets.get(this.passphraseKey(server.id ?? ''))
                    : server.passphrase
            })));

            // Migrate legacy plaintext passwords and assign stable IDs immediately.
            if (parsed.servers.some(server =>
                !server.id
                || (server.password !== undefined && server.password !== '<stored in VS Code SecretStorage>')
                || (server.passphrase !== undefined && server.passphrase !== '<stored in VS Code SecretStorage>')
            )) {
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

    private passphraseKey(id: string): string {
        return `remote-development.passphrase.${id}`;
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
            if (candidate.host.includes('/') || candidate.host.includes('\\\\') || /\\s/.test(candidate.host)) {
                throw new Error(`Invalid host at index ${index}`);
            }
            if (candidate.path.split(/[\\\\/]/).includes('..')) {
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
            if (candidate.authMethod !== undefined && candidate.authMethod !== 'password' && candidate.authMethod !== 'privateKey') {
                throw new Error(`Invalid authentication method at index ${index}`);
            }
            if (candidate.password !== undefined && (typeof candidate.password !== 'string' || candidate.password.length > 4096 || /[\u0000-\u001f\u007f]/.test(candidate.password))) {
                throw new Error(`Invalid password at index ${index}`);
            }
            if (candidate.privateKeyPath !== undefined && (typeof candidate.privateKeyPath !== 'string' || !candidate.privateKeyPath.trim() || candidate.privateKeyPath.length > 4096 || /[\u0000-\u001f\u007f]/.test(candidate.privateKeyPath))) {
                throw new Error(`Invalid private key path at index ${index}`);
            }
            if (candidate.passphrase !== undefined && (typeof candidate.passphrase !== 'string' || candidate.passphrase.length > 4096 || /[\u0000-\u001f\u007f]/.test(candidate.passphrase))) {
                throw new Error(`Invalid key passphrase at index ${index}`);
            }
            if (candidate.ftpSecure !== undefined && typeof candidate.ftpSecure !== 'boolean') {
                throw new Error(`Invalid FTP security setting at index ${index}`);
            }
            if (candidate.hostFingerprint !== undefined && (typeof candidate.hostFingerprint !== 'string' || (candidate.hostFingerprint !== '' && !/^[a-f0-9]{64}$/i.test(candidate.hostFingerprint)))) {
                throw new Error(`Invalid host fingerprint at index ${index}`);
            }
            return { ...candidate };
        });

        assertUniqueServerIds(servers);

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
