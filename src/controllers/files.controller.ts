import * as vscode from 'vscode';
import FtpClientController from './ftp.controller';
import { FTPItem } from './explorer.controller';

export default class FilesController {

    private static instance: FilesController;
    private context: vscode.ExtensionContext

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;
        
        const save_and_upload = vscode.commands.registerCommand('remote-development.save-and-upload', this.handleSaveAndUpload);
        
        // context commands 
        const context_edit = vscode.commands.registerCommand('remote-development.edit-file', this.handleContextEdit);
           
        this.context.subscriptions.push(save_and_upload);
        this.context.subscriptions.push(context_edit);
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


}