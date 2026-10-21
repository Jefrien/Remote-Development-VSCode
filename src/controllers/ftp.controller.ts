import SFTPClient from 'ssh2-sftp-client';
import { Client, FileInfo as FtpFileInfo, FileType } from "basic-ftp";
import * as vscode from 'vscode';
import { ServerItem } from '../types';
import StatusBarController from './status-bar.controller';
import ConfigManager from './config-manager.controller';
import path from 'path';
import fs from 'fs';
import { assertRemotePath, getTempDirectory, hostStorageId, pathServerFormat } from '../utils';
import { Readable, Writable } from 'stream';

export class TimeoutError extends Error {
    constructor(public message: string, public timeout: number = 10000) {
        super(message);
        setTimeout(() => {
            vscode.window.showErrorMessage(message);
        }, this.timeout);
    }
}

export default class FtpClientController {
    private static RECONNECT_THRESHOLD = 10 * 60 * 1000; // 10 minutes
    private static instance: FtpClientController;
    private client: SFTPClient;
    private ftpClient: Client;
    public basePath: string;
    private status: 'connected' | 'disconnected' | 'connecting' = 'disconnected';
    public error: string = '';
    private currentConfig: ServerItem = {} as ServerItem;
    private context: vscode.ExtensionContext = {} as vscode.ExtensionContext;
    private connectionTime: number = 0;
    private connectionType: 'sftp' | 'ftp' | null = null;
    private reconnectPromise?: Promise<void>;
    private outputChannel?: vscode.OutputChannel;

    private constructor() {
        this.client = new SFTPClient();
        this.ftpClient = new Client(30000); // 30s timeout
        this.basePath = '/';
        this.registerEvents();
    }

    private writeLog(message: string, type: string = 'errors') {
        const line = `[${new Date().toISOString()}] [${type}] ${message}`;
        this.outputChannel?.appendLine(line);
    }

    public static getInstance(): FtpClientController {
        if (!FtpClientController.instance) {
            FtpClientController.instance = new FtpClientController();
        }
        return FtpClientController.instance;
    }

    public initContext(_context: vscode.ExtensionContext) {
        this.context = _context;
        this.outputChannel = vscode.window.createOutputChannel('Remote Development');
        this.context.subscriptions.push(this.outputChannel);
    }

    private registerEvents() {
        // SFTP Events
        this.client.on('error', (err) => {
            this.status = 'disconnected';
            this.error = err.message;
            if (err.message.endsWith('All configured authentication methods failed')) {
                this.error = 'Authentication error';
            }
            this.writeLog('SFTP Error: ' + JSON.stringify({
                code: this.error,
                message: err.message,
                host: this.currentConfig.host,
                type: this.currentConfig.type
            }));
            this.updateStatusConnection();
        });
        this.client.on('end', () => {
            this.writeLog('Disconnected from SFTP (END)', 'disconnecteds');
            this.status = 'disconnected';
            this.updateStatusConnection();
        });
        this.client.on('close', () => {
            this.writeLog('Disconnected from SFTP (CLOSE)', 'disconnecteds');
            this.status = 'disconnected';
            this.updateStatusConnection();
        });

    }

    private registerFtpSocketEvents() {
        const socket = this.ftpClient.ftp.socket;
        if (!socket) {
            return;
        }

        socket.on('error', (err: Error) => {
            this.markDisconnected(err);
        });
        socket.on('close', () => {
            if (this.status !== 'disconnected') {
                this.writeLog('Disconnected from FTP (CLOSE)', 'disconnecteds');
                this.markDisconnected();
            }
        });
        socket.on('end', () => {
            if (this.status !== 'disconnected') {
                this.writeLog('Disconnected from FTP (END)', 'disconnecteds');
                this.markDisconnected();
            }
        });
    }

    private markDisconnected(error?: Error) {
        this.status = 'disconnected';
        this.error = error?.message || this.error || 'Connection lost';
        if (error) {
            this.writeLog('FTP Error: ' + JSON.stringify({
                code: this.error,
                message: error.message,
                host: this.currentConfig.host,
                type: this.currentConfig.type
            }));
        }
        this.updateStatusConnection();
    }

    public get config() {
        return this.currentConfig;
    }

    public setPath(remotePath: string) {
        const normalized = remotePath.replace(/\\/g, '/');
        this.basePath = normalized.startsWith('/')
            ? path.posix.resolve('/', normalized)
            : path.posix.resolve('/', `/${normalized}`);
    }

    private updateStatusConnection() {
        const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
        let message: string;
        switch (this.status) {
            case 'connected':
                message = `${protocol}: Connected`;
                break;
            case 'connecting':
                message = `${protocol}: Connecting`;
                break;
            case 'disconnected':
                message = `${protocol}: Disconnected`;
                break;
        }
        StatusBarController.getInstance().updateStatusBarText(message, this.status === 'connecting');
    }

    public async connect(config: ServerItem) {
        this.currentConfig = config;
        this.setPath(config.path || '/');
        this.connectionType = config.port === 21 || config.type === 'ftp' ? 'ftp' : 'sftp';
        this.error = '';
        const { host, port, username, password } = config;

        if (!password) {
            throw new Error('A password is required. Store it through the configuration editor.');
        }
        if (this.connectionType === 'ftp' && config.ftpSecure !== true) {
            throw new Error('Plain FTP is disabled. Set ftpSecure to true and use FTPS.');
        }

        try {
            if (this.status === 'connected') {
                await this.disconnect();
            }
            this.status = 'connecting';
            this.updateStatusConnection();

            if (this.connectionType === 'ftp') {
                await Promise.race([
                    this.ftpClient.access({
                        host,
                        port,
                        user: username,
                        password,
                        secure: true,
                    }),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FTP connection timed out')), 15000))
                ]);
                this.registerFtpSocketEvents();
            } else { // sftp
                await this.connectSftpWithTrust(config);
            }
            this.status = 'connected';
            this.connectionTime = Date.now();
        } catch (error: any) {
            this.status = 'disconnected';
            await this.disconnect();
            throw new Error(`${this.connectionType.toUpperCase()} connection error: ${error.message}`);
        } finally {
            this.updateStatusConnection();
        }
    }

    private async connectSftpWithTrust(config: ServerItem): Promise<void> {
        let observedFingerprint: string | undefined;
        const attempt = async (trustedFingerprint?: string) => {
            observedFingerprint = undefined;
            await Promise.race([
                this.client.connect({
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    password: config.password,
                    hostHash: 'sha256',
                    hostVerifier: (fingerprint: string) => {
                        const received = fingerprint.trim().toLowerCase();
                        const expected = trustedFingerprint?.trim().toLowerCase();
                        observedFingerprint = received;
                        this.writeLog(`SFTP host key received; match=${Boolean(expected && received === expected)}`);
                        return Boolean(expected && received === expected);
                    },
                    readyTimeout: 10000,
                    retries: 2,
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SFTP connection timed out')), 15000))
            ]);
        };

        try {
            await attempt(config.hostFingerprint);
            return;
        } catch (error: any) {
            this.status = 'disconnected';
            await this.closeSftpSafely();
            if (!observedFingerprint) {
                throw error;
            }

            const changed = Boolean(config.hostFingerprint);
            const detail = changed
                ? `The server host key changed.\n\nExpected: ${config.hostFingerprint}\nReceived: ${observedFingerprint}`
                : `This server has not been trusted yet.\n\nFingerprint: ${observedFingerprint}`;
            const action = await vscode.window.showWarningMessage(
                changed ? 'SFTP host key changed' : 'Trust this SFTP server?',
                { modal: true, detail },
                'Trust once',
                'Trust always',
                'Cancel'
            );

            if (action === 'Cancel' || !action) {
                throw new Error('SFTP host key was not trusted');
            }

            config.hostFingerprint = observedFingerprint;
            if (action === 'Trust always') {
                await ConfigManager.getInstance(this.context).saveServerFingerprint(config, observedFingerprint);
            }
            // ssh2-sftp-client instances that rejected a host key may not be
            // reusable for the next handshake.
            this.client = new SFTPClient();
            this.registerEvents();
            await attempt(observedFingerprint);
        }
    }

    private async closeSftpSafely(): Promise<void> {
        try {
            await Promise.race([
                this.client.end(),
                new Promise<void>(resolve => setTimeout(resolve, 2000))
            ]);
        } catch {
            // The SSH client may already be closed after a failed handshake.
        }
    }

    private async reconnector() {
        if (!this.currentConfig.host) {
            throw new Error('No server is configured');
        }

        let needsReconnect = this.status !== 'connected';
        if (this.connectionType === 'ftp' && !this.ftpClient.closed && !needsReconnect) {
            try {
                await this.ftpClient.send('NOOP');
            } catch (error: any) {
                this.markDisconnected(error);
                needsReconnect = true;
            }
        } else if (this.connectionType === 'ftp' && this.ftpClient.closed) {
            this.markDisconnected();
            needsReconnect = true;
        }

        const isExpired = Date.now() - this.connectionTime > FtpClientController.RECONNECT_THRESHOLD;
        if (isExpired) {
            needsReconnect = true;
        }

        if (!needsReconnect) {
            return;
        }

        if (!this.reconnectPromise) {
            this.writeLog(`Reconnecting to ${this.currentConfig.host}:${this.currentConfig.port}`);
            this.reconnectPromise = this.connect(this.currentConfig).finally(() => {
                this.reconnectPromise = undefined;
            });
        }
        await this.reconnectPromise;
    }

    public async disconnect() {
        try {
            if (this.connectionType === 'ftp') {
                if (!this.ftpClient.closed) {
                    this.ftpClient.close();
                }
            } else {
                if (this.status !== 'disconnected') {
                    await this.client.end();
                }
            }
        } catch (error: any) {
            this.writeLog(`Disconnection error: ${error.message}`);
        }
        this.status = 'disconnected';
        this.updateStatusConnection();
    }

    private toSftpFileInfo(ftpInfo: FtpFileInfo[]): SFTPClient.FileInfo[] {
        return ftpInfo.map((f): SFTPClient.FileInfo => {
            let type: 'd' | '-' | 'l' = '-';
            if (f.type === FileType.Directory) { type = 'd'; }
            if (f.type === FileType.SymbolicLink) { type = 'l'; }

            return {
                type,
                name: f.name,
                size: f.size,
                modifyTime: f.modifiedAt?.getTime() || Date.now(),
                accessTime: f.modifiedAt?.getTime() || Date.now(), // Not available in FTP
                rights: { // Not fully supported, providing defaults
                    user: 'rwx',
                    group: 'rwx',
                    other: 'rwx',
                },
                owner: 0, // Not available
                group: 0, // Not available
            };
        });
    }

    public async listDirectory(_path: string = '/'): Promise<SFTPClient.FileInfo[]> {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Listing directory`, true);
            await this.reconnector();

            const safePath = assertRemotePath(_path, this.basePath);
            const listPromise = this.connectionType === 'ftp'
                ? this.ftpClient.list(pathServerFormat(safePath)).then(files => this.toSftpFileInfo(files))
                : this.client.list(pathServerFormat(safePath));

            const files = await Promise.race([
                listPromise,
                new Promise<SFTPClient.FileInfo[]>((_, reject) => setTimeout(() => {
                    reject(new Error('Directory listing timed out'));
                }, 10000))
            ]);

            this.updateStatusConnection();
            return files as SFTPClient.FileInfo[];
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error listing directory: ${error.message}`);
            await this.reconnector();
            throw error;
        }
    }

    public async reloadPath(_path: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Reloading directory`, true);
            await this.reconnector();
            const safePath = assertRemotePath(_path, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.list(pathServerFormat(safePath));
            } else {
                await this.client.list(pathServerFormat(safePath));
            }
            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error reloading directory: ${error.message}`);
            await this.reconnector();
            throw error;
        }
    }

    public async createFile(_path: string, data: string | Buffer = Buffer.from('')) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Creating file`, true);
            await this.reconnector();
            const safePath = assertRemotePath(_path, this.basePath);
            const readable = Readable.from(data);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.uploadFrom(readable, pathServerFormat(safePath));
            } else {
                await this.client.put(data, pathServerFormat(safePath), {
                    writeStreamOptions: {
                        flags: 'w',
                        encoding: 'utf8',
                        mode: 0o666,
                    }
                });
            }
            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error creating file: ${error.message}`);
            await this.reconnector();
            throw error;
        }
    }

    public async uploadFile() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('No active editor');
            }
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Uploading file`, true);
            await editor.document.save();
            const localPath = editor.document.fileName;

            const tempRoot = path.resolve(getTempDirectory(), 'rd-vscode', hostStorageId(this.currentConfig.host));
            const resolvedLocalPath = path.resolve(localPath);
            if (resolvedLocalPath === tempRoot || !resolvedLocalPath.startsWith(`${tempRoot}${path.sep}`)) {
                throw new Error('Invalid remote path: The local path does not seem to be a temporary file from this extension.');
            }
            const remotePath = '/' + path.relative(tempRoot, resolvedLocalPath).split(path.sep).join('/');
            const filename = path.basename(localPath);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Uploading file: ${filename}`,
                cancellable: true,
            }, async (progress, token) => {
                return new Promise(async (resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Upload timed out'));
                    }, 10000);

                    token.onCancellationRequested(() => {
                        clearTimeout(timeout);
                        vscode.window.showInformationMessage('Upload cancelled');
                        reject(new Error('Upload cancelled'));
                    });

                    const uploadOnce = async () => {
                        await this.reconnector();
                        if (this.connectionType === 'ftp') {
                            this.ftpClient.trackProgress(info => {
                                progress.report({ increment: info.bytes / 100, message: `${info.bytes / 1024} KB` });
                            });
                            try {
                                await this.ftpClient.uploadFrom(localPath, remotePath);
                            } finally {
                                this.ftpClient.trackProgress();
                            }
                        } else {
                            await this.client.put(localPath, remotePath, {
                                writeStreamOptions: {
                                    flags: 'w',
                                    encoding: 'utf8',
                                    mode: 0o666,
                                }
                            });
                        }
                    };

                    try {
                        await uploadOnce();
                        clearTimeout(timeout);
                        StatusBarController.getInstance().updateStatusBarText(`${protocol}: File uploaded successfully`, false);
                        resolve(true);
                    } catch (error: any) {
                        if (this.isConnectionError(error)) {
                            try {
                                this.markDisconnected(error);
                                await uploadOnce();
                                clearTimeout(timeout);
                                StatusBarController.getInstance().updateStatusBarText(`${protocol}: File uploaded successfully`, false);
                                resolve(true);
                                return;
                            } catch (retryError: any) {
                                error = retryError;
                            }
                        }
                        clearTimeout(timeout);
                        vscode.window.showErrorMessage(`Error uploading file: ${error.message}`);
                        reject(error);
                    }
                });
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error uploading file: ${error.message}`);
            this.updateStatusConnection();
            throw error;
        }
    }

    private isConnectionError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return this.status === 'disconnected'
            || this.ftpClient.closed
            || /(?:ECONN|EPIPE|socket|connection|timeout|timed out|closed|reset|TLS)/i.test(message);
    }

    public async downloadFile(remotePath: string, localPath: string, maxBytes = 50 * 1024 * 1024) {
        try {
            await this.reconnector();
            const safeRemotePath = assertRemotePath(remotePath, this.basePath);
            if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
                throw new Error('Invalid download size limit');
            }
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            let bytes = 0;
            const file = fs.createWriteStream(localPath, { mode: 0o600 });
            const dst = new Writable({
                write: (chunk: Buffer, _encoding, callback) => {
                    if (bytes + chunk.length > maxBytes) {
                        callback(new Error(`Downloaded file exceeds the ${maxBytes} byte limit`));
                        return;
                    }
                    bytes += chunk.length;
                    if (!file.write(chunk)) {
                        file.once('drain', callback);
                    } else {
                        callback();
                    }
                },
                final: callback => file.end(callback)
            });
            file.on('error', error => dst.destroy(error));
            if (this.connectionType === 'ftp') {
                await this.ftpClient.downloadTo(dst, pathServerFormat(safeRemotePath));
            } else {
                await this.client.get(pathServerFormat(safeRemotePath), dst);
            }
        } catch (error: any) {
            try {
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                }
            } catch { /* best effort cleanup */ }
            vscode.window.showErrorMessage(`Error downloading file: ${error.message}`);
            this.updateStatusConnection();
            throw error;
        }
    }

    public async deleteFile(remotePath: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Deleting file`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.remove(pathServerFormat(safePath));
            } else {
                await this.client.delete(pathServerFormat(safePath));
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error deleting file: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async renameFile(remotePath: string, newName: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Renaming file`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            const safeNewPath = assertRemotePath(newName, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.rename(pathServerFormat(safePath), pathServerFormat(safeNewPath));
            } else {
                await this.client.rename(pathServerFormat(safePath), safeNewPath);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error renaming file: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async changePermissions(remotePath: string, permissions: number) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Changing permissions`, true);
            await this.reconnector();
            if (!Number.isInteger(permissions) || permissions < 0 || permissions > 0o7777) {
                throw new Error('Invalid file permissions');
            }
            const safePath = assertRemotePath(remotePath, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.send(`SITE CHMOD ${permissions.toString(8)} ${pathServerFormat(safePath)}`);
            } else {
                await this.client.chmod(pathServerFormat(safePath), permissions);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error changing permissions: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async createFolder(_path: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Creating folder`, true);
            await this.reconnector();
            const safePath = assertRemotePath(_path, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.ensureDir(pathServerFormat(safePath));
            } else {
                await this.client.mkdir(pathServerFormat(safePath));
            }
        } catch (error: any) {
            console.error(error);
            vscode.window.showErrorMessage(`Error creating folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async renameFolder(remotePath: string, newName: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Renaming folder`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            const safeNewPath = assertRemotePath(newName, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.rename(pathServerFormat(safePath), pathServerFormat(safeNewPath));
            } else {
                await this.client.rename(pathServerFormat(safePath), safeNewPath);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error renaming folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async deleteFolder(remotePath: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: Deleting folder`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.removeDir(pathServerFormat(safePath));
            } else {
                await this.client.rmdir(pathServerFormat(safePath), true);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error deleting folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }
}
