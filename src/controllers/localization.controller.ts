import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

interface LocalizationConfig {
    language: 'en' | 'es';
    customTranslations?: Record<string, any>;
}

interface Translations {
    [key: string]: any;
}

/**
 * Manages localization and translations for the Remote Development extension.
 * Supports English and Spanish by default, with custom translation support.
 */
export default class LocalizationManager {
    private static instance: LocalizationManager;
    private currentLanguage: 'en' | 'es' = 'en';
    private translations: Translations = {};
    private customTranslations: Translations = {};
    private configPath: string = '';
    private context: vscode.ExtensionContext = {} as vscode.ExtensionContext;

    private constructor() {}

    /**
     * Gets the singleton instance of LocalizationManager.
     */
    public static getInstance(): LocalizationManager {
        if (!LocalizationManager.instance) {
            LocalizationManager.instance = new LocalizationManager();
        }
        return LocalizationManager.instance;
    }

    /**
     * Initializes the LocalizationManager with the extension context.
     * Loads the saved language preference and translations.
     */
    public async init(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        this.configPath = path.join(
            context.globalStorageUri.fsPath,
            'remote-development-jdevs',
            'localization.json'
        );

        // Load the saved language preference
        const config = await this.loadLocalizationConfig();
        this.currentLanguage = config.language;
        this.customTranslations = config.customTranslations || {};

        // Load the default language translations
        await this.loadLanguage(this.currentLanguage);
    }

    /**
     * Loads translation files for the specified language.
     */
    private async loadLanguage(language: 'en' | 'es'): Promise<void> {
        try {
            const localesPath = path.join(this.context.extensionPath, 'resources', 'locales', `${language}.json`);
            const data = await fs.readFile(localesPath, 'utf8');
            this.translations = JSON.parse(data);
        } catch (error) {
            // Fallback to English if language file not found
            console.error(`Error loading language file for ${language}:`, error);
            if (language !== 'en') {
                await this.loadLanguage('en');
            }
        }
    }

    /**
     * Changes the current language and saves the preference.
     */
    public async setLanguage(language: 'en' | 'es'): Promise<void> {
        this.currentLanguage = language;
        await this.loadLanguage(language);
        await this.saveLocalizationConfig();
    }

    /**
     * Gets the current language code.
     */
    public getLanguage(): 'en' | 'es' {
        return this.currentLanguage;
    }

    /**
     * Gets a translation string by key path (supports nested keys like 'messages.fileCreated').
     * Supports variable substitution using {0}, {1}, etc.
     * Falls back to custom translations if not found in default translations.
     */
    public t(keyPath: string, ...args: string[]): string {
        const keys = keyPath.split('.');
        let value: any = this.translations;

        // Try to get from default translations
        for (const key of keys) {
            value = value?.[key];
            if (value === undefined) {
                break;
            }
        }

        // Fall back to custom translations
        if (value === undefined) {
            value = this.customTranslations;
            for (const key of keys) {
                value = value?.[key];
                if (value === undefined) {
                    break;
                }
            }
        }

        // If still not found, return the key path as fallback
        if (value === undefined) {
            return keyPath;
        }

        // Substitute variables
        let result = String(value);
        args.forEach((arg, index) => {
            result = result.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
        });

        return result;
    }

    /**
     * Gets all available translations (for creating custom translation templates).
     */
    public getTranslations(): Translations {
        return { ...this.translations };
    }

    /**
     * Adds or updates custom translations.
     * Custom translations override default translations.
     */
    public async addCustomTranslations(customTranslations: Translations): Promise<void> {
        this.customTranslations = { ...this.customTranslations, ...customTranslations };
        await this.saveLocalizationConfig();
    }

    /**
     * Gets the custom translations file path for manual editing.
     */
    public getCustomTranslationsPath(): string {
        return this.configPath;
    }

    /**
     * Loads the localization configuration file.
     */
    private async loadLocalizationConfig(): Promise<LocalizationConfig> {
        try {
            await fs.access(this.configPath);
            const data = await fs.readFile(this.configPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // Return default config if file doesn't exist
            return {
                language: 'en',
                customTranslations: {}
            };
        }
    }

    /**
     * Saves the localization configuration file.
     */
    private async saveLocalizationConfig(): Promise<void> {
        try {
            const dir = path.dirname(this.configPath);
            await fs.mkdir(dir, { recursive: true });

            const config: LocalizationConfig = {
                language: this.currentLanguage,
                customTranslations: this.customTranslations
            };

            await fs.writeFile(
                this.configPath,
                JSON.stringify(config, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('Error saving localization config:', error);
        }
    }

    /**
     * Opens the custom translations file in the editor for manual editing.
     */
    public async openCustomTranslationsEditor(): Promise<void> {
        try {
            const dir = path.dirname(this.configPath);
            await fs.mkdir(dir, { recursive: true });

            // Create a template if file doesn't exist
            const customTranslationPath = path.join(dir, 'custom-translations.json');
            try {
                await fs.access(customTranslationPath);
            } catch {
                const template = {
                    _comment: "Add custom translations here. Format: 'key.path': 'Your translation'",
                    example: {
                        customMessage: "Your custom translation here"
                    }
                };
                await fs.writeFile(
                    customTranslationPath,
                    JSON.stringify(template, null, 2),
                    'utf8'
                );
            }

            const document = await vscode.workspace.openTextDocument(customTranslationPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Error opening custom translations file: ${error}`);
        }
    }
}
