import * as vscode from 'vscode';
import FtpClientController from './ftp.controller';
import ExplorerController, { FTPItem } from './explorer.controller';
import LocalizationManager from './localization.controller';
import path from 'path';
import { Rights } from '../types';

/**
 * Handles file-related commands for the Remote Development extension.
 */
export default class FilesController {
    private static instance: FilesController;
    private context: vscode.ExtensionContext;

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;
        const commands = [
            vscode.commands.registerCommand('remote-development.save-and-upload', () => this.handleSaveAndUpload()),
            vscode.commands.registerCommand('remote-development.edit-file', (item: FTPItem) => this.handleContextEdit(item)),
            vscode.commands.registerCommand('remote-development.delete-file', (item: FTPItem) => this.handleContextDelete(item)),
            vscode.commands.registerCommand('remote-development.rename-file', (item: FTPItem) => this.handleContextRename(item)),
            vscode.commands.registerCommand('remote-development.change-permissions', (item: FTPItem) => this.handleContextChangePermissions(item)),
            vscode.commands.registerCommand('remote-development.copy-path', (item: FTPItem) => this.handleContextCopyPath(item)),
        ];
        this.context.subscriptions.push(...commands);
    }

    public static getInstance(_context: vscode.ExtensionContext): FilesController {
        if (!FilesController.instance) {
            FilesController.instance = new FilesController(_context);
        }
        return FilesController.instance;
    }

    /**
     * Handles saving the current file and uploading it to the remote server.
     */
    private async handleSaveAndUpload(): Promise<void> {
        const i18n = LocalizationManager.getInstance();
        try {
            await FtpClientController.getInstance().uploadFile();
        } catch (err: any) {
            vscode.window.showErrorMessage(i18n.t('messages.errorUploadingFile', err.message));
        }
    }

    /**
     * Opens the selected file for editing.
     * @param item The FTP item to edit
     */
    private async handleContextEdit(item: FTPItem): Promise<void> {
        await vscode.commands.executeCommand('remote-development.open-resource', item);
    }

    /**
     * Deletes the selected file after confirmation.
     * @param item The FTP item to delete
     */
    private async handleContextDelete(item: FTPItem): Promise<void> {
        const i18n = LocalizationManager.getInstance();
        try {
            const action = await vscode.window.showWarningMessage(
                i18n.t('messages.deleteFileConfirm'),
                { modal: true },
                i18n.t('messages.yes'), i18n.t('messages.no')
            );
            if (action !== i18n.t('messages.yes')) {
                return;
            }
            const filename = path.basename(item.entry.name);
            await FtpClientController.getInstance().deleteFile(item.path);
            await ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage(i18n.t('messages.fileDeleted', filename));
        } catch (err: any) {
            vscode.window.showErrorMessage(i18n.t('messages.errorDeletingFile', err.message));
        }
    }

    /**
     * Renames the selected file.
     * @param item The FTP item to rename
     */
    private async handleContextRename(item: FTPItem): Promise<void> {
        const i18n = LocalizationManager.getInstance();
        try {
            const newName = await vscode.window.showInputBox({
                placeHolder: i18n.t('messages.enterNewFileName'),
                value: item.entry.name,
                prompt: i18n.t('messages.renameFile')
            });
            if (!newName) {
                return;
            }
            const basePath = path.dirname(item.path);
            const newPath = path.join(basePath, newName);
            await FtpClientController.getInstance().renameFile(item.path, newPath);
            await ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage(i18n.t('messages.fileRenamed', newName));
        } catch (err: any) {
            vscode.window.showErrorMessage(i18n.t('messages.errorRenamingFile', err.message));
        }
    }

    /**
     * Changes the permissions of the selected file.
     * @param item The FTP item whose permissions will be changed
     */
    private async handleContextChangePermissions(item: FTPItem): Promise<void> {
        const i18n = LocalizationManager.getInstance();
        const translatePermissions = (rights: Rights): string => {
            // Convert symbolic permissions (rwx) to octal (421)
            const map: Record<string, string> = { r: '4', w: '2', x: '1', '-': '0' };
            const user = rights.user.split('').map(c => map[c] || '0').join('');
            const group = rights.group.split('').map(c => map[c] || '0').join('');
            const other = rights.other.split('').map(c => map[c] || '0').join('');
            // Sum each group's permissions
            const sum = (s: string) => s.split('').reduce((a, b) => a + parseInt(b, 10), 0);
            return `${sum(user)}${sum(group)}${sum(other)}`;
        };

        try {
            const currentPermissions = translatePermissions(item.entry.rights);
            const permissions = await vscode.window.showInputBox({
                placeHolder: i18n.t('messages.enterFilePermissions'),
                value: currentPermissions,
                prompt: i18n.t('messages.changeFilePermissions')
            });
            if (!permissions) {
                return;
            }
            await FtpClientController.getInstance().changePermissions(item.path, parseInt(permissions, 8));
            await ExplorerController.getInstanceAlt().refresh();
            vscode.window.showInformationMessage(i18n.t('messages.permissionsUpdated', item.entry.name));
        } catch (err: any) {
            vscode.window.showErrorMessage(i18n.t('messages.errorChangingPermissions', err.message));
        }
    }

    /**
     * Copies the file path to the clipboard.
     * @param item The FTP item whose path will be copied
     */
    private async handleContextCopyPath(item: FTPItem): Promise<void> {
        const i18n = LocalizationManager.getInstance();
        try {
            await vscode.env.clipboard.writeText(item.path);
            vscode.window.showInformationMessage(i18n.t('messages.pathCopiedClipboard'));
        } catch (err: any) {
            vscode.window.showErrorMessage(i18n.t('messages.errorCopyingPath', err.message));
        }
    }
}
