import * as vscode from 'vscode';
import StatusBarController from './controllers/status-bar.controller';
import ServersController from './controllers/servers.controller';
import FtpClientController from './controllers/ftp.controller';
import FilesController from './controllers/files.controller';
import DirectoriesController from './controllers/directories.controller';
import ConfigManager from './controllers/config-manager.controller';
import LocalizationManager from './controllers/localization.controller';
import LanguageController from './controllers/language.controller';


export async function activate(context: vscode.ExtensionContext) {

	// init localization manager (must be first)
	await LocalizationManager.getInstance().init(context);

	// init config manager
	ConfigManager.getInstance(context);

	// init status bar
	const statusBar = StatusBarController.getInstance();
	statusBar.showStatusBar();

	// init language controller
	LanguageController.getInstance(context);

	// init servers picker
	ServersController.getInstance(context);	

	// init ftp client
	FtpClientController.getInstance().initContext(context);

	// init files controller
	FilesController.getInstance(context);

	// init directory controller
	DirectoriesController.getInstance(context);


}

// This method is called when your extension is deactivated
export function deactivate() { }
