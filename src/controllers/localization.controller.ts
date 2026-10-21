import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export type SupportedLanguage = 'en' | 'es';
type TranslationTable = Record<string, string>;

/** Provides an extension-local language that can differ from VS Code's locale. */
export default class LocalizationManager {
    private static instance: LocalizationManager;
    private context?: vscode.ExtensionContext;
    private language: SupportedLanguage = 'en';
    private translations: TranslationTable = {};
    private english: TranslationTable = {};

    private constructor() { }

    public static getInstance(context?: vscode.ExtensionContext): LocalizationManager {
        if (!LocalizationManager.instance) {
            LocalizationManager.instance = new LocalizationManager();
        }
        if (context) {
            LocalizationManager.instance.context = context;
        }
        return LocalizationManager.instance;
    }

    public async init(context: vscode.ExtensionContext): Promise<void> {
        this.context = context;
        const saved = context.globalState.get<SupportedLanguage>('remote-development.language');
        this.language = saved === 'en' || saved === 'es'
            ? saved
            : (vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en');
        await this.loadTranslations();
        context.subscriptions.push(vscode.commands.registerCommand(
            'remote-development.change-language',
            () => this.changeLanguage()
        ));
    }

    public getLanguage(): SupportedLanguage {
        return this.language;
    }

    public t(key: string, ...args: unknown[]): string {
        const source = this.translations[key] ?? this.english[key] ?? key;
        return source.replace(/\{(\d+)\}/g, (match, index: string) =>
            index in args ? String(args[Number(index)]) : match
        );
    }

    public async setLanguage(language: SupportedLanguage): Promise<void> {
        this.language = language;
        await this.context?.globalState.update('remote-development.language', language);
        await this.loadTranslations();
    }

    private async loadTranslations(): Promise<void> {
        if (!this.context) {
            return;
        }
        const read = async (language: SupportedLanguage) => JSON.parse(await fs.readFile(
            path.join(this.context!.extensionPath, 'l10n', `bundle.l10n${language === 'en' ? '' : `.${language}`}.json`),
            'utf8'
        )) as TranslationTable;
        this.english = await read('en');
        this.translations = this.language === 'en' ? this.english : await read(this.language);
    }

    private async changeLanguage(): Promise<void> {
        const selected = await vscode.window.showQuickPick([
            { label: 'English', description: this.language === 'en' ? 'Current language' : undefined, language: 'en' as const },
            { label: 'Español', description: this.language === 'es' ? 'Idioma actual' : undefined, language: 'es' as const },
        ], { placeHolder: this.t('Select extension language') });
        if (!selected || selected.language === this.language) {
            return;
        }

        await this.setLanguage(selected.language);
        vscode.window.showInformationMessage(this.t('Language changed to {0}', selected.label));
        vscode.window.showInformationMessage(this.t('Reload the window to apply the new language everywhere.'));
    }
}
