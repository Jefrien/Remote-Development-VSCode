

import * as vscode from 'vscode';
import { FTPNode } from '../types';
import FtpClientController from './ftp.controller';
import path from 'path';

export class FTPItem extends vscode.TreeItem {

    entry: FTPNode;
    path: string;
    childrens: FTPItem[] = [];

    constructor(entry: FTPNode, collapsibleState: vscode.TreeItemCollapsibleState) {
        super(entry.name, collapsibleState);

        this.childrens = [];
        this.entry = entry;
        this.path = entry.path;

        // setup icon
        if (entry.type === 'd') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
            // Usar el icono de la extensión del archivo
            this.resourceUri = vscode.Uri.file(entry.name);
        }

        // metadata
        this.description = '';
        this.tooltip = this.getTooltip();
        this.contextValue = entry.type === 'd' ? 'directory' : 'file';
        this.command = entry.type === 'd' ? void 0 : {
            command: 'remote-development.open-resource',
            title: 'Abrir',
            arguments: [this]
        };

    }

    getTooltip() {
        const date = new Date(this.entry.modifyTime);
        return `${this.entry.name}\nTamaño: ${this.formatSize(this.entry.size)}\nModificado: ${date.toLocaleString()}\nPermisos: ${this.entry.rights.user}${this.entry.rights.group}${this.entry.rights.other}`;
    }

    formatSize(bytes: number) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

}

export default class ExplorerController implements vscode.TreeDataProvider<FTPItem>, vscode.TextDocumentContentProvider {
    private static instance: ExplorerController;
    private data: FTPNode[] = [];
    private context: vscode.ExtensionContext;

    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;

        vscode.window.registerTreeDataProvider('remote-servers', this);

        const open_file_command = vscode.commands.registerCommand('remote-development.open-resource', this.onOpenResource);

        this.context.subscriptions.push(open_file_command);
    }


    public static getInstance(_context: vscode.ExtensionContext): ExplorerController {
        if (!ExplorerController.instance) {
            ExplorerController.instance = new ExplorerController(_context);
        }
        return ExplorerController.instance;
    }

    public async onOpenResource(item: FTPItem) {
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "Abriendo Archivo",
                cancellable: true
            }, async (progress, token) => {
                const sftp = FtpClientController.getInstance();
                const middle_path = item.entry.parent?.path || sftp.basePath;
                const file_path = path.join('tmp', 'remote-development-vscode', sftp.config.host, middle_path, item.entry.name);

                await sftp.downloadFile(item.entry.path, file_path)
                const save_path = vscode.Uri.file(file_path);
                let document = await vscode.workspace.openTextDocument(save_path);
                vscode.window.showTextDocument(document);
                return true;
            })
        } catch (err: any) {
            vscode.window.showErrorMessage('Error opening file: ' + err.message);
        }
    }

    setData(data: FTPNode[]) {
        this.data = this.sortEntries(data);
        this._onDidChangeTreeData?.fire(data);
    }

    sortEntries(items: FTPNode[]) {
        return items.sort((a, b) => {
            // If both are folders or both are files, sort by name
            if (a.type === b.type) {
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            }
            // If one is a folder and other isn't, folder goes first
            return a.type === 'd' ? -1 : 1;
        });
    }

    onDidChange?: vscode.Event<vscode.Uri> | undefined;

    provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
        throw new Error('Method not implemented.');
    }

    getTreeItem(element: FTPItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }
    async getChildren(element?: FTPItem): Promise<FTPItem[]> {
        if (!element) {
            return this.data.map(entry => {
                const collapsibleState = entry.type === 'd'
                    ? (entry.isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                    : vscode.TreeItemCollapsibleState.None;
                return new FTPItem(entry, collapsibleState);
            });
        }

        let results = await FtpClientController.getInstance().listDirectory(element.path) as FTPNode[];

        if (results) {
            results = results.map(_item => {
                return {
                    ..._item,
                    path: path.join(element.path, _item.name)
                };
            });

            const sortChildrens = this.sortEntries(results);

            let items = sortChildrens.map(entry => {
                const collapsibleState = entry.type === 'd'
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                entry.parent = element.entry; // Establecer el padre
                return new FTPItem(entry, collapsibleState);
            });
            return items;
        }
        return [];
    }
    getParent?(element: any) {
        if (element.entry.parent) {
            return element.entry.parent;
        }
        return null;
    }
    resolveTreeItem?(item: vscode.TreeItem, element: any, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }

    refresh() {
        this._onDidChangeTreeData?.fire(undefined);
    }

    addDataChildren(parent: FTPItem, childrens: FTPNode[]) {

        const sortChildrens = this.sortEntries(childrens);

        let items = sortChildrens.map(entry => {
            const collapsibleState = entry.type === 'd'
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            entry.parent = parent.entry; // Establecer el padre
            return new FTPItem(entry, collapsibleState);
        });
        parent.childrens = items;
        this._onDidChangeTreeData.fire(parent);
    }

}
