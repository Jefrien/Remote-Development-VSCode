import * as vscode from 'vscode';
import ExplorerController, { FTPItem } from './explorer.controller';
import FtpClientController from './ftp.controller';
import LocalizationManager from './localization.controller';
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
        const i18n = LocalizationManager.getInstance();
        try {
            const filename = await vscode.window.showInputBox({
                placeHolder: i18n.t('messages.enterFileName'),
                value: ''
            });

            if (filename) {
                const filepath = path.join(item.path, filename);
                await FtpClientController.getInstance().createFile(filepath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(i18n.t('messages.fileCreated', filename));
            }

        } catch (err: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(i18n.t('messages.errorCreatingFile', err.message));
        }
    }

    // create folder
    private async handleCreateFolder(item: FTPItem) {
        const i18n = LocalizationManager.getInstance();
        try {
            const foldername = await vscode.window.showInputBox({
                placeHolder: i18n.t('messages.enterFolderName'),
                value: ''
            });
            if (foldername) {
                const folderpath = path.join(item.path, foldername);
                await FtpClientController.getInstance().createFolder(folderpath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(i18n.t('messages.folderCreated', foldername));
            }

        } catch (err: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(i18n.t('messages.errorCreatingFolder', err.message));
        }
    }

    // rename folder
    private async handleRenameFolder(item: FTPItem) {
        const i18n = LocalizationManager.getInstance();
        try {
            const foldername = await vscode.window.showInputBox({
                placeHolder: i18n.t('messages.enterNewFolderName'),
                value: item.entry.name
            });
            if (foldername) {
                const folderpath = path.join(path.dirname(item.path), foldername);
                await FtpClientController.getInstance().renameFolder(item.path, folderpath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(i18n.t('messages.folderRenamed', foldername));
            }

        } catch (err: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(i18n.t('messages.errorRenamingFolder', err.message));
        }
    }

    // delete folder
    private async handleDeleteFolder(item: FTPItem) {
        const i18n = LocalizationManager.getInstance();
        try {
            const action = await vscode.window.showWarningMessage(
                i18n.t('messages.deleteFolderConfirm'),
                i18n.t('messages.yes'),
                i18n.t('messages.no')
            );
            if (action !== i18n.t('messages.yes')) {
                return;
            }

            await FtpClientController.getInstance().deleteFolder(item.path);
            ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage(i18n.t('messages.folderDeleted', item.entry.name));
        } catch (err: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(i18n.t('messages.errorDeletingFolder', err.message));
        }
    }

    // copy path to clipboard
    private async handleContextCopyPath(item: FTPItem) {
        const i18n = LocalizationManager.getInstance();
        try {
            await vscode.env.clipboard.writeText(item.path);
            vscode.window.showInformationMessage(i18n.t('messages.pathCopiedClipboard'));
        } catch (err: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(i18n.t('messages.errorCopyingPath', err.message));
        }
    }

    // upload file
    private async handleContextUploadFile(item: FTPItem) {
        const i18n = LocalizationManager.getInstance();
        try {
            const file = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: i18n.t('messages.selectFile'),
                title: i18n.t('messages.selectFileDialog')
            });

            const localPath = file?.pop()?.fsPath;
            if (!localPath) {
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: i18n.t('messages.uploadingFile'),
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    vscode.window.showInformationMessage(i18n.t('messages.uploadCancelled'));
                });
                let filename = path.basename(localPath);
                filename = path.join(item.path, filename);

                await FtpClientController.getInstance().createFile(filename, localPath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(i18n.t('messages.fileUploadedSuccess', path.basename(localPath)));
                return true;
            });

        } catch (err: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(i18n.t('messages.errorUploadingFile', err.message));
        }
    }

}