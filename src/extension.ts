import * as vscode from 'vscode';
import StatusBarController from './controllers/status-bar.controller';
import ServersController from './controllers/servers.controller';
import FtpClientController from './controllers/ftp.controller';
import FilesController from './controllers/files.controller';
import DirectoriesController from './controllers/directories.controller';
import ConfigManager from './controllers/config-manager.controller';
export async function activate(context: vscode.ExtensionContext) {

	// config manager
	ConfigManager.getInstance(context);

	// status bar
	const statusBar = StatusBarController.getInstance();
	statusBar.showStatusBar();

	// servers picker
	ServersController.getInstance(context); 	

	// ftp client
	FtpClientController.getInstance().initContext(context);

	// files controller
	FilesController.getInstance(context);

	// directory controller
	DirectoriesController.getInstance(context);

}

// This method is called when your extension is deactivated
export function deactivate() { }
