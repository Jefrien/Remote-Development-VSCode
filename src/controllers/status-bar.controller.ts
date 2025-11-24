import * as vscode from 'vscode';

/**
 * Controls the status bar item for the Remote Development extension.
 * Provides methods to update, show, and hide the status bar text.
 */
export default class StatusBarController {
    private static instance: StatusBarController;
    private statusBarInfo: vscode.StatusBarItem;

    private constructor() {
        // Initialize the status bar item aligned to the right
        this.statusBarInfo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarInfo.text = 'RD: Disconnected';
    }

    /**
     * Gets the singleton instance of StatusBarController.
     * @returns The singleton instance
     */
    public static getInstance(): StatusBarController {
        if (!StatusBarController.instance) {
            StatusBarController.instance = new StatusBarController();
        }
        return StatusBarController.instance;
    }

    /**
     * Shows the status bar item.
     */
    public showStatusBar(): void {
        this.statusBarInfo.show();
    }

    /**
     * Hides the status bar item.
     */
    public hideStatusBar(): void {
        this.statusBarInfo.hide();
    }

    /**
     * Updates the status bar text and optionally shows a loading spinner.
     * @param text The text to display in the status bar
     * @param loading If true, appends a loading spinner to the text
     */
    public updateStatusBarText(text: string, loading: boolean = false): void {
        this.statusBarInfo.text = `${text}${loading ? ' $(sync~spin)' : ''}`;
    }
}
