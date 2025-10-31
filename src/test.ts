// src/scanner.ts
import * as vscode from 'vscode';

export interface TagConfig {
  name: string;             // e.g. "TODO"
  pattern?: string;         // optional regex string or literal (if omitted, use name)
  color?: string;           // optional color hex for decorator usage
  priority?: number;
  icon?: string;
}

export interface TodoItem {
  uri: vscode.Uri;
  range: vscode.Range;
  lineText: string;
  tag: string;
  tagText: string; // text after the tag on the same line
  line: number;    // 0-based
}

/**
 * Простая реализация Scanner — ищет теги только внутри комментариев,
 * используя per-language comment tokens (line and block).
 */
export class Scanner {
  private tags: TagConfig[];
  private tagRegexes: RegExp[] = [];

  // languageId -> comment tokens
  private commentMap: Record<string, { line?: string; blockStart?: string; blockEnd?: string }> = {
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
  private cache = new Map<string, TodoItem[]>();

  constructor(initialTags: TagConfig[] = [{ name: 'TODO' }, { name: 'FIXME' }, { name: 'NOTE' }]) {
    this.setTags(initialTags);
  }

  setTags(tags: TagConfig[]) {
    this.tags = tags;
    this.tagRegexes = this.tags.map(t => {
      const pat = t.pattern ?? t.name;
      // build regex that captures tag and rest of line: e.g. /(TODO|FIXME)(:|\s)?(.*)$/i
      // if user provided a regex literal, we still wrap it to capture trailing text
      return new RegExp(`(${pat})(:|\\s)?(.*)$`, 'i');
    });
  }

  /** Возвращает все найденные теги для документа (сканирует и кладёт в cache). */
  public async scanDocument(doc: vscode.TextDocument): Promise<TodoItem[]> {
    // only text-like documents
    if (doc.isUntitled || doc.languageId === 'binary') {
      return [];
    }

    const languageId = doc.languageId;
    const tokens = this.commentMap[languageId] || {}; // fallback: no tokens
    const results: TodoItem[] = [];

    const lineCount = doc.lineCount;
    let inBlock = false;
    let blockEndToken: string | undefined;

    for (let i = 0; i < lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      let commentText: string | null = null;

      // If language has block comments, track opening/closing
      if (tokens.blockStart && tokens.blockEnd) {
        if (inBlock) {
          const endIdx = text.indexOf(blockEndToken!);
          if (endIdx !== -1) {
            // part inside block until endIdx
            commentText = text.substring(0, endIdx);
            inBlock = false;
            blockEndToken = undefined;
          } else {
            commentText = text;
          }
        } else {
          const startIdx = text.indexOf(tokens.blockStart);
          const lineCommentIdx = tokens.line ? text.indexOf(tokens.line) : -1;

          // if blockStart appears before lineComment (or no lineComment)
          if (startIdx !== -1 && (lineCommentIdx === -1 || startIdx < lineCommentIdx)) {
            // check if block end on same line
            const endIdx = text.indexOf(tokens.blockEnd!, startIdx + tokens.blockStart.length);
            if (endIdx !== -1) {
              commentText = text.substring(startIdx + tokens.blockStart.length, endIdx);
            } else {
              // rest of line after start is comment and we enter block mode
              commentText = text.substring(startIdx + tokens.blockStart.length);
              inBlock = true;
              blockEndToken = tokens.blockEnd;
            }
          } else if (tokens.line && lineCommentIdx !== -1) {
            commentText = text.substring(lineCommentIdx + tokens.line.length);
          }
        }
      } else if (tokens.line) {
        const idx = text.indexOf(tokens.line);
        if (idx !== -1) {
          commentText = text.substring(idx + tokens.line.length);
        }
      } else {
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
            const todo: TodoItem = {
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

  /** Сканирует рабочую область по glob (по умолчанию **/*.{ts,js,py,java,cpp,cs,md,html}) */
  public async scanWorkspace(globPattern: string = '**/*.*', exclude?: string): Promise<TodoItem[]> {
    const files = await vscode.workspace.findFiles(globPattern, exclude ?? '**/node_modules/**');
    const all: TodoItem[] = [];
    for (const f of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(f);
        const items = await this.scanDocument(doc);
        all.push(...items);
      } catch (e) {
        // ignore unreadable files
      }
    }
    return all;
  }

  /** Получить кешированные todos для uri */
  public getTodosForUri(uri: vscode.Uri): TodoItem[] {
    return this.cache.get(uri.toString()) ?? [];
  }

  /** Получить все кешированные todos */
  public getAllCached(): TodoItem[] {
    let res: TodoItem[] = [];
    for (const arr of this.cache.values()) {
      res = res.concat(arr);
    }
    return res;
  }

  /** Очистить кеш для конкретного файла или всего */
  public clearCache(uri?: vscode.Uri) {
    if (uri) {
      this.cache.delete(uri.toString());
    } else {
      this.cache.clear();
    }
  }

  // Utility to escape plain strings for regex search
  private escapeForSearch(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
