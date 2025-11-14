import * as vscode from 'vscode';
import { Scanner, TodoItem } from './scanner';

// Модуль отвечающий за работу TreeView тегов

export class TreeDataView implements vscode.TreeDataProvider<TodoNode>, vscode.Disposable {
  private _onDidChange = new vscode.EventEmitter<TodoNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private scanner: Scanner) {}

  // Удаление окна TreeView
  dispose() {
    this._onDidChange.dispose(); 
  }

  // Обнавляет окно TreeView
  refresh() {
    this._onDidChange.fire();
  }

  // Принимает аргумент класса `TodoNode` и возвращает `TreeItem`
  getTreeItem(el: TodoNode): vscode.TreeItem {
    return el; 
  }

  // Принимает класс `TodoNode` и возвращает его массив его потомков
  async getChildren(el?: TodoNode): Promise<TodoNode[]> {
    if (!el) {
      const all = this.scanner.getAllCached();
      const byFile = new Map<string, TodoItem[]>();
      for (const t of all) {
        const key = t.uri.fsPath;
        const a = byFile.get(key) ?? [];
        a.push(t);
        byFile.set(key, a);
      }

      const nodes: TodoNode[] = [];
      for (const [file, todos] of byFile.entries()) {
        const label = vscode.workspace.asRelativePath(file);
        const node = new TodoNode(label, vscode.TreeItemCollapsibleState.Collapsed);
        node.meta = { file, todos };
        node.description = `(${todos.length})`;
        node.iconPath = new vscode.ThemeIcon('file');
        nodes.push(node);
      }
      nodes.sort((a, b) => (a.label as string).localeCompare(b.label as string));
      return nodes;
    }

    const meta = el.meta;
    if (!meta || !meta.todos) {
      return [];
    }
    return meta.todos.map((t: TodoItem) => {
      const preview = t.tagText || t.lineText.trim();
      const short = preview.length > 80 ? preview.slice(0, 80) + '…' : preview;
      const node = new TodoNode(`${t.tag}: ${short}`, vscode.TreeItemCollapsibleState.None);
      node.command = { command: 'vscode.open', title: 'Open TODO', arguments: [t.uri, { selection: t.range }] };
      node.tooltip = `${t.uri.fsPath}:${t.line + 1}\n${t.lineText.trim()}`;
      node.description = `:${t.line + 1}`;
      node.iconPath = new vscode.ThemeIcon('comment');
      return node;
    });
  }
}

export class TodoNode extends vscode.TreeItem {
  meta?: any;
  constructor(label: string | vscode.TreeItemLabel, state: vscode.TreeItemCollapsibleState) {
    super(label, state);
  }
}
