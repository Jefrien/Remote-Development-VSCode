import SFTPClient from 'ssh2-sftp-client';
import * as vscode from 'vscode';
import { ServerItem } from '../types';
import StatusBarController from './status-bar.controller';
import path from 'path';
import fs from 'fs';
import { pathServerFormat } from '../utils';

export class TimeoutError {
    constructor(public message: string, public timeout: number = 10000) {
        this.message = message;        
        setTimeout(() => {
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }, this.timeout);
    }
}

export default class FtpClientController {

    private static RECONNECT_THRESHOLD = 10 * 60 * 1000;

    private static instance: FtpClientController;
    private client: SFTPClient;
    public basePath: string;
    private status: 'connected' | 'disconnected' = 'disconnected';
    public error: string = '';
    private currentConfig: ServerItem = {} as ServerItem;
    private context: vscode.ExtensionContext = {} as vscode.ExtensionContext;
    private conectionTime: number = 0;

    private constructor() {
        this.client = new SFTPClient();
        this.basePath = '/';
        this.registerEvents();
    }

    private writeLog(message: string, type: string = 'errors') {
        fs.appendFileSync(this.context.extensionPath + '/'+type+'.log', message + '\n');
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
            if(err.message.endsWith('All configured authentication methods failed')) {
                this.error = 'Error de autenticación';
            }
            this.writeLog('Error: ' + JSON.stringify({
                code: this.error,
                message: err.message,
                config : this.currentConfig
            }));        
            this.updateStatusConnection();
        });

        this.client.on('end', () => {            
            this.writeLog('Desconectado de SFTP END', 'disconnecteds');
            this.status = 'disconnected';
            this.updateStatusConnection();
        });

        this.client.on('close', () => {            
            this.writeLog('Desconectado de SFTP Close', 'disconnecteds');
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
        if (this.status === 'connected') {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Conectado', false);
        } else {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Desconectado', false);
        }
    }

    public async connect(config: ServerItem) {
        this.currentConfig = config;
        this.error = '';
        const { host, port, username, password } = config;                   
        try {
            if (this.status === 'connected') {
                await this.disconnect();
            }

            StatusBarController.getInstance().updateStatusBarText('SFTP: Conectando', true);

            await this.client.connect({
                host,
                port,
                username,
                password,
                readyTimeout: 10000,
                retries: 2,
            });
            this.status = 'connected';
            this.conectionTime = new Date().getTime();
        } catch (error: any) {
            //vscode.window.showErrorMessage('Error de conexión SFTP: ' + error.message);
            this.status = 'disconnected';
        } finally {
            this.updateStatusConnection();
        }
    }

    private async reconnector() {
        const now = new Date().getTime();
        const isExpired = now - this.conectionTime > FtpClientController.RECONNECT_THRESHOLD;
        if (this.status === 'disconnected' || isExpired) {
            await this.connect(this.currentConfig);
        }
    }

    public async disconnect() {
        await this.client.end();
        this.status = 'disconnected';
        this.updateStatusConnection();
    }

    // list dir
    public async listDirectory(_path: string = '/') {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Listando directorio', true);
            await this.reconnector();            
            
            const timer = setTimeout(() => {
                vscode.window.showErrorMessage('Error al listar el directorio');
                throw new Error('Error al listar el directorio');
            }, 10000);


            const files = await this.client.list(pathServerFormat(_path));
            
            // clear error timeout
            clearTimeout(timer);

            this.updateStatusConnection();
            return files;
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al listar el directorio: ' + error.message);
            this.reconnector();
        }
    }

    public async reloadPath(_path: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Recargando directorio', true);
            await this.reconnector();

            const files = await this.client.list(pathServerFormat(_path));

            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al recargar el directorio: ' + error.message);
            this.reconnector();
        }
    }

    // create new file
    public async createFile(_path: string, data: string | Buffer = Buffer.from('')) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Creando archivo', true);
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
            vscode.window.showErrorMessage('Error al crear el archivo: ' + error.message);
            this.reconnector();
        }
    }

    // upload file
    public async uploadFile() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                StatusBarController.getInstance().updateStatusBarText('SFTP: Subiendo archivo', true);
                await editor.document.save();

                let localPath = editor.document.fileName;                        


                // get only part of string after rd-vscode/ to end
                let remotePath = pathServerFormat(localPath).split('rd-vscode/')[1];                
                remotePath = remotePath.split('/')[1]

                // decode base64
                remotePath = Buffer.from(remotePath, 'base64').toString('utf8') + '/' + path.basename(localPath);                                                 

                const filename = path.basename(localPath);

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Subiendo Archivo " + filename,
                    cancellable: true
                }, async (progress, token) => {
                    token.onCancellationRequested(() => {
                        vscode.window.showInformationMessage('Subida cancelada');
                    });

                    return new Promise(async (resolve, reject) => {
                        try {
                            const timer = setTimeout(() => {
                                vscode.window.showErrorMessage('Error al subir el archivo, reconectndo');                                
                                reject(new Error('Error al subir el archivo'));                  
                            }, 10000);                
        
                            await this.reconnector();
        
                            await this.client.put(localPath, remotePath, {
                                writeStreamOptions: {
                                    flags: 'w',
                                    encoding: 'utf8',
                                    mode: 0o666,
                                }
                            });
                            
                            // clear timer
                            clearTimeout(timer);
                            
                            StatusBarController.getInstance().updateStatusBarText('SFTP: Archivo subido con exito', false);                                    
                            this.updateStatusConnection();                            
                            resolve(true);
                        } catch (error: any) {
                            vscode.window.showErrorMessage('Error al subir el archivo: ' + error.message);
                            reject(error);
                        }
                    });
                                     
                });

            }
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al subir el archivo: ' + error.message);
            this.updateStatusConnection();
        }
    }

    // download file
    public async downloadFile(remotePath: string, localPath: string) {
        try {
            await this.reconnector();

            // Crear el directorio si no existe
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Crear el archivo si no existe
            if (!fs.existsSync(localPath)) {
                fs.writeFileSync(localPath, '');
            }

            let dst = fs.createWriteStream(localPath);
            await this.client.get(pathServerFormat(remotePath), dst);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al descargar el archivo: ' + error.message);
            this.updateStatusConnection();
            throw error;
        }
    }

    // delete file
    public async deleteFile(remotePath: string) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Eliminando archivo', true);
        try {
            await this.reconnector();
            await this.client.delete(pathServerFormat(remotePath));
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al eliminar el archivo: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }   

    // renameFile
    public async renameFile(remotePath: string, newName: string) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Renombrando archivo', true);
        try {
            await this.reconnector();
            await this.client.rename(pathServerFormat(remotePath), newName);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al renombrar el archivo: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

    // permissions 
    public async changePermissions(remotePath: string, permissions: number) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Cambiando permisos', true);
        try {
            await this.reconnector();
            await this.client.chmod(pathServerFormat(remotePath), permissions);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al cambiar los permisos: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

    // create folder
    public async createFolder(_path: string) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Creando carpeta', true);
        try {
            await this.reconnector();
            await this.client.mkdir(pathServerFormat(_path));
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al crear la carpeta: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

    // rename folder
    public async renameFolder(remotePath: string, newName: string) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Renombrando carpeta', true);
        try {
            await this.reconnector();
            await this.client.rename(pathServerFormat(remotePath), newName);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al renombrar la carpeta: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

    // delete folder
    public async deleteFolder(remotePath: string) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Eliminando carpeta', true);
        try {
            await this.reconnector();
            await this.client.rmdir(pathServerFormat(remotePath), true);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al eliminar la carpeta: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

}