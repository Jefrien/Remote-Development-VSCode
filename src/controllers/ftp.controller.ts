import SFTPClient from 'ssh2-sftp-client';
import { Client } from "basic-ftp"
import * as vscode from 'vscode';
import { ServerItem } from '../types';
import StatusBarController from './status-bar.controller';
import path from 'path';
import fs from 'fs';
import { pathServerFormat } from '../utils';

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
   // private ftpClient: Client;
    public basePath: string;
    private status: 'connected' | 'disconnected' = 'disconnected';
    public error: string = '';
    private currentConfig: ServerItem = {} as ServerItem;
    private context: vscode.ExtensionContext = {} as vscode.ExtensionContext;
    private connectionTime: number = 0;

    private constructor() {
        this.client = new SFTPClient();
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
        this.client.on('error', (err) => {
            this.status = 'disconnected';
            this.error = err.message;
            if (err.message.endsWith('All configured authentication methods failed')) {
                this.error = 'Authentication error';
            }
            this.writeLog('Error: ' + JSON.stringify({
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
    }

    public get config() {
        return this.currentConfig;
    }

    public setPath(path: string) {
        this.basePath = path;
    }

    private updateStatusConnection() {
        const message = this.status === 'connected'
            ? 'SFTP: Connected'
            : 'SFTP: Disconnected';
        StatusBarController.getInstance().updateStatusBarText(message, false);
    }

    public async connect(config: ServerItem) {
        this.currentConfig = config;
        this.error = '';
        const { host, port, username, password } = config;
        try {
            if (this.status === 'connected') {
                await this.disconnect();
            }
            StatusBarController.getInstance().updateStatusBarText('SFTP: Connecting', true);
            await this.client.connect({
                host,
                port,
                username,
                password,
                readyTimeout: 10000,
                retries: 2,
            });
            this.status = 'connected';
            this.connectionTime = Date.now();
        } catch (error: any) {
            this.status = 'disconnected';
            await this.disconnect();
            throw new Error(`SFTP connection error: ${error.message}`);
        } finally {
            this.updateStatusConnection();
        }
    }

    private async reconnector() {
        const now = Date.now();
        const isExpired = now - this.connectionTime > FtpClientController.RECONNECT_THRESHOLD;
        if (this.status === 'disconnected' || isExpired) {
            await this.connect(this.currentConfig);
        }
    }

    public async disconnect() {
        try {
            await this.client.end();
        } catch (error: any) {
            this.writeLog(`Disconnection error: ${error.message}`);
        }
        this.status = 'disconnected';
        this.updateStatusConnection();
    }

    public async listDirectory(_path: string = '/') {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Listing directory', true);
            await this.reconnector();

            // Use a Promise.race to handle timeouts
            const files = await Promise.race([
                this.client.list(pathServerFormat(_path)),
                new Promise((_, reject) => setTimeout(() => {
                    reject(new Error('Directory listing timed out'));
                }, 10000))
            ]);
            this.updateStatusConnection();
            return files;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error listing directory: ${error.message}`);
            await this.reconnector();
            throw error;
        }
    }

    public async reloadPath(_path: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Reloading directory', true);
            await this.reconnector();
            await this.client.list(pathServerFormat(_path));
            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error reloading directory: ${error.message}`);
            await this.reconnector();
            throw error;
        }
    }

    public async createFile(_path: string, data: string | Buffer = Buffer.from('')) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Creating file', true);
            await this.reconnector();
            await this.client.put(data, pathServerFormat(_path), {
                writeStreamOptions: {
                    flags: 'w',
                    encoding: 'utf8',
                    mode: 0o666,
                }
            });
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
            StatusBarController.getInstance().updateStatusBarText('SFTP: Uploading file', true);
            await editor.document.save();
            const localPath = editor.document.fileName;
            // Extract the remote path from the local temp path
            const remotePathParts = pathServerFormat(localPath).split('rd-vscode/');
            if (remotePathParts.length < 2) {
                throw new Error('Invalid remote path');
            }
            const remotePath = Buffer.from(remotePathParts[1].split('/')[1], 'base64').toString('utf8') +
                               '/' + path.basename(localPath);
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
                        await this.client.put(localPath, remotePath, {
                            writeStreamOptions: {
                                flags: 'w',
                                encoding: 'utf8',
                                mode: 0o666,
                            }
                        });
                        clearTimeout(timeout);
                        StatusBarController.getInstance().updateStatusBarText('SFTP: File uploaded successfully', false);
                        resolve(true);
                    } catch (error: any) {
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
            const dst = fs.createWriteStream(localPath);
            await this.client.get(pathServerFormat(remotePath), dst);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error downloading file: ${error.message}`);
            this.updateStatusConnection();
            throw error;
        }
    }

    public async deleteFile(remotePath: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Deleting file', true);
            await this.reconnector();
            await this.client.delete(pathServerFormat(remotePath));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error deleting file: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async renameFile(remotePath: string, newName: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Renaming file', true);
            await this.reconnector();
            await this.client.rename(pathServerFormat(remotePath), newName);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error renaming file: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async changePermissions(remotePath: string, permissions: number) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Changing permissions', true);
            await this.reconnector();
            await this.client.chmod(pathServerFormat(remotePath), permissions);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error changing permissions: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async createFolder(_path: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Creating folder', true);
            await this.reconnector();
            await this.client.mkdir(pathServerFormat(_path));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error creating folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async renameFolder(remotePath: string, newName: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Renaming folder', true);
            await this.reconnector();
            await this.client.rename(pathServerFormat(remotePath), newName);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error renaming folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }

    public async deleteFolder(remotePath: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Deleting folder', true);
            await this.reconnector();
            await this.client.rmdir(pathServerFormat(remotePath), true);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error deleting folder: ${error.message}`);
            throw error;
        } finally {
            this.updateStatusConnection();
        }
    }
}
