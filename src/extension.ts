import * as vscode from 'vscode';
import { Scanner } from './scanner';
import { Decorator } from './decorator';
import { TreeDataView } from './treeDataView';

// Точка входа
export async function activate(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('tagHighlighter');
  const tags = (cfg.get('tags') as any[] | undefined) ?? [{ name: 'TODO' }, { name: 'FIXME' }, { name: 'NOTE' }];
 
  const scanner = new Scanner(tags);
  const decorator = new Decorator(context);
  const tree = new TreeDataView(scanner);

  const view = vscode.window.createTreeView('tagsView', {
    treeDataProvider: tree
  });
  context.subscriptions.push(view, tree, decorator, scanner);

  // Регистрация комманд

  // Комманда открытия панели TreeView 
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.openTagsView', async () => {
    await vscode.commands.executeCommand('workbench.view.explorer');
    try {
      const roots = await tree.getChildren();
      if (roots && roots.length > 0) {
        view.reveal(roots[0], { focus: true, select: false }).then(
          () => {},
          () => {}
        );
      }
    } catch (err) {
      console.error('openTodosView error', err);
    }
  }));

  // Возвращает массив тегов из конфигурации плагина в workspace IDE.
  function getConfigTags(): any[] {
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    const tags = cfg.get<any[]>('tags');
    return Array.isArray(tags) ? tags : [];
  }

  // Принимает массив тегов и сохраняет их в конфигурацию плагина в workspace.
  async function saveConfigTags(tags: any[]) {
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    await cfg.update('tags', tags, vscode.ConfigurationTarget.Workspace);
  }

  // Принимает строку пользовательского ввода и преобразует её в корректную кодировку цвета RGB в шестнадцатеричной записи 
  function normalizeHexColor(input: string | undefined): string | undefined {
    if (!input) {
      return undefined;
    }
    const s = input.trim();
    const noHash = s.startsWith('#') ? s.slice(1) : s;
    if (/^[0-9a-fA-F]{6}$/.test(noHash)) {
      return '#' + noHash.toLowerCase();
    }
    return undefined;
  }

  // Комманда быcтрой вставки тега в текущий активный файл в редакторе
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.insertTag', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showInformationMessage('Нет активного редактора'); return; }

    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    const cfgTags = (cfg.get<any[]>('tags') ?? []).map(t => t.name?.toString()).filter(Boolean) as string[];
    const picks = cfgTags.length ? cfgTags : ['TODO', 'FIXME', 'NOTE'];

    const choice = await vscode.window.showQuickPick(
      [...picks, 'Ввести свой тег...'],
      { placeHolder: 'Выберите тег для вставки' }
    );
    let tagName: string | undefined;
    if (!choice) {
      return;
    }
    if (choice === 'Ввести свой тег...') {
      const input = await vscode.window.showInputBox({ prompt: 'Имя тега (пример: TODO)', validateInput: v => v && v.trim() ? null : 'Введите имя' });
      if (!input) {
        return;
      }
      tagName = input.trim();
    } else {
      tagName = choice;
    }

    const commentMap: Record<string, { line?: string; blockStart?: string; blockEnd?: string }> = {
      javascript: { line: '//' , blockStart: '/*', blockEnd: '*/' },
      typescript: { line: '//' , blockStart: '/*', blockEnd: '*/' },
      java: { line: '//' , blockStart: '/*', blockEnd: '*/' },
      cpp: { line: '//' , blockStart: '/*', blockEnd: '*/' },
      c: { line: '//' , blockStart: '/*', blockEnd: '*/' },
      python: { line: '#' },
      ruby: { line: '#' },
      sh: { line: '#' },
      bash: { line: '#' },
      zsh: { line: '#' },
      sql: { line: '--', blockStart: '/*', blockEnd: '*/' },
      html: { blockStart: '<!--', blockEnd: '-->' },
      xml: { blockStart: '<!--', blockEnd: '-->' },
    };

    const languageId = editor.document.languageId;
    const tokens = commentMap[languageId] ?? { line: '//' };

    await editor.edit(editBuilder => {
      for (const sel of editor.selections) {
        const insertPos = sel.isEmpty ? sel.start : new vscode.Position(sel.start.line, 0);

        if (tokens.line) {
          const text = `${tokens.line} ${tagName}: `;
          editBuilder.insert(insertPos, text);
        } else if (tokens.blockStart && tokens.blockEnd && sel.isEmpty) {
          const text = `${tokens.blockStart} ${tagName}:  ${tokens.blockEnd}`;
          editBuilder.insert(insertPos, text);
        } else {
          const text = `// ${tagName}: `;
          editBuilder.insert(insertPos, text);
        }
      }
    });

    try {
      for (const ed of vscode.window.visibleTextEditors) {
        await scanner.scanDocument(ed.document);
        decorator.reloadColors();
        decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
      }
      tree.refresh?.();
    } catch (e) {

    }
  }));

  // Комманда добавления пользовательского тега
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.addTag', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Имя тега (пример: TODO или ISSUE-XXX)',
      placeHolder: 'TODO',
      validateInput: v => v && v.trim().length > 0 ? null : 'Имя не может быть пустым'
    });
    if (!name) {
      return;
    }

    const colorInput = await vscode.window.showInputBox({
      prompt: 'Цвет в hex (опционально), например #ffcc00 — оставь пустым для цвета по умолчанию',
      placeHolder: '#ffcc00',
      validateInput: v => {
        if (!v) {
          return null;
        }
        return normalizeHexColor(v) ? null : 'Введите hex-цвет вида #RRGGBB или RRGGBB';
      }
    });

    const color = normalizeHexColor(colorInput);

    const tags = getConfigTags();
    const upper = name.trim().toUpperCase();
    if (tags.find(t => (t.name ?? '').toString().toUpperCase() === upper)) {
      vscode.window.showWarningMessage(`Тег "${name}" уже существует`);
      return;
    }

    const newTag = { name: name.trim(), color: color ?? undefined, pattern: name.trim() };
    tags.push(newTag);

    await saveConfigTags(tags);

    try {
      scanner.setTags(tags);
      decorator.reloadColors();
      for (const ed of vscode.window.visibleTextEditors) {
        await scanner.scanDocument(ed.document);
        decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
      }
      scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh());
      tree.refresh();
      vscode.window.showInformationMessage(`Тег "${name}" добавлен`);
    } catch (e) {
      vscode.window.showErrorMessage('Ошибка при добавлении тега');
    }
  }));

  // Комманда удаления тега
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.removeTag', async () => {
    const tags = getConfigTags();
    if (!tags.length) { vscode.window.showInformationMessage('Нет настроенных тегов'); return; }

    const pick = await vscode.window.showQuickPick(tags.map(t => t.name), { placeHolder: 'Выберите тег для удаления' });
    if (!pick) {
      return;
    }

    const ok = await vscode.window.showQuickPick(['Да, удалить', 'Отменить'], { placeHolder: `Удалить тег "${pick}"?` });
    if (ok !== 'Да, удалить') {
      return;
    }

    const newTags = tags.filter(t => (t.name ?? '').toString() !== pick);
    await saveConfigTags(newTags);

    scanner.setTags(newTags);
    scanner.clearCache(); 
    for (const ed of vscode.window.visibleTextEditors) {
      await scanner.scanDocument(ed.document);
      decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
    }
    scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh());
    tree.refresh();
    decorator.reloadColors();
    vscode.window.showInformationMessage(`Тег "${pick}" удалён`);
  }));

  // Комманда переключения курсора на слудующий тег в открытом файле
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.nextTag', () => navigateTag(1, scanner)));
  // Комманда переключения курсора на предыдущий тег в открытом файле
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.prevTag', () => navigateTag(-1, scanner)));
  // Комманда для открытия настроек горячих клавиш
  context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.openKeybindings', async () => {
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings'); 
  }));

  // Первичное сканирование открытых документов
  for (const ed of vscode.window.visibleTextEditors) {
    await scanner.scanDocument(ed.document);
    decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
  }
  tree.refresh();
  
  // Применение декоратора при смене текстогого документа
  let t: NodeJS.Timeout | undefined;
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(ev => {
    if (t) {
      clearTimeout(t);
    }
    t = setTimeout(async () => {
      await scanner.scanDocument(ev.document);
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === ev.document.uri.toString());
      if (ed) {
        decorator.decorateEditor(ed, scanner.getTodosForUri(ev.document.uri));
      }
      tree.refresh();
    }, 250);
  }));
  
  // Применение декоратора при открытие текстогого документа 
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async doc => {
    await scanner.scanDocument(doc);
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    if (ed) {
      decorator.decorateEditor(ed, scanner.getTodosForUri(doc.uri));
    }
    tree.refresh();
  }));

  // Применение декоратора при изменения файла
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
    for (const ed of editors) {
      decorator.decorateEditor(ed, scanner.getTodosForUri(ed.document.uri));
    }
  }));


  scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh()).catch(() => {});
}

// Находит ближайший тег (выше или ниже в зависимости от аргумента. 1 и -1 соответственно) в открытом файле относительно курсора
// Перемещает курсор на найденный тег
// Принимает направление поиска и класс `Scanner`
function navigateTag(dir: 1 | -1, scanner: Scanner) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) { vscode.window.showInformationMessage('Нет активного редактора'); return; }

  const tags = scanner.getTodosForUri(ed.document.uri);
  if (!tags || tags.length === 0) { vscode.window.showInformationMessage('Тэги не найдены в этом файле'); return; }

  tags.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);

  const pos = ed.selection.active;

  const insideIndex = tags.findIndex(t => t.range.contains(pos));

  let targetIndex = -1;

  if (insideIndex !== -1) {
    targetIndex = dir === 1 ? insideIndex + 1 : insideIndex - 1;
  } else {
    if (dir === 1) {
      targetIndex = tags.findIndex(t => t.range.start.isAfter(pos));
    } else {
      for (let i = tags.length - 1; i >= 0; i--) {
        if (tags[i].range.start.isBefore(pos)) { targetIndex = i; break; }
      }
    }
  }

  if (targetIndex < 0) {
    targetIndex = tags.length - 1;
  }
  if (targetIndex >= tags.length) {
    targetIndex = 0;
  }

  const target = tags[targetIndex];
  if (!target) {
    return;
  }

  ed.revealRange(target.range, vscode.TextEditorRevealType.InCenter);
  ed.selection = new vscode.Selection(target.range.start, target.range.end);
}

