import * as vscode from 'vscode';
import StatusBarController from './controllers/status-bar.controller';
import ServersController from './controllers/servers.controller';
import FtpClientController from './controllers/ftp.controller';
import ExplorerController from './controllers/explorer.controller';
import FilesController from './controllers/files.controller';
import DirectoriesController from './controllers/directories.controller';


export function activate(context: vscode.ExtensionContext) {

	// init status bar
	const statusBar = StatusBarController.getInstance();
	statusBar.showStatusBar();

	// init servers picker
	ServersController.getInstance(context);	

	// init ftp client
	FtpClientController.getInstance();

	// init files controller
	FilesController.getInstance(context);

	// init directory controller
	DirectoriesController.getInstance(context);


	// globals

	// open config file command
	const open_config_command = vscode.commands.registerCommand('remote-development.open-config', function () {
		// open in editor the file config/main.json
		let uri = vscode.Uri.file(context.extensionPath + '/config/main.json');
		vscode.workspace.openTextDocument(uri).then(doc => {
			vscode.window.showTextDocument(doc);
		});
	});
	context.subscriptions.push(open_config_command);


}

// This method is called when your extension is deactivated
export function deactivate() { }
