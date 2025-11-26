import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ServerItem } from '../types';

interface Config {
    servers: ServerItem[];
}

/**
 * Manages the configuration file for the Remote Development extension.
 */
export default class ConfigManager {
    private static instance: ConfigManager;
    private configPath: string;

    /**
     * Initializes the ConfigManager with the extension context.
     * Registers the command to open the config file in the editor.
     * @param context The extension context
     */
    constructor(context: vscode.ExtensionContext) {
        this.configPath = path.join(
            context.globalStorageUri.fsPath,
            'remote-development-jdevs',
            'config.json'
        );

        // Register command to open the config file
        context.subscriptions.push(
            vscode.commands.registerCommand('remote-development.open-config', async () => {
                try {
                    await this.openInEditor();
                } catch (error) {
                    vscode.window.showErrorMessage('Error opening configuration file');
                    console.error('Error opening config:', error);
                }
            })
        );
    }

    /**
     * Gets the singleton instance of ConfigManager.
     * @param context The extension context
     * @returns The singleton instance
     */
    public static getInstance(context: vscode.ExtensionContext): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager(context);
        }
        return ConfigManager.instance;
    }

    /**
     * Returns the default configuration.
     * @returns Default configuration object
     */
    private getDefaultConfig(): Config {
        return {
            servers: [
                {
                    name: "SFTP/SSH Example Server 1",
                    host: "127.0.0.1",
                    username: "user_sftp",
                    password: "password_sftp",
                    port: 22,
                    path: "/",
                    type: 'sftp'
                },
                {
                    name: "FTP Example Server 2",
                    host: "localhost",
                    username: "user_ftp",
                    password: "password_ftp",
                    port: 21,
                    path: "/public_html/",
                    type: 'ftp'
                }
            ]
        };
    }

    /**
     * Ensures the config file exists and is valid.
     * Creates the file with default config if it doesn't exist or is empty.
     */
    private async ensureConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
            // Check if file is empty
            const data = await fs.readFile(this.configPath, 'utf8');
            if (data.trim() === '') {
                await fs.writeFile(
                    this.configPath,
                    JSON.stringify(this.getDefaultConfig(), null, 2),
                    'utf8'
                );
            }
        } catch (error) {
            // If file doesn't exist, create directory and file with default config
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            await fs.writeFile(
                this.configPath,
                JSON.stringify(this.getDefaultConfig(), null, 2),
                'utf8'
            );
        }
    }

    /**
     * Opens the config file in the editor.
     */
    async openInEditor(): Promise<void> {
        try {
            await this.ensureConfig();
            const document = await vscode.workspace.openTextDocument(
                vscode.Uri.file(this.configPath)
            );
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error('Error opening config:', error);
            throw new Error('Failed to open configuration file');
        }
    }

    /**
     * Saves data to the config file.
     * @param data The configuration data to save
     */
    async saveConfig(data: Config): Promise<void> {
        try {
            await this.ensureConfig();
            await fs.writeFile(
                this.configPath,
                JSON.stringify(data, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving config:', error);
            throw new Error('Failed to save configuration');
        }
    }

    /**
     * Loads the configuration from the config file.
     * @returns The loaded configuration
     */
    async loadConfig(): Promise<Config> {
        try {
            await this.ensureConfig();
            const data = await fs.readFile(this.configPath, 'utf8');
            return JSON.parse(data) as Config;
        } catch (error) {
            console.error('Error loading config:', error);
            throw new Error('Failed to load configuration');
        }
    }
}
