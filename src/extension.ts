import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { Decorator } from './decorator';
import { TreeDataView } from './treeDataView';
import { log } from 'console';

// Простая точка входа — минимальная логика, всё делегируется модулям.
export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('tagHighlighter');
  const tags = (cfg.get('tags') as any[] | undefined) ?? [{ name: 'TODO' }, { name: 'FIXME' }, { name: 'NOTE' }];
 
  const scanner = new Scanner(tags);
  const decorator = new Decorator(ctx);
  const tree = new TreeDataView(scanner);

  const view = vscode.window.createTreeView('tagsView', { treeDataProvider: tree });
  ctx.subscriptions.push(view, tree, decorator, scanner);

  // команды

  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.openTagsView', async () => {
    // сначала открываем explorer чтобы вью отобразился
    await vscode.commands.executeCommand('workbench.view.explorer');

    // получаем корневые узлы и, если есть, reveal первого
    try {
      const roots = await tree.getChildren(); // TreeDataView.getChildren()
      if (roots && roots.length > 0) {
        // reveal возвращает Thenable<void> — используем then(onFulfilled, onRejected)
        view.reveal(roots[0], { focus: true, select: false }).then(
          () => { /* ok */ },
          () => { /* ignore reveal errors */ }
        );
      }
    } catch (err) {
      // safe fallback: ничего не делаем, можно логировать при необходимости
      // console.error('openTodosView error', err);
    }
  }));

  // В extension.ts, внутри activate(ctx) — после создания scanner, decorator, tree:

  // --- helper: получить теги из настроек (возвращает TagConfig[])
  function getConfigTags(): any[] {
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    const tags = cfg.get<any[]>('tags');
    return Array.isArray(tags) ? tags : [];
  }

  // --- helper: сохранить теги (workspace scope)
  async function saveConfigTags(tags: any[]) {
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    // true -> save in workspace settings; сменить на ConfigurationTarget.Global для user settings
    await cfg.update('tags', tags, vscode.ConfigurationTarget.Workspace);
  }

  // --- validate hex color like #RRGGBB or RRGGBB
  function normalizeHexColor(input: string | undefined): string | undefined {
    if (!input) return undefined;
    const s = input.trim();
    const noHash = s.startsWith('#') ? s.slice(1) : s;
    if (/^[0-9a-fA-F]{6}$/.test(noHash)) return '#' + noHash.toLowerCase();
    return undefined;
  }

  // Команда: добавить тег (имя и опционально цвет)
  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.addTag', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Имя тега (пример: TODO или ISSUE-XXX)',
      placeHolder: 'TODO',
      validateInput: v => v && v.trim().length > 0 ? null : 'Имя не может быть пустым'
    });
    if (!name) return; // отмена

    const colorInput = await vscode.window.showInputBox({
      prompt: 'Цвет в hex (опционально), например #ffcc00 — оставь пустым для цвета по умолчанию',
      placeHolder: '#ffcc00',
      validateInput: v => {
        if (!v) return null;
        return normalizeHexColor(v) ? null : 'Введите hex-цвет вида #RRGGBB или RRGGBB';
      }
    });

    const color = normalizeHexColor(colorInput);

    // read, add, dedupe
    const tags = getConfigTags();
    const upper = name.trim().toUpperCase();
    if (tags.find(t => (t.name ?? '').toString().toUpperCase() === upper)) {
      vscode.window.showWarningMessage(`Тег "${name}" уже существует`);
      return;
    }

    const newTag = { name: name.trim(), color: color ?? undefined, pattern: name.trim() };
    tags.push(newTag);

    await saveConfigTags(tags);

    // применить изменения: обновить scanner, пересканировать открытые документы и обновить UI
    try {
      scanner.setTags(tags);
      decorator.reloadColors();
      // пересканируем видимые редакторы (быстро)
      for (const ed of vscode.window.visibleTextEditors) {
        await scanner.scanDocument(ed.document);
        decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
      }
      // можно пересканировать workspace фоном
      scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh());
      tree.refresh();
      vscode.window.showInformationMessage(`Тег "${name}" добавлен`);
    } catch (e) {
      vscode.window.showErrorMessage('Ошибка при добавлении тега');
    }
  }));

  // Команда: удалить тег (через quickPick)
  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.removeTag', async () => {
    const tags = getConfigTags();
    if (!tags.length) { vscode.window.showInformationMessage('Нет настроенных тегов'); return; }

    const pick = await vscode.window.showQuickPick(tags.map(t => t.name), { placeHolder: 'Выберите тег для удаления' });
    if (!pick) return;

    const ok = await vscode.window.showQuickPick(['Да, удалить', 'Отменить'], { placeHolder: `Удалить тег "${pick}"?` });
    if (ok !== 'Да, удалить') return;

    const newTags = tags.filter(t => (t.name ?? '').toString() !== pick);
    await saveConfigTags(newTags);

    // обновляем сканер/декоратор/вью
    scanner.setTags(newTags);
    scanner.clearCache(); // убрать старые TODO для старых тегов
    for (const ed of vscode.window.visibleTextEditors) {
      await scanner.scanDocument(ed.document);
      decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
    }
    scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh());
    tree.refresh();
    decorator.reloadColors();
    vscode.window.showInformationMessage(`Тег "${pick}" удалён`);
  }));

  

  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.generateReport', async () => {
    const all = scanner.getAllCached().map(t => ({ file: t.uri.fsPath, line: t.line + 1, tag: t.tag, text: t.tagText }));
    const uri = await vscode.window.showSaveDialog({ filters: { 'JSON': ['json'] }, saveLabel: 'Save TODO report' });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(all, null, 2), 'utf8'));
    vscode.window.showInformationMessage(`Report saved: ${uri.fsPath}`);
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.nextTag', () => navigateTodo(1, scanner)));
  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.prevTag', () => navigateTodo(-1, scanner)));
  ctx.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.openKeybindings', async () => {
  // откроет панель Keyboard Shortcuts UI
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings'); 
  }));


  // initial scan for visible editors
  for (const ed of vscode.window.visibleTextEditors) {
    await scanner.scanDocument(ed.document);
    decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
  }
  tree.refresh();
  

  // debounce handler for document changes
  let t: NodeJS.Timeout | undefined;
  ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(ev => {
    if (t) clearTimeout(t);
    t = setTimeout(async () => {
      await scanner.scanDocument(ev.document);
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === ev.document.uri.toString());
      if (ed) decorator.decorateEditor(ed, scanner.getTodosForUri(ev.document.uri));
      tree.refresh();
    }, 250);
  }));
  

  // when opening documents
  ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async doc => {
    await scanner.scanDocument(doc);
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    if (ed) decorator.decorateEditor(ed, scanner.getTodosForUri(doc.uri));
    tree.refresh();
  }));

  // when visible editors change, re-decorate them
  ctx.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
    for (const ed of editors) decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
  }));

  // background workspace scan (non-blocking)
  scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh()).catch(() => {});
}

export function deactivate() {
  // Disposables cleaned up by VS Code automatically if pushed to context.subscriptions
}

/** Навигация по TODO в активном редакторе: dir = 1 (next), -1 (prev) */
function navigateTodo(dir: 1 | -1, scanner: Scanner) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) { vscode.window.showInformationMessage('Нет активного редактора'); return; }

  const todos = scanner.getTodosForUri(ed.document.uri);
  if (!todos.length) { vscode.window.showInformationMessage('TODO не найдены в этом файле'); return; }

  const pos = ed.selection.active;
  let idx = dir === 1
    ? todos.findIndex(t => t.range.start.isAfter(pos))
    : (() => {
      for (let i = todos.length - 1; i >= 0; i--) if (todos[i].range.start.isBefore(pos)) return i;
      return -1;
    })();

  if (idx === -1) idx = dir === 1 ? 0 : todos.length - 1;
  const t = todos[idx];
  ed.revealRange(t.range, vscode.TextEditorRevealType.InCenter);
  ed.selection = new vscode.Selection(t.range.start, t.range.end);
}
