import SFTPClient from 'ssh2-sftp-client';
import * as vscode from 'vscode';
import { ServerItem } from '../types';
import StatusBarController from './status-bar.controller';
import path from 'path';
import fs from 'fs';

export default class FtpClientController {

    private static instance: FtpClientController;
    private client: SFTPClient;
    public basePath: string;
    private status: 'connected' | 'disconnected' = 'disconnected';
    private currentConfig: ServerItem = {} as ServerItem;

    private constructor() {
        this.client = new SFTPClient();
        this.basePath = '/';
        this.registerEvents();
    }

    public static getInstance(): FtpClientController {
        if (!FtpClientController.instance) {
            FtpClientController.instance = new FtpClientController();
        }
        return FtpClientController.instance;
    }

    private registerEvents() {
        this.client.on('error', (err) => {
            this.status = 'disconnected';
            vscode.window.showErrorMessage('Error de conexión SFTP: ' + err.message);
        });

        this.client.on('end', () => {
            vscode.window.showInformationMessage('Desconectado de SFTP');
            this.status = 'disconnected';
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
                password
            });
            this.status = 'connected';
        } catch (error: any) {
            vscode.window.showErrorMessage('Error de conexión SFTP: ' + error.message);
            this.status = 'disconnected';
        } finally {
            this.updateStatusConnection();
        }
    }

    private async reconnector() {
        if (this.status === 'disconnected') {
            await this.connect(this.currentConfig);
        }
    }

    public async disconnect() {
        await this.client.end();
        this.status = 'disconnected';
        this.updateStatusConnection();
    }

    // list dir
    public async listDirectory(path: string = '/') {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Listando directorio', true);
            await this.reconnector();

            const files = await this.client.list(path);
            this.updateStatusConnection();
            return files;
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al listar el directorio: ' + error.message);
            this.reconnector();
        }
    }

    public async reloadPath(path: string) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Recargando directorio', true);
            await this.reconnector();

            const files = await this.client.list(path);
        

            this.updateStatusConnection();
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al recargar el directorio: ' + error.message);
            this.reconnector();
        }
    }

    // create new file
    public async createFile(path: string, data: string | Buffer = Buffer.from('')) {
        try {
            StatusBarController.getInstance().updateStatusBarText('SFTP: Creando archivo', true);
            await this.reconnector();
            await this.client.put(data, path);
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

                const localPath = editor.document.fileName;                
                let remotePath = localPath.replace(path.join('tmp', 'rd-vscode',this.currentConfig.host), '');
                remotePath = remotePath.replace('//', '/');

               

                const filename = path.basename(localPath);

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Subiendo Archivo " + filename,
                    cancellable: true
                }, async (progress, token) => {
                    token.onCancellationRequested(() => {
                        vscode.window.showInformationMessage('Subida cancelada');
                    });

                    await this.reconnector();

                    await this.client.put(localPath, remotePath);
                    StatusBarController.getInstance().updateStatusBarText('SFTP: Archivo subido con exito', false);

                    setTimeout(() => {
                        this.updateStatusConnection();
                    }, 1000)
                    return true;
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
            await this.client.get(remotePath, dst);
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
            await this.client.delete(remotePath);
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
            await this.client.rename(remotePath, newName);
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
            await this.client.chmod(remotePath, permissions);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al cambiar los permisos: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

    // create folder
    public async createFolder(path: string) {
        StatusBarController.getInstance().updateStatusBarText('SFTP: Creando carpeta', true);
        try {
            await this.reconnector();
            await this.client.mkdir(path);
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
            await this.client.rename(remotePath, newName);
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
            await this.client.rmdir(remotePath, true);
        } catch (error: any) {
            vscode.window.showErrorMessage('Error al eliminar la carpeta: ' + error.message);            
        } finally {
            this.updateStatusConnection();
        }
    }

}