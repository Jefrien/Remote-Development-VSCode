import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export default class ConfigManager {

    private static instance: ConfigManager;

    private configPath: string;

    constructor(context: vscode.ExtensionContext) {

        // Comando para abrir config.json
    context.subscriptions.push(
        vscode.commands.registerCommand('remote-development.open-config', async () => {
            try {
                await this.openInEditor();
            } catch (error) {
                vscode.window.showErrorMessage('Error al abrir la configuración');
            }
        })
    );


        // Crear la ruta al archivo config.json
        this.configPath = path.join(context.globalStorageUri.fsPath, 'remote-development-jdevs', 'config.json');
    }

    public static getInstance(context: vscode.ExtensionContext): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager(context);
        }
        return ConfigManager.instance;
    }

    private getDefaultConfig(): object {
        return {
            servers: [
                {
                    name: "Server SFTP/SSH Example 1",
                    host: "127.0.0.1",
                    username: "user_sftp",
                    password: "password_sftp",
                    port: 22,
                    path: "/"
                },
                {
                    name: "Server FTP Example 2",
                    host: "localhost",
                    username: "user_ftp",
                    password: "password_ftp",
                    port: 21,
                    path: "/public_html/"
                }
            ]        
        };
    }

    /**
     * Asegura que el archivo config.json existe
     */
    private async ensureConfig(): Promise<void> {
        try {
            try {
                await fs.access(this.configPath);         
                
                // if file is empty, create a default config
                const data = await fs.readFile(this.configPath, 'utf8');
                if (data === '') {
                    await fs.writeFile(this.configPath, JSON.stringify(this.getDefaultConfig(), null, 2), 'utf8');
                }

            } catch {
                // Si el archivo no existe, crear el directorio y un config vacío
                await fs.mkdir(path.dirname(this.configPath), { recursive: true });
                await fs.writeFile(this.configPath, JSON.stringify(this.getDefaultConfig(), null, 2), 'utf8');
            }
        } catch (error) {
            console.error('Error al crear config:', error);
            throw error;
        }
    }

    /**
     * Abre el archivo config.json en el editor
     */
    async openInEditor(): Promise<void> {
        try {
            await this.ensureConfig();
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(this.configPath));
            await vscode.window.showTextDocument(document);
        } catch (error) {
            console.error('Error al abrir config:', error);
            throw error;
        }
    }

    /**
     * Guarda datos en config.json
     */
    async saveConfig(data: any): Promise<void> {
        try {
            await this.ensureConfig();
            await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error('Error al guardar config:', error);
            throw error;
        }
    }

    /**
     * Lee datos desde config.json
     */
    async loadConfig(): Promise<{
        servers: []
    }> {
        try {
            await this.ensureConfig();
            const data = await fs.readFile(this.configPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error al leer config:', error);
            throw error;
        }
    }
}
