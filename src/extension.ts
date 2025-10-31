// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { Decorator } from './decorator';
import { TreeDataView } from './treeDataView';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('tag-highlighter');
  const tags = config.get('tags') as any[] | undefined;
  const scanner = new Scanner(tags ?? [{name: 'TODO'}, {name: 'FIXME'}, {name: 'NOTE'}]);

  for (const editor of vscode.window.visibleTextEditors) {
    await scanner.ScanDocument(editor.document);
  }

  let timeout: NodeJS.Timeout | undefined;
  vscode.workspace.onDidChangeTextDocument(ev => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(async () => {
      await scanner.ScanDocument(ev.document);
      // refresh
    }, 300);
  });

  scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() =>  {
    // refresh
  });

	const decorator = new Decorator();
  const treeDataView = new TreeDataView();

  context.subscriptions.push(vscode.window.createTreeView('tagView', {treeDataProvider: treeDataView}));

  context.subscriptions.push(vscode.commands.registerCommand('tag-highlighter.addTag', async () => {
    const name = await vscode.window.showInputBox({prompt: 'Tag name'});

  }));


}

// This method is called when your extension is deactivated
export function deactivate() {}
