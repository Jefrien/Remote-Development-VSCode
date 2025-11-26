import SFTPClient from 'ssh2-sftp-client';
import { Client, FileInfo as FtpFileInfo, FileType } from "basic-ftp";
import * as vscode from 'vscode';
import { ServerItem } from '../types';
import StatusBarController from './status-bar.controller';
import path from 'path';
import fs from 'fs';
import { pathServerFormat } from '../utils';
import { Readable } from 'stream';

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

    private constructor() {
        this.client = new SFTPClient();
        this.ftpClient = new Client(30000); // 30s timeout
        this.basePath = '/';
        this.registerEvents();
    }

    private writeLog(message: string, type: string = 'errors') {
        // Uncomment for logging
        // fs.appendFileSync(path.join(this.context.extensionPath, `${type}.log`), message + '\n');
    }

    public static getInstance(): FtpClientController {
        if (!FtpClientController.instance) {
            FtpClientController.instance = new FtpClientController();
        }
        return FtpClientController.instance;
    }

    public initContext(_context: vscode.ExtensionContext) {
        this.context = _context;
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
                config: this.currentConfig
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

        // FTP Events
        this.ftpClient.ftp.socket?.on('error', (err: any) => {
            this.status = 'disconnected';
            this.error = err.message;
            this.writeLog('FTP Error: ' + JSON.stringify({
                code: this.error,
                message: err.message,
                config: this.currentConfig
            }));
            this.updateStatusConnection();
        });
        this.ftpClient.ftp.socket?.on('close', () => {
            this.writeLog('Disconnected from FTP (CLOSE)', 'disconnecteds');
            this.status = 'disconnected';
            this.updateStatusConnection();
        });
    }

    public get config() {
        return this.currentConfig;
    }

    public setPath(path: string) {
        this.basePath = path;
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
        this.connectionType = config.port === 21 || config.type === 'ftp' ? 'ftp' : 'sftp';
        this.error = '';
        const { host, port, username, password } = config;

        try {
            if (this.status === 'connected') {
                await this.disconnect();
            }
            this.status = 'connecting';
            this.updateStatusConnection();

            if (this.connectionType === 'ftp') {
                await this.ftpClient.access({
                    host,
                    port,
                    user: username,
                    password,
                });
            } else { // sftp
                await this.client.connect({
                    host,
                    port,
                    username,
                    password,
                    readyTimeout: 10000,
                    retries: 2,
                });
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

    private async reconnector() {
        const now = Date.now();
        const isExpired = now - this.connectionTime > FtpClientController.RECONNECT_THRESHOLD;
        if (this.status === 'disconnected' || isExpired) {
            if (this.currentConfig.id) { // Check if a config has been set
                await this.connect(this.currentConfig);
            }
        }
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

            const listPromise = this.connectionType === 'ftp'
                ? this.ftpClient.list(pathServerFormat(_path)).then(files => this.toSftpFileInfo(files))
                : this.client.list(pathServerFormat(_path));

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
            if (this.connectionType === 'ftp') {
                await this.ftpClient.list(pathServerFormat(_path));
            } else {
                await this.client.list(pathServerFormat(_path));
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
            const readable = Readable.from(data);
            if (this.connectionType === 'ftp') {
                await this.ftpClient.uploadFrom(readable, pathServerFormat(_path));
            } else {
                await this.client.put(data, pathServerFormat(_path), {
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

            // Extract the remote path from the local temp path
            const remotePathParts = pathServerFormat(localPath).split('rd-vscode/');
            if (remotePathParts.length < 2) {
                throw new Error('Invalid remote path: The local path does not seem to be a temporary file from this extension.');
            }

            const pathComponents = remotePathParts[1].split('/');
            // The first component is a server identifier, the rest forms the absolute path on the server.
            const remotePath = '/' + pathComponents.slice(1).join('/');
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

                    try {
                        await this.reconnector();
                        if (this.connectionType === 'ftp') {
                            this.ftpClient.trackProgress(info => {
                                progress.report({ increment: info.bytes / 100, message: `${info.bytes / 1024} KB` });
                            });
                            await this.ftpClient.uploadFrom(localPath, remotePath);
                            this.ftpClient.trackProgress(); // Deactivate
                        } else {
                            await this.client.put(localPath, remotePath, {
                                writeStreamOptions: {
                                    flags: 'w',
                                    encoding: 'utf8',
                                    mode: 0o666,
                                }
                            });
                        }
                        clearTimeout(timeout);
                        StatusBarController.getInstance().updateStatusBarText(`${protocol}: File uploaded successfully`, false);
                        resolve(true);
                    } catch (error: any) {
                        console.error(error);
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

    public async downloadFile(remotePath: string, localPath: string) {
        try {
            await this.reconnector();
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (this.connectionType === 'ftp') {
                await this.ftpClient.downloadTo(localPath, pathServerFormat(remotePath));
            } else {
                const dst = fs.createWriteStream(localPath);
                await this.client.get(pathServerFormat(remotePath), dst);
            }
        } catch (error: any) {
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
            if (this.connectionType === 'ftp') {
                await this.ftpClient.remove(pathServerFormat(remotePath));
            } else {
                await this.client.delete(pathServerFormat(remotePath));
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
            if (this.connectionType === 'ftp') {
                await this.ftpClient.rename(pathServerFormat(remotePath), newName);
            } else {
                await this.client.rename(pathServerFormat(remotePath), newName);
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
            if (this.connectionType === 'ftp') {
                await this.ftpClient.send(`SITE CHMOD ${permissions.toString(8)} ${pathServerFormat(remotePath)}`);
            } else {
                await this.client.chmod(pathServerFormat(remotePath), permissions);
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
            if (this.connectionType === 'ftp') {
                console.log('Creating directory (FTP):', pathServerFormat(_path));
                await this.ftpClient.ensureDir(pathServerFormat(_path));
            } else {
                await this.client.mkdir(pathServerFormat(_path));
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
            if (this.connectionType === 'ftp') {
                await this.ftpClient.rename(pathServerFormat(remotePath), newName);
            } else {
                await this.client.rename(pathServerFormat(remotePath), newName);
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
            if (this.connectionType === 'ftp') {
                await this.ftpClient.removeDir(pathServerFormat(remotePath));
            } else {
                await this.client.rmdir(pathServerFormat(remotePath), true);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error deleting folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }
}
