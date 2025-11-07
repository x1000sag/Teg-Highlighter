import * as vscode from 'vscode';
import { TodoItem, TagConfig } from './scanner';

export class Decorator implements vscode.Disposable {
  private decos = new Map<string, vscode.TextEditorDecorationType>();
  private colors = new Map<string, string>();

  constructor(private ctx?: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    const tags = (cfg.get('tags') as TagConfig[]) ?? [];
    for (const t of tags) {
      if (t.color) this.colors.set(t.name.toUpperCase(), t.color);
    }
    this.reloadColors();
  }

  reloadColors() {
    this.colors.clear();
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    const tags = (cfg.get('tags') as TagConfig[]) ?? [];
    for (const t of tags) {
      if (t.color) this.colors.set(t.name.toUpperCase(), t.color);
    }
  }

  decorateEditor(ed: vscode.TextEditor, todos: TodoItem[]) {
    if (!ed) return;
    for (const d of this.decos.values()) ed.setDecorations(d, []);

    const byTag = new Map<string, vscode.Range[]>();
    for (const t of todos) {
      const arr = byTag.get(t.tag) ?? [];
      arr.push(t.range);
      byTag.set(t.tag, arr);
    }

    for (const [tag, ranges] of byTag.entries()) {
      const deco = this.getOrCreate(tag);
      ed.setDecorations(deco, ranges);
    }
  }

  private getOrCreate(tag: string): vscode.TextEditorDecorationType {
    if (this.decos.has(tag)) return this.decos.get(tag)!;
    const color = this.colors.get(tag.toUpperCase()) ?? '#ffd700';
    const deco = vscode.window.createTextEditorDecorationType({
      backgroundColor: color + '20', // 20 = прозрачность
      border: `1px solid ${color}`,
      borderRadius: '3px'
    });
    this.decos.set(tag, deco);
    return deco;
  }

  dispose() {
    for (const d of this.decos.values()) d.dispose();
    this.decos.clear();
  }
}
