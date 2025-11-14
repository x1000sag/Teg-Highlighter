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
exports.TodoNode = exports.TreeDataView = void 0;
const vscode = __importStar(require("vscode"));
// Модуль отвечающий за работу TreeView тегов
class TreeDataView {
    scanner;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    constructor(scanner) {
        this.scanner = scanner;
    }
    // Удаление окна TreeView
    dispose() {
        this._onDidChange.dispose();
    }
    // Обнавляет окно TreeView
    refresh() {
        this._onDidChange.fire();
    }
    // Принимает аргумент класса `TodoNode` и возвращает `TreeItem`
    getTreeItem(el) {
        return el;
    }
    // Принимает класс `TodoNode` и возвращает его массив его потомков
    async getChildren(el) {
        if (!el) {
            const all = this.scanner.getAllCached();
            const byFile = new Map();
            for (const t of all) {
                const key = t.uri.fsPath;
                const a = byFile.get(key) ?? [];
                a.push(t);
                byFile.set(key, a);
            }
            const nodes = [];
            for (const [file, todos] of byFile.entries()) {
                const label = vscode.workspace.asRelativePath(file);
                const node = new TodoNode(label, vscode.TreeItemCollapsibleState.Collapsed);
                node.meta = { file, todos };
                node.description = `(${todos.length})`;
                node.iconPath = new vscode.ThemeIcon('file');
                nodes.push(node);
            }
            nodes.sort((a, b) => a.label.localeCompare(b.label));
            return nodes;
        }
        const meta = el.meta;
        if (!meta || !meta.todos) {
            return [];
        }
        return meta.todos.map((t) => {
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
exports.TreeDataView = TreeDataView;
class TodoNode extends vscode.TreeItem {
    meta;
    constructor(label, state) {
        super(label, state);
    }
}
exports.TodoNode = TodoNode;
//# sourceMappingURL=treeDataView.js.map