import * as vscode from 'vscode';

export interface TagConfig {
  name: string;
  pattern?: string;
  color?: string;
  priority?: number;
  icon?: string;
}

export interface TodoItem {
  uri: vscode.Uri;
  range: vscode.Range;
  lineText: string;
  tag: string;
  tagText: string;
  line: number;
}

/**
 * Scanner — ищет теги внутри комментариев (per-language comment tokens).
 * Кеширует результаты для каждого открытого документа.
 */
export class Scanner implements vscode.Disposable {
  private tags: TagConfig[] = [];
  private tagRegexes: RegExp[] = [];
  private cache = new Map<string, TodoItem[]>();

  private commentMap: Record<string, { line?: string; blockStart?: string; blockEnd?: string }> = {
    javascript: { line: '//', blockStart: '/*', blockEnd: '*/' },
    typescript: { line: '//', blockStart: '/*', blockEnd: '*/' },
    java: { line: '//', blockStart: '/*', blockEnd: '*/' },
    cpp: { line: '//', blockStart: '/*', blockEnd: '*/' },
    c: { line: '//', blockStart: '/*', blockEnd: '*/' },
    python: { line: '#' },
    sh: { line: '#' },
    bash: { line: '#' },
    ruby: { line: '#' },
    sql: { line: '--', blockStart: '/*', blockEnd: '*/' },
    html: { blockStart: '<!--', blockEnd: '-->' },
    xml: { blockStart: '<!--', blockEnd: '-->' }
  };

  constructor(initialTags: TagConfig[] = [{ name: 'TODO' }, { name: 'FIXME' }]) {
    this.setTags(initialTags);
  }

  dispose(): void {
    this.cache.clear();
  }

  setTags(tags: TagConfig[]) {
    this.tags = tags;
    this.tagRegexes = this.tags.map(t => {
      const pat = t.pattern ?? escapeRegex(t.name);
      return new RegExp(`(${pat})(:|\\s)?(.*)$`, 'i');
    });
  }

  async scanDocument(doc: vscode.TextDocument): Promise<TodoItem[]> {
    if (!doc || doc.isClosed) return [];
    const tokens = this.commentMap[doc.languageId] || {};
    const res: TodoItem[] = [];

    let inBlock = false;
    let blockEnd: string | undefined;

    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      let commentText: string | null = null;
      let offset = 0;

      if (tokens.blockStart && tokens.blockEnd) {
        if (inBlock) {
          const endIdx = text.indexOf(blockEnd!);
          if (endIdx !== -1) {
            commentText = text.substring(0, endIdx);
            offset = 0;
            inBlock = false;
            blockEnd = undefined;
          } else {
            commentText = text;
            offset = 0;
          }
        } else {
          const startIdx = text.indexOf(tokens.blockStart);
          const lineIdx = tokens.line ? text.indexOf(tokens.line) : -1;
          if (startIdx !== -1 && (lineIdx === -1 || startIdx < lineIdx)) {
            const endIdx = text.indexOf(tokens.blockEnd!, startIdx + tokens.blockStart.length);
            if (endIdx !== -1) {
              commentText = text.substring(startIdx + tokens.blockStart.length, endIdx);
              offset = startIdx + tokens.blockStart.length;
            } else {
              commentText = text.substring(startIdx + tokens.blockStart.length);
              offset = startIdx + tokens.blockStart.length;
              inBlock = true;
              blockEnd = tokens.blockEnd;
            }
          } else if (tokens.line && lineIdx !== -1) {
            commentText = text.substring(lineIdx + tokens.line.length);
            offset = lineIdx + tokens.line.length;
          }
        }
      } else if (tokens.line) {
        const idx = text.indexOf(tokens.line);
        if (idx !== -1) {
          commentText = text.substring(idx + tokens.line.length);
          offset = idx + tokens.line.length;
        }
      }

      if (commentText !== null) {
        for (let k = 0; k < this.tagRegexes.length; k++) {
          const rx = this.tagRegexes[k];
          const m = rx.exec(commentText);
          if (!m) continue;
          const tag = this.tags[k].name;
          const tagText = (m[3] ?? '').trim();
          // try to find local index inside commentText
          const localIdx = commentText.search(new RegExp(escapeRegex(this.tags[k].name), 'i'));
          const absoluteIndex = localIdx >= 0 ? offset + localIdx : Math.max(offset, text.indexOf(m[0].trim(), offset));
          const start = new vscode.Position(i, absoluteIndex);
          const end = new vscode.Position(i, absoluteIndex + (m[0].trim().length));
          res.push({ uri: doc.uri, range: new vscode.Range(start, end), lineText: text, tag, tagText, line: i });
          break; // только первый тег на строку
        }
      }
    }

    this.cache.set(doc.uri.toString(), res);
    return res;
  }

  async scanWorkspace(glob = '**/*.*', exclude = '**/node_modules/**'): Promise<TodoItem[]> {
    const files = await vscode.workspace.findFiles(glob, exclude);
    const all: TodoItem[] = [];
    for (const f of files) {
      try {
        const d = await vscode.workspace.openTextDocument(f);
        const items = await this.scanDocument(d);
        all.push(...items);
      } catch {
        // ignore unreadable
      }
    }
    return all;
  }

  getTodosForUri(uri: vscode.Uri): TodoItem[] {
    return this.cache.get(uri.toString()) ?? [];
  }

  getAllCached(): TodoItem[] {
    const arr: TodoItem[] = [];
    for (const v of this.cache.values()) arr.push(...v);
    arr.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath) || a.line - b.line);
    return arr;
  }

  clearCache(uri?: vscode.Uri) {
    if (uri) this.cache.delete(uri.toString());
    else this.cache.clear();
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
