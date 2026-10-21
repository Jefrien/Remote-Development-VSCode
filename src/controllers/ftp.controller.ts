import SFTPClient from 'ssh2-sftp-client';
import type { HostFingerprintVerifier } from 'ssh2';
import { Client, FileInfo as FtpFileInfo, FileType } from "basic-ftp";
import * as vscode from 'vscode';
import { ServerItem } from '../types';
import StatusBarController from './status-bar.controller';
import ConfigManager from './config-manager.controller';
import path from 'path';
import fs from 'fs';
import { assertRemotePath, getTempDirectory, hostStorageId, pathServerFormat } from '../utils';
import { Readable, Writable } from 'stream';
import LocalizationManager from './localization.controller';

export class TimeoutError extends Error {
    constructor(public message: string, public timeout: number = 10000) {
        super(message);
        setTimeout(() => {
            vscode.window.showErrorMessage(message);
        }, this.timeout);
    }
}

export function isTransientConnectionError(error: unknown, disconnected = false, clientClosed = false): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return disconnected
        || clientClosed
        || /(?:ECONN|EPIPE|socket|connection|timeout|timed out|closed|reset|TLS)/i.test(message);
}

function normalizeFingerprint(fingerprint: string): string {
    return fingerprint.trim().toLowerCase().replace(/^sha256:/, '').replace(/:/g, '');
}

export default class FtpClientController {
    private static RECONNECT_THRESHOLD = 10 * 60 * 1000; // 10 minutes
    private static UPLOAD_INACTIVITY_TIMEOUT = 2 * 60 * 1000;
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
    private readonly stateListeners = new Set<() => void>();

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

    public getConnectionState(): { status: 'connected' | 'disconnected' | 'connecting'; serverId?: string; host?: string; port?: number; username?: string; path?: string; type?: string } {
        return {
            status: this.status,
            serverId: this.currentConfig.id,
            host: this.currentConfig.host,
            port: this.currentConfig.port,
            username: this.currentConfig.username,
            path: this.currentConfig.path,
            type: this.currentConfig.type || (this.connectionType === 'ftp' ? 'ftp' : 'sftp')
        };
    }

    public onConnectionStateChanged(listener: () => void): vscode.Disposable {
        this.stateListeners.add(listener);
        return new vscode.Disposable(() => this.stateListeners.delete(listener));
    }

    public setPath(remotePath: string) {
        const normalized = remotePath.replace(/\\/g, '/');
        this.basePath = normalized.startsWith('/')
            ? path.posix.resolve('/', normalized)
            : path.posix.resolve('/', `/${normalized}`);
    }

    private updateStatusConnection() {
        const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
        const i18n = LocalizationManager.getInstance();
        let message: string;
        switch (this.status) {
            case 'connected':
                message = `${protocol}: ${i18n.t('Connected')}`;
                break;
            case 'connecting':
                message = `${protocol}: Connecting`;
                break;
            case 'disconnected':
                message = `${protocol}: ${i18n.t('Disconnected')}`;
                break;
        }
        StatusBarController.getInstance().updateStatusBarText(message, this.status === 'connecting');
        for (const listener of this.stateListeners) {
            try {
                listener();
            } catch (error) {
                this.writeLog(`Connection state listener error: ${String(error)}`);
            }
        }
    }

    private wirePath(remotePath: string): string {
        return pathServerFormat(remotePath, this.connectionType === 'ftp' ? 'ftp' : 'sftp');
    }

    public async connect(config: ServerItem, token?: vscode.CancellationToken) {
        const nextConnectionType: 'ftp' | 'sftp' = config.port === 21 || config.type === 'ftp' ? 'ftp' : 'sftp';
        const { host, port, username, password } = config;

        if (!password) {
            throw new Error('A password is required. Store it through the configuration editor.');
        }
        if (nextConnectionType === 'ftp' && config.ftpSecure !== true) {
            throw new Error('Plain FTP is disabled. Set ftpSecure to true and use FTPS.');
        }

        if (token?.isCancellationRequested) {
            throw new Error('Connection cancelled');
        }

        const cancellationSubscription = token?.onCancellationRequested(() => {
            void this.disconnect();
        });

        try {
            if (this.status !== 'disconnected') {
                await this.disconnect();
            }
            if (token?.isCancellationRequested) {
                throw new Error('Connection cancelled');
            }
            this.currentConfig = config;
            this.setPath(config.path || '/');
            this.connectionType = nextConnectionType;
            this.error = '';
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
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FTP connection timed out')), 15000)),
                    ...(token ? [new Promise<never>((_, reject) => token.onCancellationRequested(() => reject(new Error('Connection cancelled'))))] : [])
                ]);
                this.registerFtpSocketEvents();
            } else { // sftp
                await this.connectSftpWithTrust(config, token);
            }
            if (token?.isCancellationRequested) {
                throw new Error('Connection cancelled');
            }
            this.status = 'connected';
            this.connectionTime = Date.now();
        } catch (error: any) {
            this.status = 'disconnected';
            await this.disconnect();
            throw new Error(`${nextConnectionType.toUpperCase()} connection error: ${error.message}`);
        } finally {
            cancellationSubscription?.dispose();
            this.updateStatusConnection();
        }
    }

    private async connectSftpWithTrust(config: ServerItem, token?: vscode.CancellationToken): Promise<void> {
        let trustError: Error | undefined;
        let verificationActive = true;
        let verificationCompleted = false;

        // A rejected host-key verification leaves ssh2-sftp-client in a
        // terminal state. Always use a fresh client for a new handshake.
        await this.closeSftpSafely();
        this.client = new SFTPClient();
        this.registerEvents();

        const verifyHostKey = ((fingerprint: string, verify: (trusted: boolean) => void): void => {
            const verifyOnce = (trusted: boolean) => {
                if (verificationCompleted) {
                    return;
                }
                verificationCompleted = true;
                verify(trusted);
            };

            if (!verificationActive || token?.isCancellationRequested) {
                verifyOnce(false);
                return;
            }

            const received = normalizeFingerprint(fingerprint);
            const expected = config.hostFingerprint
                ? normalizeFingerprint(config.hostFingerprint)
                : undefined;
            const matches = Boolean(expected && received === expected);
            this.writeLog(`SFTP host key received; match=${matches}`);

            if (matches) {
                verifyOnce(true);
                return;
            }

            const detail = expected
                ? `The server host key changed.\n\nExpected: ${config.hostFingerprint}\nReceived: ${received}`
                : `This server has not been trusted yet.\n\nFingerprint: ${received}`;
            void Promise.resolve(vscode.window.showWarningMessage(
                expected ? 'SFTP host key changed' : 'Trust this SFTP server?',
                { modal: true, detail },
                'Trust once',
                'Trust always',
                'Cancel'
            )).then(async action => {
                if (!verificationActive || token?.isCancellationRequested) {
                    verifyOnce(false);
                    return;
                }
                if (action === 'Trust once' || action === 'Trust always') {
                    if (action === 'Trust always') {
                        await ConfigManager.getInstance(this.context).saveServerFingerprint(config, received);
                        config.hostFingerprint = received;
                    }
                    verifyOnce(true);
                    return;
                }
                trustError = new Error('SFTP host key was not trusted');
                verifyOnce(false);
            }).catch((error: unknown) => {
                trustError = error instanceof Error ? error : new Error(String(error));
                verifyOnce(false);
            });
        }) as unknown as HostFingerprintVerifier;

        let timeout: NodeJS.Timeout | undefined;
        let transportCancellationSubscription: vscode.Disposable | undefined;
        try {
            const cancellationPromise = token
                ? new Promise<never>((_, reject) => {
                    transportCancellationSubscription = token.onCancellationRequested(() => reject(new Error('Connection cancelled')));
                })
                : undefined;
            await Promise.race([
                this.client.connect({
                    host: config.host,
                    port: config.port,
                    username: config.username,
                    password: config.password,
                    hostHash: 'sha256',
                    hostVerifier: verifyHostKey,
                    readyTimeout: 10000,
                    retries: 0,
                }),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('SFTP connection timed out')), 15000);
                }),
                ...(cancellationPromise ? [cancellationPromise] : [])
            ]);
        } catch (error) {
            this.status = 'disconnected';
            await this.closeSftpSafely();
            throw trustError || error;
        } finally {
            verificationActive = false;
            if (timeout) {
                clearTimeout(timeout);
            }
            transportCancellationSubscription?.dispose();
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
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Listing directory')}`, true);
            await this.reconnector();

            const safePath = assertRemotePath(_path, this.basePath);
            const listPromise = this.connectionType === 'ftp'
                ? this.ftpClient.list(this.wirePath(safePath)).then(files => this.toSftpFileInfo(files))
                : this.client.list(this.wirePath(safePath));

            const files = await Promise.race([
                listPromise,
                new Promise<SFTPClient.FileInfo[]>((_, reject) => setTimeout(() => {
                    reject(new Error('Directory listing timed out'));
                }, 10000))
            ]);

            this.updateStatusConnection();
            return files as SFTPClient.FileInfo[];
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error listing directory: {0}', error.message));
            await this.reconnector();
            throw error;
        }
    }

    public async reloadPath(_path: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Reloading directory')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(_path, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.list(this.wirePath(safePath));
            } else {
                await this.client.list(this.wirePath(safePath));
            }
            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error reloading directory: {0}', error.message));
            await this.reconnector();
            throw error;
        }
    }

    public async createFile(_path: string, data: string | Buffer = Buffer.from('')) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Creating file')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(_path, this.basePath);
            const readable = Readable.from(data);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.uploadFrom(readable, this.wirePath(safePath));
            } else {
                await this.client.put(data, this.wirePath(safePath), {
                    writeStreamOptions: {
                        flags: 'w',
                        encoding: 'utf8',
                        mode: 0o666,
                    }
                });
            }
            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error creating file: {0}', error.message));
            await this.reconnector();
            throw error;
        }
    }

    public async uploadLocalFile(localPath: string, remotePath: string, token?: vscode.CancellationToken): Promise<void> {
        const stats = await fs.promises.stat(localPath);
        if (!stats.isFile()) {
            throw new Error('The selected upload source is not a regular file');
        }

        await this.reconnector();
        if (token?.isCancellationRequested) {
            throw new Error('Upload cancelled');
        }
        const safePath = assertRemotePath(remotePath, this.basePath);
        const cancellationSubscription = token?.onCancellationRequested(() => {
            void this.disconnect();
        });
        let uploadCancellationSubscription: vscode.Disposable | undefined;
        try {
            const upload = this.connectionType === 'ftp'
                ? this.ftpClient.uploadFrom(localPath, this.wirePath(safePath))
                : this.client.put(localPath, this.wirePath(safePath));
            const cancellationPromise = token
                ? new Promise<never>((_, reject) => {
                    uploadCancellationSubscription = token.onCancellationRequested(() => reject(new Error('Upload cancelled')));
                })
                : undefined;
            await Promise.race([
                upload,
                ...(cancellationPromise ? [cancellationPromise] : [])
            ]);
        } finally {
            cancellationSubscription?.dispose();
            uploadCancellationSubscription?.dispose();
        }
        this.updateStatusConnection();
    }

    public async uploadFile() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                throw new Error('No active editor');
            }
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Uploading file')}`, true);
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
                title: LocalizationManager.getInstance().t('Uploading file: {0}', filename),
                cancellable: true,
            }, async (progress, token) => {
                return new Promise(async (resolve, reject) => {
                    let cancelled = false;
                    let uploadPromise: Promise<void> | undefined;
                    let timeout: NodeJS.Timeout | undefined;
                    let cancellationSubscription: vscode.Disposable | undefined;

                    const resetUploadTimeout = () => {
                        if (timeout) {
                            clearTimeout(timeout);
                        }
                        timeout = setTimeout(() => {
                            void cancelUpload(new Error('Upload timed out due to inactivity'));
                        }, FtpClientController.UPLOAD_INACTIVITY_TIMEOUT);
                    };

                    const cancelUpload = async (error: Error) => {
                        if (cancelled) {
                            return;
                        }
                        cancelled = true;
                        if (timeout) {
                            clearTimeout(timeout);
                        }
                        cancellationSubscription?.dispose();
                        // Closing the active transport is the cancellation
                        // mechanism supported by both basic-ftp and SFTP.
                        await this.disconnect();
                        reject(error);
                    };

                    const uploadOnce = async () => {
                        await this.reconnector();
                        if (cancelled) {
                            throw new Error('Upload cancelled');
                        }
                        if (this.connectionType === 'ftp') {
                            this.ftpClient.trackProgress(info => {
                                progress.report({ increment: info.bytes / 100, message: `${info.bytes / 1024} KB` });
                                resetUploadTimeout();
                            });
                            try {
                                await this.ftpClient.uploadFrom(localPath, this.wirePath(remotePath));
                            } finally {
                                this.ftpClient.trackProgress();
                            }
                        } else {
                            await this.client.put(localPath, this.wirePath(remotePath), {
                                writeStreamOptions: {
                                    flags: 'w',
                                    encoding: 'utf8',
                                    mode: 0o666,
                                }
                            });
                        }
                    };

                    resetUploadTimeout();
                    cancellationSubscription = token.onCancellationRequested(() => {
                        vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Upload cancelled'));
                        void cancelUpload(new Error('Upload cancelled'));
                    });

                    try {
                        uploadPromise = uploadOnce();
                        await uploadPromise;
                        if (cancelled) {
                            return;
                        }
                        clearTimeout(timeout);
                        cancellationSubscription?.dispose();
                        StatusBarController.getInstance().updateStatusBarText(`${protocol}: File uploaded successfully`, false);
                        resolve(true);
                    } catch (error: any) {
                        if (!cancelled && isTransientConnectionError(error, this.status === 'disconnected', this.ftpClient.closed)) {
                            try {
                                this.markDisconnected(error);
                                uploadPromise = uploadOnce();
                                await uploadPromise;
                                if (cancelled) {
                                    return;
                                }
                                clearTimeout(timeout);
                                cancellationSubscription?.dispose();
                                StatusBarController.getInstance().updateStatusBarText(`${protocol}: File uploaded successfully`, false);
                                resolve(true);
                                return;
                            } catch (retryError: any) {
                                error = retryError;
                            }
                        }
                        clearTimeout(timeout);
                        cancellationSubscription?.dispose();
                        if (cancelled) {
                            return;
                        }
                        vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error uploading file: {0}', error.message));
                        reject(error);
                    }
                });
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error uploading file: {0}', error.message));
            this.updateStatusConnection();
            throw error;
        }
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
                await this.ftpClient.downloadTo(dst, this.wirePath(safeRemotePath));
            } else {
                await this.client.get(this.wirePath(safeRemotePath), dst);
            }
        } catch (error: any) {
            try {
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                }
            } catch { /* best effort cleanup */ }
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error downloading file: {0}', error.message));
            this.updateStatusConnection();
            throw error;
        }
    }

    public async deleteFile(remotePath: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Deleting file')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.remove(this.wirePath(safePath));
            } else {
                await this.client.delete(this.wirePath(safePath));
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error deleting file: {0}', error.message));
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async renameFile(remotePath: string, newName: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Renaming file')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            const safeNewPath = assertRemotePath(newName, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.rename(this.wirePath(safePath), this.wirePath(safeNewPath));
            } else {
                await this.client.rename(this.wirePath(safePath), this.wirePath(safeNewPath));
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error renaming file: {0}', error.message));
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async changePermissions(remotePath: string, permissions: number) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Changing permissions')}`, true);
            await this.reconnector();
            if (!Number.isInteger(permissions) || permissions < 0 || permissions > 0o7777) {
                throw new Error('Invalid file permissions');
            }
            const safePath = assertRemotePath(remotePath, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.send(`SITE CHMOD ${permissions.toString(8)} ${this.wirePath(safePath)}`);
            } else {
                await this.client.chmod(this.wirePath(safePath), permissions);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error changing permissions: {0}', error.message));
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async createFolder(_path: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Creating folder')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(_path, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.ensureDir(this.wirePath(safePath));
            } else {
                await this.client.mkdir(this.wirePath(safePath));
            }
        } catch (error: any) {
            console.error(error);
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error creating folder: {0}', error.message));
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async renameFolder(remotePath: string, newName: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Renaming folder')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            const safeNewPath = assertRemotePath(newName, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.rename(this.wirePath(safePath), this.wirePath(safeNewPath));
            } else {
                await this.client.rename(this.wirePath(safePath), this.wirePath(safeNewPath));
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error renaming folder: {0}', error.message));
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async deleteFolder(remotePath: string) {
        try {
            const protocol = (this.currentConfig.type || 'sftp').toUpperCase();
            StatusBarController.getInstance().updateStatusBarText(`${protocol}: ${LocalizationManager.getInstance().t('Deleting folder')}`, true);
            await this.reconnector();
            const safePath = assertRemotePath(remotePath, this.basePath);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.removeDir(this.wirePath(safePath));
            } else {
                await this.client.rmdir(this.wirePath(safePath), true);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error deleting folder: {0}', error.message));
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }
}
