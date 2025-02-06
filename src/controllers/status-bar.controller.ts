import { EventEmitter } from 'stream';
import * as vscode from 'vscode';

export default class StatusBarController {

    private static instance: StatusBarController;

    private statusBarInfo: vscode.StatusBarItem;

    private constructor() {
        this.statusBarInfo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBarInfo.text = 'RD: Desconectado';                
    }

    public static getInstance(): StatusBarController {
        if (!StatusBarController.instance) {
            StatusBarController.instance = new StatusBarController();
        }
        return StatusBarController.instance;
    }

    public showStatusBar() {
        this.statusBarInfo.show();
    }

    public hideStatusBar() {
        this.statusBarInfo.hide();
    }

    public updateStatusBarText(text: string, loading: boolean) {
        this.statusBarInfo.text = text + (loading ? ' $(sync~spin)' : '');
    }
}