import * as vscode from 'vscode';
import ExplorerController, { FTPItem } from './explorer.controller';
import FtpClientController from './ftp.controller';
import path from 'path';

export default class DirectoriesController {

    private static instance: DirectoriesController;
    private context: vscode.ExtensionContext;

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;

        const commands = [
            vscode.commands.registerCommand('remote-development.add-file', this.handleCreateFile),
            vscode.commands.registerCommand('remote-development.add-folder', this.handleCreateFolder),
            vscode.commands.registerCommand('remote-development.rename-folder', this.handleRenameFolder),
            vscode.commands.registerCommand('remote-development.delete-folder', this.handleDeleteFolder),
            vscode.commands.registerCommand('remote-development.copy-folder-path', this.handleContextCopyPath),
            vscode.commands.registerCommand('remote-development.upload-file', this.handleContextUploadFile),
        ];

        this.context.subscriptions.push(...commands);
    }

    public static getInstance(_context: vscode.ExtensionContext): DirectoriesController {
        if (!DirectoriesController.instance) {
            DirectoriesController.instance = new DirectoriesController(_context);
        }
        return DirectoriesController.instance;
    }

    private async handleCreateFile(item: FTPItem) {
        try {
            const filename = await vscode.window.showInputBox({
                placeHolder: 'Ingrese el nombre del archivo',
                value: ''
            });

            if (filename) {
                const filepath = path.join(item.path, filename);
                await FtpClientController.getInstance().createFile(filepath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage('Creado archivo: ' + filename);
            }

        } catch (err: any) {
            vscode.window.showErrorMessage('Error creando archivo: ' + err.message);
        }
    }

    // create folder
    private async handleCreateFolder(item: FTPItem) {
        try {
            const foldername = await vscode.window.showInputBox({
                placeHolder: 'Ingrese el nombre de la carpeta',
                value: ''
            });
            if (foldername) {
                const folderpath = path.join(item.path, foldername);
                await FtpClientController.getInstance().createFolder(folderpath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage('Creado carpeta: ' + foldername);
            }

        } catch (err: any) {
            vscode.window.showErrorMessage('Error creando carpeta: ' + err.message);
        }
    }

    // rename folder
    private async handleRenameFolder(item: FTPItem) {
        try {
            const foldername = await vscode.window.showInputBox({
                placeHolder: 'Ingrese el nuevo nombre de la carpeta',
                value: item.entry.name
            });
            if (foldername) {
                const folderpath = path.join(path.dirname(item.path), foldername);
                await FtpClientController.getInstance().renameFolder(item.path, folderpath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage('Carpeta renombrada: ' + foldername);
            }

        } catch (err: any) {
            vscode.window.showErrorMessage('Error renombrando carpeta: ' + err.message);
        }
    }

    // delete folder
    private async handleDeleteFolder(item: FTPItem) {
        try {
            const action = await vscode.window.showWarningMessage('¿Deseas eliminar la carpeta? (Todos los archivos serán eliminados)', 'Si', 'No');
            if (action !== 'Si') {
                return;
            }

            await FtpClientController.getInstance().deleteFolder(item.path);
            ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage('Carpeta eliminada: ' + item.entry.name);
        } catch (err: any) {
            vscode.window.showErrorMessage('Error eliminando carpeta: ' + err.message);
        }
    }

    // copy path to clipboard
    private async handleContextCopyPath(item: FTPItem) {
        try {
            await vscode.env.clipboard.writeText(item.path);
            vscode.window.showInformationMessage('Ruta copiada al portapapeles');
        } catch (err: any) {
            vscode.window.showErrorMessage('Error copying path: ' + err.message);
        }
    }

    // upload file
    private async handleContextUploadFile(item: FTPItem) {
        try {
            const file = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Seleccionar Archivo',
                title: 'Seleccionar Archivo'
            });

            const localPath = file?.pop()?.fsPath;
            if (!localPath) {
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Subiendo Archivo",
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    vscode.window.showInformationMessage('Subida cancelada');
                });
                let filename = path.basename(localPath);
                filename = path.join(item.path, filename);

                await FtpClientController.getInstance().createFile(filename, localPath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage('Archivo subido con exito: ' + path.basename(localPath));
                return true;
            });

        } catch (err: any) {
            vscode.window.showErrorMessage('Error uploading file: ' + err.message);
        }
    }

}