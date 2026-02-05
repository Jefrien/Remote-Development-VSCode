import * as vscode from 'vscode';
import { ServerItem } from '../types';
import FtpClientController from './ftp.controller';
import ExplorerController from './explorer.controller';
import ConfigManager from './config-manager.controller';
import LocalizationManager from './localization.controller';

export default class ServersController {
    private static instance: ServersController;
    private context: vscode.ExtensionContext;
    private config: { servers: ServerItem[] } = { servers: [] };

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;
        // Register the command to list and connect to servers
        const command = vscode.commands.registerCommand(
            'remote-development.servers-list',
            async () => {
                const i18n = LocalizationManager.getInstance();
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: i18n.t('messages.loadingServers'),
                        cancellable: true,
                    },
                    async (progress, token) => {
                        token.onCancellationRequested(() => {
                            vscode.window.showInformationMessage(i18n.t('messages.serverLoadingCancelled'));
                        });
                        await this.loadServers();
                        this.showServersSelector();
                    }
                );
            }
        );
        this.context.subscriptions.push(command);
    }

    public static getInstance(_context: vscode.ExtensionContext): ServersController {
        if (!ServersController.instance) {
            ServersController.instance = new ServersController(_context);
        }
        return ServersController.instance;
    }

    /**
     * Loads the list of servers from the configuration file.
     */
    public async loadServers(): Promise<void> {
        try {
            this.config = await ConfigManager.getInstance(this.context).loadConfig();
        } catch (error: any) {
            const i18n = LocalizationManager.getInstance();
            vscode.window.showErrorMessage(
                i18n.t('messages.errorLoadingServerConfig', error.message)
            );
            throw error; // Re-throw to allow further handling if needed
        }
    }

    /**
     * Handles the selection of a server and initiates the connection.
     * @param server The selected server configuration
     */
    private async onSelectServer(server: ServerItem): Promise<boolean> {
        const i18n = LocalizationManager.getInstance();
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: i18n.t('messages.connectingTo', server.name),
                cancellable: true,
            },
            async (progress, token) => {
                token.onCancellationRequested(() => {
                    vscode.window.showInformationMessage(i18n.t('messages.connectionCancelled'));
                });

                try {
                    const ftpClient = FtpClientController.getInstance();

                    // verify if server have id, if not generate a random one
                    if (!server.id) {
                        server.id = Math.random().toString(36).substring(2, 15);
                    }

                    await ftpClient.connect(server);

                    if (ftpClient.error) {
                        vscode.window.showErrorMessage(ftpClient.error);
                        return false;
                    }

                    ftpClient.setPath(server.path || '/');
                    ExplorerController.getInstance(this.context).initServer();
                    return true;
                } catch (error: any) {
                    vscode.window.showErrorMessage(
                        i18n.t('messages.errorConnectingServer', error.message)
                    );
                    return false;
                }
            }
        );
    }

    /**
     * Shows a quick pick menu to select a server from the loaded configuration.
     */
    public showServersSelector(): Thenable<boolean | undefined> {
        const i18n = LocalizationManager.getInstance();
        const quickPickItems = this.config.servers.map((server) => ({
            label: server.name,
            description: `${server.host}:${server.port}`,
            detail: `User: ${server.username}`,
            server: server,
        }));

        return vscode.window.showQuickPick(quickPickItems, {
            placeHolder: i18n.t('messages.selectServer'),
            matchOnDescription: true,
            matchOnDetail: true,
        }).then((selection) => {
            if (selection) {
                return this.onSelectServer(selection.server);
            }
            return undefined;
        });
    }
}
