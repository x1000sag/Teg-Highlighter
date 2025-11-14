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
exports.Scanner = void 0;
// src/scanner.ts
const vscode = __importStar(require("vscode"));
/**
 * Простая реализация Scanner — ищет теги только внутри комментариев,
 * используя per-language comment tokens (line and block).
 */
class Scanner {
    tags;
    tagRegexes = [];
    // languageId -> comment tokens
    commentMap = {
        // JS/TS/C-like
        javascript: { line: '//', blockStart: '/*', blockEnd: '*/' },
        typescript: { line: '//', blockStart: '/*', blockEnd: '*/' },
        java: { line: '//', blockStart: '/*', blockEnd: '*/' },
        cpp: { line: '//', blockStart: '/*', blockEnd: '*/' },
        c: { line: '//', blockStart: '/*', blockEnd: '*/' },
        // Python / shell
        python: { line: '#' },
        sh: { line: '#' },
        bash: { line: '#' },
        zsh: { line: '#' },
        // Ruby, Perl
        ruby: { line: '#' },
        perl: { line: '#' },
        // SQL
        sql: { line: '--', blockStart: '/*', blockEnd: '*/' },
        // HTML / XML (treat as block comments)
        html: { blockStart: '<!--', blockEnd: '-->' },
        xml: { blockStart: '<!--', blockEnd: '-->' },
        // Add more languageIds as needed
    };
    // In-memory cache: uri -> TodoItem[]
    cache = new Map();
    constructor(initialTags = [{ name: 'TODO' }, { name: 'FIXME' }, { name: 'NOTE' }]) {
        this.setTags(initialTags);
    }
    setTags(tags) {
        this.tags = tags;
        this.tagRegexes = this.tags.map(t => {
            const pat = t.pattern ?? t.name;
            // build regex that captures tag and rest of line: e.g. /(TODO|FIXME)(:|\s)?(.*)$/i
            // if user provided a regex literal, we still wrap it to capture trailing text
            return new RegExp(`(${pat})(:|\\s)?(.*)$`, 'i');
        });
    }
    /** Возвращает все найденные теги для документа (сканирует и кладёт в cache). */
    async scanDocument(doc) {
        // only text-like documents
        if (doc.isUntitled || doc.languageId === 'binary') {
            return [];
        }
        const languageId = doc.languageId;
        const tokens = this.commentMap[languageId] || {}; // fallback: no tokens
        const results = [];
        const lineCount = doc.lineCount;
        let inBlock = false;
        let blockEndToken;
        for (let i = 0; i < lineCount; i++) {
            const line = doc.lineAt(i);
            const text = line.text;
            let commentText = null;
            // If language has block comments, track opening/closing
            if (tokens.blockStart && tokens.blockEnd) {
                if (inBlock) {
                    const endIdx = text.indexOf(blockEndToken);
                    if (endIdx !== -1) {
                        // part inside block until endIdx
                        commentText = text.substring(0, endIdx);
                        inBlock = false;
                        blockEndToken = undefined;
                    }
                    else {
                        commentText = text;
                    }
                }
                else {
                    const startIdx = text.indexOf(tokens.blockStart);
                    const lineCommentIdx = tokens.line ? text.indexOf(tokens.line) : -1;
                    // if blockStart appears before lineComment (or no lineComment)
                    if (startIdx !== -1 && (lineCommentIdx === -1 || startIdx < lineCommentIdx)) {
                        // check if block end on same line
                        const endIdx = text.indexOf(tokens.blockEnd, startIdx + tokens.blockStart.length);
                        if (endIdx !== -1) {
                            commentText = text.substring(startIdx + tokens.blockStart.length, endIdx);
                        }
                        else {
                            // rest of line after start is comment and we enter block mode
                            commentText = text.substring(startIdx + tokens.blockStart.length);
                            inBlock = true;
                            blockEndToken = tokens.blockEnd;
                        }
                    }
                    else if (tokens.line && lineCommentIdx !== -1) {
                        commentText = text.substring(lineCommentIdx + tokens.line.length);
                    }
                }
            }
            else if (tokens.line) {
                const idx = text.indexOf(tokens.line);
                if (idx !== -1) {
                    commentText = text.substring(idx + tokens.line.length);
                }
            }
            else {
                // No comment tokens known for this language: fallback search across whole line (less safe)
                // We still attempt to find tags anywhere (user may want cross-language)
                commentText = text;
            }
            if (commentText !== null) {
                // now check each tag regex against commentText
                for (let t = 0; t < this.tagRegexes.length; t++) {
                    const rx = this.tagRegexes[t];
                    const m = rx.exec(commentText);
                    if (m) {
                        const tagName = this.tags[t].name;
                        const after = (m[3] ?? '').trim();
                        // compute exact positions in document for decoration/navigation
                        // find position of the matched tag inside the full line text
                        const matchText = m[0];
                        const searchIn = text; // the original full line
                        // try to find where the tag occurs relative to the line
                        let absoluteIndex = -1;
                        // First try: find the tag name itself
                        absoluteIndex = text.search(new RegExp(this.escapeForSearch(this.tags[t].name), 'i'));
                        if (absoluteIndex === -1) {
                            // fallback: find the first part of match
                            absoluteIndex = text.indexOf(matchText.trim());
                        }
                        if (absoluteIndex === -1) {
                            // fallback: whole line
                            absoluteIndex = 0;
                        }
                        const startPos = new vscode.Position(i, absoluteIndex);
                        const endPos = new vscode.Position(i, absoluteIndex + matchText.trim().length);
                        const todo = {
                            uri: doc.uri,
                            range: new vscode.Range(startPos, endPos),
                            lineText: text,
                            tag: tagName,
                            tagText: after,
                            line: i
                        };
                        results.push(todo);
                        break; // don't match multiple tags on same line (optional)
                    }
                }
            }
        }
        // cache
        this.cache.set(doc.uri.toString(), results);
        return results;
    }
    async scanWorkspace(globPattern = '**/*.*', exclude) {
        const files = await vscode.workspace.findFiles(globPattern, exclude ?? '**/node_modules/**');
        const all = [];
        for (const f of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(f);
                const items = await this.scanDocument(doc);
                all.push(...items);
            }
            catch (e) {
                // ignore unreadable files
            }
        }
        return all;
    }
    /** Получить кешированные todos для uri */
    getTodosForUri(uri) {
        return this.cache.get(uri.toString()) ?? [];
    }
    /** Получить все кешированные todos */
    getAllCached() {
        let res = [];
        for (const arr of this.cache.values()) {
            res = res.concat(arr);
        }
        return res;
    }
    /** Очистить кеш для конкретного файла или всего */
    clearCache(uri) {
        if (uri) {
            this.cache.delete(uri.toString());
        }
        else {
            this.cache.clear();
        }
    }
    // Utility to escape plain strings for regex search
    escapeForSearch(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
exports.Scanner = Scanner;
//# sourceMappingURL=test.js.map