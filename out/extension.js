"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const scanner_1 = require("./scanner");
const decorator_1 = require("./decorator");
const treeDataView_1 = require("./treeDataView");
// Точка входа
async function activate(context) {
    const cfg = vscode.workspace.getConfiguration('tagHighlighter');
    const tags = cfg.get('tags') ?? [{ name: 'TODO' }, { name: 'FIXME' }, { name: 'NOTE' }];
    const scanner = new scanner_1.Scanner(tags);
    const decorator = new decorator_1.Decorator(context);
    const tree = new treeDataView_1.TreeDataView(scanner);
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
                view.reveal(roots[0], { focus: true, select: false }).then(() => { }, () => { });
            }
        }
        catch (err) {
            console.error('openTodosView error', err);
        }
    }));
    // Возвращает массив тегов из конфигурации плагина в workspace IDE.
    function getConfigTags() {
        const cfg = vscode.workspace.getConfiguration('tagHighlighter');
        const tags = cfg.get('tags');
        return Array.isArray(tags) ? tags : [];
    }
    // Принимает массив тегов и сохраняет их в конфигурацию плагина в workspace.
    async function saveConfigTags(tags) {
        const cfg = vscode.workspace.getConfiguration('tagHighlighter');
        await cfg.update('tags', tags, vscode.ConfigurationTarget.Workspace);
    }
    // Принимает строку пользовательского ввода и преобразует её в корректную кодировку цвета RGB в шестнадцатеричной записи 
    function normalizeHexColor(input) {
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
        if (!editor) {
            vscode.window.showInformationMessage('Нет активного редактора');
            return;
        }
        const cfg = vscode.workspace.getConfiguration('tagHighlighter');
        const cfgTags = (cfg.get('tags') ?? []).map(t => t.name?.toString()).filter(Boolean);
        const picks = cfgTags.length ? cfgTags : ['TODO', 'FIXME', 'NOTE'];
        const choice = await vscode.window.showQuickPick([...picks, 'Ввести свой тег...'], { placeHolder: 'Выберите тег для вставки' });
        let tagName;
        if (!choice) {
            return;
        }
        if (choice === 'Ввести свой тег...') {
            const input = await vscode.window.showInputBox({ prompt: 'Имя тега (пример: TODO)', validateInput: v => v && v.trim() ? null : 'Введите имя' });
            if (!input) {
                return;
            }
            tagName = input.trim();
        }
        else {
            tagName = choice;
        }
        const commentMap = {
            javascript: { line: '//', blockStart: '/*', blockEnd: '*/' },
            typescript: { line: '//', blockStart: '/*', blockEnd: '*/' },
            java: { line: '//', blockStart: '/*', blockEnd: '*/' },
            cpp: { line: '//', blockStart: '/*', blockEnd: '*/' },
            c: { line: '//', blockStart: '/*', blockEnd: '*/' },
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
                }
                else if (tokens.blockStart && tokens.blockEnd && sel.isEmpty) {
                    const text = `${tokens.blockStart} ${tagName}:  ${tokens.blockEnd}`;
                    editBuilder.insert(insertPos, text);
                }
                else {
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
        }
        catch (e) {
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
        }
        catch (e) {
            vscode.window.showErrorMessage('Ошибка при добавлении тега');
        }
    }));
    // Комманда удаления тега
    context.subscriptions.push(vscode.commands.registerCommand('tagHighlighter.removeTag', async () => {
        const tags = getConfigTags();
        if (!tags.length) {
            vscode.window.showInformationMessage('Нет настроенных тегов');
            return;
        }
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
    let t;
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
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (doc) => {
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
    scanner.scanWorkspace('**/*.*', '**/node_modules/**').then(() => tree.refresh()).catch(() => { });
}
// Находит ближайший тег (выше или ниже в зависимости от аргумента. 1 и -1 соответственно) в открытом файле относительно курсора
// Перемещает курсор на найденный тег
// Принимает направление поиска и класс `Scanner`
function navigateTag(dir, scanner) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) {
        vscode.window.showInformationMessage('Нет активного редактора');
        return;
    }
    const tags = scanner.getTodosForUri(ed.document.uri);
    if (!tags || tags.length === 0) {
        vscode.window.showInformationMessage('Тэги не найдены в этом файле');
        return;
    }
    tags.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
    const pos = ed.selection.active;
    const insideIndex = tags.findIndex(t => t.range.contains(pos));
    let targetIndex = -1;
    if (insideIndex !== -1) {
        targetIndex = dir === 1 ? insideIndex + 1 : insideIndex - 1;
    }
    else {
        if (dir === 1) {
            targetIndex = tags.findIndex(t => t.range.start.isAfter(pos));
        }
        else {
            for (let i = tags.length - 1; i >= 0; i--) {
                if (tags[i].range.start.isBefore(pos)) {
                    targetIndex = i;
                    break;
                }
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
//# sourceMappingURL=extension.js.map