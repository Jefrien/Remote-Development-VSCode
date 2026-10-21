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
                localResourceRoots: []
            }
        );
        this.configPanel = panel;
        panel.webview.html = this.getConfigWebviewHtml(panel.webview);
        panel.onDidDispose(() => {
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
                        break;
                    case 'connect':
                        await vscode.commands.executeCommand('remote-development.connect-server', message.server);
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

    private getConfigWebviewHtml(webview: vscode.Webview): string {
        const nonce = randomUUID().replace(/-/g, '');
        const spanish = LocalizationManager.getInstance().getLanguage() === 'es';
        const labels = spanish ? {
            eyebrow: 'Remote Development', title: 'Conexiones', subtitle: 'Administra tus servidores remotos',
            openJson: 'Abrir en JSON', add: 'Nueva conexión', empty: 'Aún no hay conexiones',
            emptyHint: 'Agrega tu primer servidor para comenzar.', selectHint: 'Selecciona una conexión para editarla.',
            details: 'Detalles de conexión', name: 'Nombre', host: 'Host', username: 'Usuario', password: 'Contraseña',
            port: 'Puerto', path: 'Ruta remota', protocol: 'Protocolo', secure: 'Usar FTPS seguro',
            save: 'Guardar conexión', delete: 'Eliminar', saved: 'Configuración guardada', newConnection: 'Nueva conexión',
            sftpHint: 'SFTP / SSH', ftpHint: 'FTP sobre TLS', passwordHint: 'Se guardará de forma segura en SecretStorage',
            required: 'Obligatorio', confirmDelete: '¿Eliminar esta conexión?', invalid: 'Completa los campos obligatorios.',
            search: 'Buscar conexiones...', all: 'Todos', connected: 'Conectado', connecting: 'Conectando', disconnected: 'Desconectado',
            connect: 'Conectar', disconnect: 'Desconectar', duplicate: 'Duplicar', advanced: 'Opciones avanzadas', fingerprint: 'Huella SFTP',
            showPassword: 'Mostrar contraseña', hidePassword: 'Ocultar contraseña', noMatches: 'No hay coincidencias.'
        } : {
            eyebrow: 'Remote Development', title: 'Connections', subtitle: 'Manage your remote servers',
            openJson: 'Open in JSON', add: 'New connection', empty: 'No connections yet',
            emptyHint: 'Add your first server to get started.', selectHint: 'Select a connection to edit it.',
            details: 'Connection details', name: 'Name', host: 'Host', username: 'Username', password: 'Password',
            port: 'Port', path: 'Remote path', protocol: 'Protocol', secure: 'Use secure FTPS',
            save: 'Save connection', delete: 'Delete', saved: 'Configuration saved', newConnection: 'New connection',
            sftpHint: 'SFTP / SSH', ftpHint: 'FTP over TLS', passwordHint: 'Stored securely in SecretStorage',
            required: 'Required', confirmDelete: 'Delete this connection?', invalid: 'Complete the required fields.',
            search: 'Search connections...', all: 'All', connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected',
            connect: 'Connect', disconnect: 'Disconnect', duplicate: 'Duplicate', advanced: 'Advanced options', fingerprint: 'SFTP fingerprint',
            showPassword: 'Show password', hidePassword: 'Hide password', noMatches: 'No matching connections.'
        };
        const strings = JSON.stringify(labels).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
<html lang="${spanish ? 'es' : 'en'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${labels.title}</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.app { max-width: 1120px; margin: 0 auto; padding: 28px 30px 36px; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 22px; }
.eyebrow { margin: 0 0 5px; color: var(--vscode-textLink-foreground); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: 26px; letter-spacing: -.02em; font-weight: 650; }
.subtitle { margin: 7px 0 0; color: var(--vscode-descriptionForeground); }
.toolbar, .form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 7px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
button.danger { color: var(--vscode-errorForeground); background: transparent; border-color: var(--vscode-errorForeground); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.layout { display: grid; grid-template-columns: minmax(220px, 30%) 1fr; gap: 24px; padding-top: 24px; min-height: 470px; }
.sidebar { border-right: 1px solid var(--vscode-panel-border); padding-right: 20px; }
.side-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
.count { min-width: 22px; padding: 2px 6px; border-radius: 10px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); text-align: center; font-size: 11px; }
.list-tools { display: grid; grid-template-columns: minmax(0, 1fr) 82px; gap: 6px; margin-bottom: 10px; }
.list-tools input, .list-tools select { width: 100%; min-width: 0; padding: 6px 8px; }
.server-list { display: flex; flex-direction: column; gap: 5px; }
.server-item { display: block; width: 100%; padding: 11px 12px; border: 1px solid transparent; border-radius: 5px; color: var(--vscode-foreground); background: transparent; text-align: left; }
.server-item:hover { background: var(--vscode-list-hoverBackground); }
.server-item.active { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.server-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.server-meta { display: block; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 12px; }
.active .server-meta { color: inherit; opacity: .8; }
.server-status { display: inline-flex; align-items: center; gap: 5px; margin-top: 7px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.server-status::before { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground); content: ''; }
.server-status.connected { color: var(--vscode-testing-iconPassed); }
.server-status.connected::before { background: var(--vscode-testing-iconPassed); }
.server-status.connecting { color: var(--vscode-textLink-foreground); }
.server-status.connecting::before { background: var(--vscode-textLink-foreground); }
.server-status.error { color: var(--vscode-errorForeground); }
.server-status.error::before { background: var(--vscode-errorForeground); }
.empty-list, .empty-editor { padding: 22px 16px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
.empty-list strong, .empty-editor strong { display: block; margin-bottom: 7px; color: var(--vscode-foreground); }
.editor { position: sticky; top: 18px; align-self: start; max-width: 690px; max-height: calc(100vh - 72px); overflow: auto; }
.editor-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
.editor-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
.editor-header p { margin: 5px 0 0; color: var(--vscode-descriptionForeground); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
.input-row { display: flex; gap: 5px; }
.input-row input { flex: 1; }
.icon-button { min-width: 36px; padding: 5px; color: var(--vscode-foreground); background: var(--vscode-input-background); border-color: var(--vscode-input-border); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.full { grid-column: 1 / -1; }
label { color: var(--vscode-descriptionForeground); font-size: 12px; font-weight: 600; }
input, select { width: 100%; padding: 8px 9px; border: 1px solid var(--vscode-input-border); border-radius: 3px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
input.invalid, select.invalid { border-color: var(--vscode-errorForeground); }
.connection-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 14px; }
.connection-actions button { padding: 5px 10px; }
.advanced { margin-top: 18px; border-top: 1px solid var(--vscode-panel-border); padding-top: 14px; }
.advanced summary { color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 12px; font-weight: 600; }
.advanced .field { margin-top: 13px; }
.hint { color: var(--vscode-descriptionForeground); font-size: 11px; }
.check { display: flex; flex-direction: row; align-items: center; gap: 8px; padding-top: 25px; }
.check input { width: auto; }
.form-actions { justify-content: space-between; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); }
.form-actions .right { display: flex; gap: 8px; }
.status { min-height: 20px; margin-top: 14px; color: var(--vscode-testing-iconPassed); font-size: 12px; }
.status.error { color: var(--vscode-errorForeground); }
@media (max-width: 700px) { .app { padding: 20px 16px; } .topbar { flex-direction: column; } .layout { grid-template-columns: 1fr; } .sidebar { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); padding: 0 0 18px; } .editor { position: static; max-width: none; max-height: none; overflow: visible; } }
</style>
</head>
<body>
<main class="app">
  <header class="topbar">
    <div><p class="eyebrow">${labels.eyebrow}</p><h1>${labels.title}</h1><p class="subtitle">${labels.subtitle}</p></div>
    <div class="toolbar"><button class="secondary" id="open-json">${labels.openJson}</button><button id="add">+ ${labels.add}</button></div>
  </header>
  <div class="layout">
    <aside class="sidebar"><div class="side-heading"><span>${labels.title}</span><span class="count" id="count">0</span></div><div class="list-tools"><input id="search" type="search" placeholder="${labels.search}"><select id="filter"><option value="all">${labels.all}</option><option value="sftp">SFTP</option><option value="ftp">FTPS</option></select></div><div class="server-list" id="server-list"></div></aside>
    <section class="editor" id="editor"><div class="empty-editor"><strong>${labels.selectHint}</strong><span>${labels.emptyHint}</span></div></section>
  </div>
  <div class="status" id="status" role="status" aria-live="polite"></div>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const labels = ${strings};
let config = { servers: [] };
let selected = -1;
let connectionState = { status: 'disconnected' };
let searchQuery = '';
let protocolFilter = 'all';
const list = document.getElementById('server-list');
const editor = document.getElementById('editor');
const status = document.getElementById('status');
const count = document.getElementById('count');
const search = document.getElementById('search');
const filter = document.getElementById('filter');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setStatus = (text, error = false) => { status.textContent = text; status.className = error ? 'status error' : 'status'; };
const statusFor = server => {
  const sameServer = connectionState.host && connectionState.port === server.port && connectionState.host === server.host && connectionState.username === server.username && connectionState.path === server.path && connectionState.type === (server.type || 'sftp');
  if (connectionState.serverId) return connectionState.serverId === server.id && sameServer ? connectionState.status : 'disconnected';
  return sameServer ? connectionState.status : 'disconnected';
};
const statusLabel = state => labels[state] || labels.disconnected;
function renderList() {
  count.textContent = config.servers.length;
  if (!config.servers.length) { list.innerHTML = '<div class="empty-list"><strong>' + esc(labels.empty) + '</strong><span>' + esc(labels.emptyHint) + '</span></div>'; return; }
  const visible = config.servers.map((server, index) => ({ server, index })).filter(({ server }) => {
    const text = [server.name, server.host, server.username].join(' ').toLowerCase();
    return text.includes(searchQuery) && (protocolFilter === 'all' || (server.type || 'sftp') === protocolFilter);
  });
  if (!visible.length) { list.innerHTML = '<div class="empty-list"><strong>' + esc(labels.noMatches) + '</strong></div>'; return; }
  list.innerHTML = visible.map(({ server, index }) => { const state = statusFor(server); return '<button class="server-item ' + (index === selected ? 'active' : '') + '" data-index="' + index + '"><span class="server-name">' + esc(server.name || labels.newConnection) + '</span><span class="server-meta">' + esc((server.type || 'sftp').toUpperCase() + ' · ' + (server.host || '')) + '</span><span class="server-status ' + esc(state) + '">' + esc(statusLabel(state)) + '</span></button>'; }).join('');
  list.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.index); render(); }));
}
function render() {
  renderList();
  if (selected < 0 || !config.servers[selected]) { editor.innerHTML = '<div class="empty-editor"><strong>' + esc(labels.selectHint) + '</strong><span>' + esc(labels.emptyHint) + '</span></div>'; return; }
  const server = config.servers[selected];
  const state = statusFor(server);
  const isConnected = state === 'connected' || state === 'connecting';
  editor.innerHTML = '<div class="editor-header"><div><h2>' + esc(server.name || labels.newConnection) + '</h2><p>' + esc(labels.details) + '</p></div><div class="connection-actions"><button type="button" class="secondary" id="duplicate">' + esc(labels.duplicate) + '</button>' + (isConnected ? '<button type="button" class="danger" id="disconnect">' + esc(labels.disconnect) + '</button>' : '<button type="button" id="connect">' + esc(labels.connect) + '</button>') + '</div></div>' +
    '<form id="server-form"><div class="grid">' +
    field('name', labels.name, server.name, true, labels.required) + field('host', labels.host, server.host, true, labels.required) +
    field('username', labels.username, server.username, true, labels.required) + '<div class="field"><label for="password">' + esc(labels.password) + '</label><div class="input-row"><input id="password" name="password" type="password" value="' + esc(server.password) + '"><button class="icon-button" type="button" id="toggle-password" aria-label="' + esc(labels.showPassword) + '">◉</button></div><span class="hint">' + esc(labels.passwordHint) + '</span></div>' +
    field('port', labels.port, server.port || ((server.type || 'sftp') === 'ftp' ? 21 : 22), true, labels.required, 'number') + field('path', labels.path, server.path || '/', true, labels.required) +
    '<div class="field"><label for="type">' + esc(labels.protocol) + '</label><select id="type"><option value="sftp" ' + ((server.type || 'sftp') === 'sftp' ? 'selected' : '') + '>SFTP / SSH</option><option value="ftp" ' + (server.type === 'ftp' ? 'selected' : '') + '>FTP / FTPS</option></select><span class="hint" id="protocol-hint"></span></div>' +
    '<label class="check" id="secure-wrap"><input id="ftpSecure" type="checkbox" ' + (server.ftpSecure === true ? 'checked' : '') + '><span>' + esc(labels.secure) + '</span></label>' +
    '</div><details class="advanced"><summary>' + esc(labels.advanced) + '</summary>' + field('hostFingerprint', labels.fingerprint, server.hostFingerprint, false, 'SHA-256') + '</details><div class="form-actions"><button type="button" class="danger" id="delete">' + esc(labels.delete) + '</button><div class="right"><button type="submit">' + esc(labels.save) + '</button></div></div></form>';
  const form = document.getElementById('server-form');
  const type = document.getElementById('type'); const secure = document.getElementById('secure-wrap'); const hint = document.getElementById('protocol-hint');
  const updateType = () => { const ftp = type.value === 'ftp'; secure.style.display = ftp ? 'flex' : 'none'; hint.textContent = ftp ? labels.ftpHint : labels.sftpHint; };
  type.addEventListener('change', updateType); updateType();
  document.getElementById('toggle-password').addEventListener('click', event => { const input = document.getElementById('password'); const visible = input.type === 'text'; input.type = visible ? 'password' : 'text'; event.currentTarget.setAttribute('aria-label', visible ? labels.showPassword : labels.hidePassword); });
  document.getElementById('duplicate').addEventListener('click', () => { const clone = { ...server, id: undefined, name: (server.name || labels.newConnection) + ' (copy)' }; config.servers.push(clone); selected = config.servers.length - 1; render(); });
  document.getElementById('connect')?.addEventListener('click', () => vscode.postMessage({ type: 'connect', server }));
  document.getElementById('disconnect')?.addEventListener('click', () => vscode.postMessage({ type: 'disconnect' }));
  form.addEventListener('submit', event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form).entries()); const required = ['name', 'host', 'username', 'port', 'path']; let valid = true; required.forEach(id => { const input = document.getElementById(id); const invalid = !String(data[id] || '').trim(); input.classList.toggle('invalid', invalid); input.setAttribute('aria-invalid', String(invalid)); valid = valid && !invalid; }); const next = { ...server, name: data.name, host: data.host, username: data.username, password: data.password || undefined, port: Number(data.port), path: data.path, type: type.value, ftpSecure: type.value === 'ftp' ? document.getElementById('ftpSecure').checked : undefined, hostFingerprint: data.hostFingerprint || undefined }; if (!valid || !Number.isInteger(next.port)) { setStatus(labels.invalid, true); return; } config.servers[selected] = next; vscode.postMessage({ type: 'save', config }); });
  document.getElementById('delete').addEventListener('click', () => { if (!confirm(labels.confirmDelete)) return; config.servers.splice(selected, 1); selected = Math.min(selected, config.servers.length - 1); vscode.postMessage({ type: 'save', config }); });
}
function field(id, label, value, required, hint, type = 'text') { return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" name="' + id + '" type="' + type + '" value="' + esc(value) + '" ' + (required ? 'required' : '') + '><span class="hint">' + esc(hint || '') + '</span></div>'; }
document.getElementById('add').addEventListener('click', () => { config.servers.push({ name: '', host: '', username: '', password: '', port: 22, path: '/', type: 'sftp' }); selected = config.servers.length - 1; render(); document.getElementById('name')?.focus(); });
document.getElementById('open-json').addEventListener('click', () => vscode.postMessage({ type: 'open-json' }));
search.addEventListener('input', event => { searchQuery = event.target.value.toLowerCase(); renderList(); });
filter.addEventListener('change', event => { protocolFilter = event.target.value; renderList(); });
window.addEventListener('message', event => { const message = event.data; if (message.type === 'config' || message.type === 'saved') { config = message.config; render(); if (message.type === 'saved') setStatus(labels.saved); } if (message.type === 'connection-state') { connectionState = message.state || { status: 'disconnected' }; render(); } if (message.type === 'error') setStatus(message.message, true); });
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
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
