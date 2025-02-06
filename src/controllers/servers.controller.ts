import * as vscode from 'vscode';
import path from 'path';
import fs from 'fs/promises';
import { FTPNode, ServerItem } from '../types';
import FtpClientController from './ftp.controller';
import ExplorerController from './explorer.controller';



export default class ServersController {

    private static instance: ServersController;
    private context: vscode.ExtensionContext;
    private config: {
        servers: ServerItem[];
    } = {
            servers: []
        };

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;

        const command = vscode.commands.registerCommand('remote-development.servers-list', async () => {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Cargando Servidores",
                cancellable: true,

            }, async (progress, token) => {
                await this.loadServers();
                this.showServersSelector();
                return true;
            });
        });

        this.context.subscriptions.push(command);

    }

    public static getInstance(_context: vscode.ExtensionContext): ServersController {
        if (!ServersController.instance) {
            ServersController.instance = new ServersController(_context);
        }
        return ServersController.instance;
    }

    public async loadServers() {
        try {
            const configPath = path.join(this.context.extensionPath, 'config', 'main.json');
            const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
            this.config = configData;
        } catch (error) {
            vscode.window.showErrorMessage('Error al cargar la configuración de servidores. Revisa la consola para más detalles.');
        }
    }

    private onSelectServer(server: ServerItem) {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Conectando a " + server.name,
            cancellable: true,
        }, async (progress, token) => {

            token.onCancellationRequested(() => {
                vscode.window.showInformationMessage('Conexión cancelada');
            });

            await FtpClientController.getInstance().connect(server);
            let items: FTPNode[] = await FtpClientController.getInstance().listDirectory(server.path || '/') as FTPNode[];
     

            items = items.map(item => {
                const base = server.path ? server.path : '';
                return {
                    ...item,
                    path: path.join(base, item.name)
                };
            });

            FtpClientController.getInstance().setPath(server.path || '/');
            ExplorerController.getInstance(this.context).setData(items);
            
            return true;
        });
    }

    public showServersSelector() {

        const quickPickItems = this.config.servers.map(server => ({
            label: server.name,
            description: `${server.host}:${server.port}`,
            detail: `Usuario: ${server.username}`,
            server: server
        }));

        vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Selecciona un servidor',
            matchOnDescription: true,
            matchOnDetail: true
        }).then( (selection) => {
            if (selection) {
                const server: ServerItem = selection.server;
                this.onSelectServer(server);
                return true;
            }
        });

    }

}