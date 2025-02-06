import * as vscode from 'vscode';
import FtpClientController from './ftp.controller';
import { FTPItem } from './explorer.controller';

export default class DirectoriesController {

    private static instance: DirectoriesController;
    private context: vscode.ExtensionContext

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;
        
        const commands = [
            vscode.commands.registerCommand('remote-development.add-file', this.handleCreateFile)
        ];                
           
        this.context.subscriptions.push(...commands);        
    }

    public static getInstance(_context: vscode.ExtensionContext): DirectoriesController {
        if (!DirectoriesController.instance) {
            DirectoriesController.instance = new DirectoriesController(_context);
        }
        return DirectoriesController.instance;
    }

    private async handleCreateFile() {
        try {
            const filename = await vscode.window.showInputBox({
                placeHolder: 'Ingrese el nombre del archivo',
                value: ''
              });

              if(filename) {
                vscode.window.showInformationMessage('Creado archivo: ' + filename);
              }

        } catch (err: any) {
            vscode.window.showErrorMessage('Error creando archivo: ' + err.message);
        }
    }



}