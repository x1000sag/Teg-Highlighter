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
exports.Decorator = void 0;
const vscode = __importStar(require("vscode"));
// Модуль отвечающий за визуальную декорацию фрагмента текстового файла.
class Decorator {
    ctx;
    decos = new Map();
    colors = new Map();
    constructor(ctx) {
        this.ctx = ctx;
        const cfg = vscode.workspace.getConfiguration('tagHighlighter');
        const tags = cfg.get('tags') ?? [];
        for (const t of tags) {
            if (t.color)
                this.colors.set(t.name.toUpperCase(), t.color);
        }
        this.reloadColors();
    }
    // Актуализирует в классе цвета тегов из конфига в workspace IDE
    reloadColors() {
        this.colors.clear();
        const cfg = vscode.workspace.getConfiguration('tagHighlighter');
        const tags = cfg.get('tags') ?? [];
        for (const t of tags) {
            if (t.color)
                this.colors.set(t.name.toUpperCase(), t.color);
        }
    }
    // Принимает текстовый документ и массив тегов в этом файле.
    // Применяет декоратор ко всем тегам в этом файле
    decorateEditor(ed, todos) {
        if (!ed)
            return;
        for (const d of this.decos.values())
            ed.setDecorations(d, []);
        const byTag = new Map();
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
    // Принимает название тега и создает `TextEditorDecorationType` (если не существует) с параметрами из конфигурации тега в workspacce
    // Возвращает созданный или найденный `TextEditorDecorationType`
    getOrCreate(tag) {
        if (this.decos.has(tag)) {
            return this.decos.get(tag);
        }
        const color = this.colors.get(tag.toUpperCase()) ?? '#ffd700';
        const deco = vscode.window.createTextEditorDecorationType({
            backgroundColor: color + '20', // 20 = прозрачность
            border: `1px solid ${color}`,
            borderRadius: '3px'
        });
        this.decos.set(tag, deco);
        return deco;
    }
    // Удаляет декораторы
    dispose() {
        for (const d of this.decos.values()) {
            d.dispose();
        }
        this.decos.clear();
    }
}
exports.Decorator = Decorator;
//# sourceMappingURL=decorator.js.map