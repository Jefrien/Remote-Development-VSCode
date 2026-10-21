import * as vscode from 'vscode';
import ExplorerController, { FTPItem } from './explorer.controller';
import FtpClientController from './ftp.controller';
import path from 'path';
import { isSafeRemoteName } from '../utils';
import LocalizationManager from './localization.controller';

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
                placeHolder: LocalizationManager.getInstance().t('Enter file name'),
                value: ''
            });

            if (filename) {
                if (!isSafeRemoteName(filename)) {
                    throw new Error('Invalid file name');
                }
                const filepath = path.join(item.path, filename);
                await FtpClientController.getInstance().createFile(filepath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(LocalizationManager.getInstance().t('File created: {0}', filename));
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error creating file: {0}', err.message));
        }
    }

    // create folder
    private async handleCreateFolder(item: FTPItem) {
        try {
            const foldername = await vscode.window.showInputBox({
                placeHolder: LocalizationManager.getInstance().t('Enter folder name'),
                value: ''
            });
            if (foldername) {
                if (!isSafeRemoteName(foldername)) {
                    throw new Error('Invalid folder name');
                }
                const folderpath = path.join(item.path, foldername);
                await FtpClientController.getInstance().createFolder(folderpath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Folder created: {0}', foldername));
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error creating folder: {0}', err.message));
        }
    }

    // rename folder
    private async handleRenameFolder(item: FTPItem) {
        try {
            const foldername = await vscode.window.showInputBox({
                placeHolder: LocalizationManager.getInstance().t('Enter the new folder name'),
                value: item.entry.name
            });
            if (foldername) {
                if (!isSafeRemoteName(foldername)) {
                    throw new Error('Invalid folder name');
                }
                const folderpath = path.join(path.dirname(item.path), foldername);
                await FtpClientController.getInstance().renameFolder(item.path, folderpath);
                ExplorerController.getInstanceAlt().refresh();
                vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Folder renamed to: {0}', foldername));
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error renaming folder: {0}', err.message));
        }
    }

    // delete folder
    private async handleDeleteFolder(item: FTPItem) {
        try {
            const action = await vscode.window.showWarningMessage(
                LocalizationManager.getInstance().t('Do you want to delete this folder?'),
                LocalizationManager.getInstance().t('Yes'),
                LocalizationManager.getInstance().t('No')
            );
            if (action !== LocalizationManager.getInstance().t('Yes')) {
                return;
            }

            await FtpClientController.getInstance().deleteFolder(item.path);
            ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Folder deleted: {0}', item.entry.name));
        } catch (err: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error deleting folder: {0}', err.message));
        }
    }

    // copy path to clipboard
    private async handleContextCopyPath(item: FTPItem) {
        try {
            await vscode.env.clipboard.writeText(item.path);
            vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Path copied to clipboard'));
        } catch (err: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error copying path: {0}', err.message));
        }
    }

    // upload file
    private async handleContextUploadFile(item: FTPItem) {
        try {
            const file = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: LocalizationManager.getInstance().t('Select file'),
                title: LocalizationManager.getInstance().t('Select a file to upload')
            });

            const localPath = file?.pop()?.fsPath;
            if (!localPath) {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: LocalizationManager.getInstance().t('Uploading file...'),
                cancellable: true
            }, async (progress, token) => {
                const cancellationSubscription = token.onCancellationRequested(() => {
                    vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Upload cancelled'));
                });
                try {
                    const filename = path.posix.join(item.path, path.basename(localPath));
                    await FtpClientController.getInstance().uploadLocalFile(localPath, filename, token);
                    if (token.isCancellationRequested) {
                        return false;
                    }
                    ExplorerController.getInstanceAlt().refresh();
                    vscode.window.showInformationMessage(LocalizationManager.getInstance().t('File uploaded: {0}', path.basename(localPath)));
                    return true;
                } finally {
                    cancellationSubscription.dispose();
                }
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(LocalizationManager.getInstance().t('Error uploading file: {0}', err.message));
        }
    }

}
