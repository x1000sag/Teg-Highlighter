import { start } from 'repl';
import * as vscode from 'vscode';
import { TodoItem } from './test';

export interface TagConfig {
  name: string;
  color?: string;
  pattern?: string;
}

export interface TagItem {
  uri: vscode.Uri;
  range: vscode.Range;
  lineText: string;
  tag: string;
  tagText: string;
  line: number;
}

export class Scanner {
  private tags: TagConfig[];
  private tagRegularExpressions: RegExp[] = [];
  
  private mapComment: Record<string, {line?: string; blockStart?: string; blockEnd?: string}> = {
    javascript: {line: '//', blockStart: '/*', blockEnd: '*/'},
    typescript: {line: '//', blockStart: '/*', blockEnd: '*/'},
    java: {line: '//', blockStart: '/*', blockEnd: '*/'},
    c: {line: '//', blockStart: '/*', blockEnd: '*/'},
    cpp: {line: '//', blockStart: '/*', blockEnd: '*/'},
    python: {line: '#'},    
  };

  private cash = new Map<string, TagItem[]>();
  
  constructor(initialTags: TagConfig[] = [{name: 'TODO'}, {name: 'FIXME'}, {name: 'NOTE'}]) {
    this.setTags(initialTags);
  }

  setTags(tags: TagConfig[]) {
    this.tags = tags;
    this.tagRegularExpressions = this.tags.map(t => {
      const pattern = t.pattern ?? t.name;
      return new RegExp(`(${pattern})(:|\\s)?(.*)`, 'i');
    });
  }

  public async ScanDocument(doc: vscode.TextDocument): Promise<TagItem[]> {
    if (doc.isUntitled || doc.languageId === 'binary') {
      return[];
    }

    const languageId = doc.languageId;
    const tokens  = this.mapComment[languageId] || {};
    const results: TagItem[] = [];

    const lineCount = doc.lineCount;
    let inBlock = false;
    let blockEndToken: string | undefined;

    for (let i = 0; i < lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      let commentText: string | null = null;

      if (tokens.blockStart && tokens.blockEnd) {
        if (inBlock) {
          const endIndex = text.indexOf(blockEndToken!);

          if (endIndex !== -1) {
            commentText = text.substring(0,endIndex);
            inBlock  = true;
            blockEndToken = undefined;
          } else {
            commentText = text;
          }
        } else {
          const startIndex = text.indexOf(tokens.blockStart);
          const lineCommentIndex = tokens.line ?  text.indexOf(tokens.line) : - 1;

          if (startIndex !== -1 && (lineCommentIndex === -1 || startIndex < lineCommentIndex)) {
            const endIndex = text.indexOf(tokens.blockEnd!, startIndex + tokens.blockStart.length);
            if (endIndex !== -1) {
              commentText = text.substring(startIndex + tokens.blockStart.length, endIndex);
            } else {
              commentText = text.substring(startIndex + tokens.blockStart.length);
              inBlock = true;
              blockEndToken = tokens.blockEnd;
            }
          } else if (tokens.line && lineCommentIndex !== - 1) {
            commentText = text.substring(lineCommentIndex + tokens.line.length);
          }
        }
      } else if (tokens.line) {

        const index = text.indexOf(tokens.line);
        if (index !== -1) {
          commentText = text.substring(index + tokens.line.length);
        }
      } else {
        commentText = text;
      }
      if (commentText !== null) {
        for (let t = 0; t < this.tagRegularExpressions.length; t++) {
          const regularExpression = this.tagRegularExpressions[t];
          const m = regularExpression.exec(commentText);
          if (m) {
            const tagName = this.tags[t].name;
            const after = (m[3] ?? '').trim();
            const matchText = m[0];
            const searchIn = text;
            let absoluteIndex = -1;
            absoluteIndex = text.search(new RegExp(this.escapeFromSearch(this.tags[t].name), 'i'));
            if (absoluteIndex === -1) {
              absoluteIndex = text.indexOf(matchText.trim());
            }
            if (absoluteIndex === -1) {
              absoluteIndex = 0;
            }

            const startPos = new vscode.Position(i, absoluteIndex);
            const endPos = new vscode.Position(i, absoluteIndex + matchText.trim().length);
            const tag: TagItem = {
              uri: doc.uri,
              range: new vscode.Range(startPos, endPos),
              lineText: text,
              tag: tagName,
              tagText: after,
              line: i
            };
            results.push(tag);
            break;
          }
        }
      }
    }
    this.cash.set(doc.uri.toString(), results);
    return results;
  }

  public async scanWorkspace(globPattern: string = '**/*.*', exclude?: string): Promise<TagItem[]> {
    const files = await vscode.workspace.findFiles(globPattern, exclude ?? '**/node_modules/**');
    const all: TagItem[] =[];
    for (const f of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(f);
        const item = await this.ScanDocument(doc);
        all.push(...item);
      } catch (e) {

      }
    }
    return all;
  }

  public getTagsForUri(uri: vscode.Uri) : TagItem[] {
    return this.cash.get(uri.toString()) ?? [];
  }

  public getAllCashed(): TagItem[] {
    let res: TodoItem[] = [];
    for (const arr of this.cash.values()) {
      res = res.concat(arr);
    }
    return res;
  }

  public ClearCash(uri?: vscode.Uri) {
    if (uri) {
      this.cash.delete(uri.toString());
    } else {
      this.cash.clear();
    }
  }

  private escapeFromSearch(s: string) {
    return s.replace('/[.*+?^${}()|[\]\\]/g', '\\$&');
  }
}