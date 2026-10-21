import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
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
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: LocalizationManager.getInstance().t('Loading Servers'),
                        cancellable: true,
                    },
                    async (_progress, token) => {
                        const cancellationSubscription = token.onCancellationRequested(() => {
                            vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Server loading cancelled'));
                        });
                        try {
                            await this.loadServers();
                            if (!token.isCancellationRequested) {
                                await this.showServersSelector();
                            }
                        } finally {
                            cancellationSubscription.dispose();
                        }
                    }
                );
            }
        );
        const connectCommand = vscode.commands.registerCommand(
            'remote-development.connect-server',
            async (serverId: string) => {
                await this.loadServers();
                const server = this.config.servers.find(item => item.id === serverId);
                if (!server) {
                    throw new Error('The selected server no longer exists. Reload the connections and try again.');
                }
                return this.onSelectServer(server);
            }
        );
        const disconnectCommand = vscode.commands.registerCommand(
            'remote-development.disconnect-server',
            async () => FtpClientController.getInstance().disconnect()
        );
        const stateCommand = vscode.commands.registerCommand(
            'remote-development.connection-state',
            () => FtpClientController.getInstance().getConnectionState()
        );
        this.context.subscriptions.push(command, connectCommand, disconnectCommand, stateCommand);
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
            vscode.window.showErrorMessage(
                LocalizationManager.getInstance().t('Error loading server configuration: {0}. Check the console for details.', error.message)
            );
            throw error; // Re-throw to allow further handling if needed
        }
    }

    /**
     * Handles the selection of a server and initiates the connection.
     * @param server The selected server configuration
     */
    private async onSelectServer(server: ServerItem): Promise<boolean> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: LocalizationManager.getInstance().t('Connecting to {0}', server.name),
                cancellable: true,
            },
            async (progress, token) => {
                const cancellationSubscription = token.onCancellationRequested(() => {
                    vscode.window.showInformationMessage(LocalizationManager.getInstance().t('Connection cancelled'));
                });

                try {
                    const ftpClient = FtpClientController.getInstance();

                    // verify if server have id, if not generate a random one
                    if (!server.id) {
                        server.id = randomUUID();
                    }

                    await ftpClient.connect(server, token);

                    if (ftpClient.error) {
                        vscode.window.showErrorMessage(ftpClient.error);
                        return false;
                    }

                    ftpClient.setPath(server.path || '/');
                    ExplorerController.getInstance(this.context).initServer();
                    return true;
                } catch (error: any) {
                    if (token.isCancellationRequested) {
                        return false;
                    }
                    vscode.window.showErrorMessage(
                        LocalizationManager.getInstance().t('Error connecting to server: {0}', error.message)
                    );
                    return false;
                } finally {
                    cancellationSubscription.dispose();
                }
            }
        );
    }

    /**
     * Shows a quick pick menu to select a server from the loaded configuration.
     */
    public showServersSelector(): Thenable<boolean | undefined> {
        
        const quickPickItems = this.config.servers.map((server) => ({
            label: server.name,
            description: `${server.host}:${server.port}`,
            detail: `User: ${server.username}`,
            server: server,
        }));

        return vscode.window.showQuickPick(quickPickItems, {
            placeHolder: LocalizationManager.getInstance().t('Select a server'),
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
