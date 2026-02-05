import * as vscode from 'vscode';
import LocalizationManager from './localization.controller';

/**
 * Handles language selection and UI for localization.
 */
export default class LanguageController {
    private static instance: LanguageController;
    private context: vscode.ExtensionContext;

    private constructor(_context: vscode.ExtensionContext) {
        this.context = _context;
        this.registerCommands();
    }

    public static getInstance(_context: vscode.ExtensionContext): LanguageController {
        if (!LanguageController.instance) {
            LanguageController.instance = new LanguageController(_context);
        }
        return LanguageController.instance;
    }

    private registerCommands(): void {
        const changeLanguageCommand = vscode.commands.registerCommand(
            'remote-development.change-language',
            async () => {
                await this.showLanguageSelector();
            }
        );

        this.context.subscriptions.push(changeLanguageCommand);
    }

    /**
     * Shows a quick pick menu to select the language.
     */
    private async showLanguageSelector(): Promise<void> {
        const localizationManager = LocalizationManager.getInstance();
        const currentLanguage = localizationManager.getLanguage();

        const quickPickItems = [
            {
                label: 'English',
                description: 'English language',
                language: 'en' as const,
                picked: currentLanguage === 'en'
            },
            {
                label: 'Español',
                description: 'Idioma español',
                language: 'es' as const,
                picked: currentLanguage === 'es'
            },
            {
                label: '$(edit) Edit Custom Translations',
                description: 'Open custom translations file for manual editing',
                language: null as any
            }
        ];

        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: currentLanguage === 'en' 
                ? 'Select a language' 
                : 'Selecciona un idioma',
        });

        if (!selection) {
            return;
        }

        if (selection.language === null) {
            // Open custom translations editor
            await localizationManager.openCustomTranslationsEditor();
        } else if (selection.language !== currentLanguage) {
            await localizationManager.setLanguage(selection.language);
            const message = selection.language === 'en' 
                ? 'Language changed to English'
                : 'Idioma cambiado a Español';
            vscode.window.showInformationMessage(message);
        }
    }
}
