import * as vscode from 'vscode';
import FtpClientController from './ftp.controller';
import ExplorerController, { FTPItem } from './explorer.controller';
import path from 'path';
import { Rights } from '../types';

export default class FilesController {

    private static instance: FilesController;
    private context: vscode.ExtensionContext;

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;

        const commands = [
            vscode.commands.registerCommand('remote-development.save-and-upload', this.handleSaveAndUpload),
            vscode.commands.registerCommand('remote-development.edit-file', this.handleContextEdit),
            vscode.commands.registerCommand('remote-development.delete-file', this.handleContextDelete),
            vscode.commands.registerCommand('remote-development.rename-file', this.handleContextRename),
            vscode.commands.registerCommand('remote-development.change-permissions', this.handleContextChangePermissions),
            vscode.commands.registerCommand('remote-development.copy-path', this.handleContextCopyPath),
        ];
                                   
        this.context.subscriptions.push(...commands);
    }

    public static getInstance(_context: vscode.ExtensionContext): FilesController {
        if (!FilesController.instance) {
            FilesController.instance = new FilesController(_context);
        }
        return FilesController.instance;
    }

    private async handleSaveAndUpload() {
        try {
            await FtpClientController.getInstance().uploadFile();
        } catch (err: any) {
            vscode.window.showErrorMessage('Error uploading file: ' + err.message);
        }
    }

    private async handleContextEdit(item: FTPItem) {
        // execute command remote-development.open-resource
        vscode.commands.executeCommand('remote-development.open-resource', item);
    }

    // delete file
    private async handleContextDelete(item: FTPItem) {
        try {           
            const action = await vscode.window.showWarningMessage('¿Deseas eliminar el archivo?', 'Si', 'No');
            if (action !== 'Si') {
                return;
            }

            await FtpClientController.getInstance().deleteFile(item.path);
            ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage('Archivo eliminado: ' + item.entry.name);
        } catch (err: any) {
            vscode.window.showErrorMessage('Error deleting file: ' + err.message);
        }
    }

    // rename file
    private async handleContextRename(item: FTPItem) {
        try {
            const newName = await vscode.window.showInputBox({
                placeHolder: 'Ingrese el nuevo nombre del archivo',
                value: item.entry.name
            });

            if (!newName) {
                return;
            }

            let basepath = path.dirname(item.path);
            basepath = path.join(basepath, newName);

            await FtpClientController.getInstance().renameFile(item.path, basepath);
            ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage('Archivo renombrado: ' + newName);

        } catch (err: any) {
            vscode.window.showErrorMessage('Error renaming file: ' + err.message);
        }
    }    

    // change permissions
    private async handleContextChangePermissions(item: FTPItem) {


        function translatePermissions(rights: Rights): string {
            // converts rights to chmod format
            let user: Number = Number(rights.user.replace('r', '4').replace('w', '2').replace('x', '1'));
            let group: Number = Number(rights.group.replace('r', '4').replace('w', '2').replace('x', '1'));
            let other: Number = Number(rights.other.replace('r', '4').replace('w', '2').replace('x', '1'));

            // sum user digits 
            user = Array.from(String(user), Number).reduce((a, b) => a + b, 0);

            // sum group digits
            group = Array.from(String(group), Number).reduce((a, b) => a + b, 0);

            // sum other digits
            other = Array.from(String(other), Number).reduce((a, b) => a + b, 0);
    
            return `${user}${group}${other}`;
        }

        try {            
            const permissions = await vscode.window.showInputBox({
                placeHolder: 'Ingrese los permisos del archivo',
                value: translatePermissions(item.entry.rights)
            });

            if (!permissions) {
                return;
            }

            await FtpClientController.getInstance().changePermissions(item.path, Number(permissions));
            ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage('Se actualizaron los permisos de: ' + item.entry.name);

        } catch (err: any) {
            vscode.window.showErrorMessage('Error changing permissions: ' + err.message);
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
}