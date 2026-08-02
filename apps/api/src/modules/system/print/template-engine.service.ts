 
import { Injectable } from '@nestjs/common';

const MAX_DEPTH = 8;

@Injectable()
export class TemplateEngineService {
  render(template: string, context: Record<string, unknown> = {}): { html: string } {
    const result = this.renderInternal(template, context, 0);
    return { html: result };
  }

  private renderInternal(
    template: string,
    context: Record<string, unknown>,
    depth: number,
  ): string {
    if (depth > MAX_DEPTH) {
      throw new Error('Template error: Max nesting depth exceeded (max 8 levels)');
    }

    let output = template;

    output = this.stripComments(output);

    output = this.processBlocks(output, context, depth);

    output = this.processVariables(output, context);

    return output;
  }

  private stripComments(template: string): string {
    const commentRegex = /\{\{!--[\s\S]*?--\}\}/g;
    return template.replace(commentRegex, '');
  }

  private processBlocks(
    template: string,
    context: Record<string, unknown>,
    depth: number,
  ): string {
    let result = template;
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 1000;

    while (changed && iterations < MAX_ITERATIONS) {
      changed = false;
      iterations++;

      const eachMatch = this.findEachBlock(result);
      if (eachMatch) {
        const { fullMatch: _fullMatch, listPath, innerContent, endPos } = eachMatch;
        const listValue = this.getPathValue(context, listPath);
        let rendered = '';

        if (Array.isArray(listValue) && listValue.length > 0) {
          for (let i = 0; i < listValue.length; i++) {
            const item = listValue[i];
            const itemContext: Record<string, unknown> = {
              ...context,
              this: item,
              '@index': i,
              '@first': i === 0,
              '@last': i === listValue.length - 1,
            };
            rendered += this.renderInternal(innerContent, itemContext, depth + 1);
          }
        }

        result = result.substring(0, eachMatch.startPos) + rendered + result.substring(endPos);
        changed = true;
        continue;
      }

      const ifMatch = this.findIfBlock(result);
      if (ifMatch) {
        const { fullMatch: _fullMatch2, condPath, trueContent, falseContent, startPos, endPos } = ifMatch;
        const condValue = this.getPathValue(context, condPath);
        const isTruthy = this.isTruthy(condValue);
        const chosenContent = isTruthy ? trueContent : (falseContent ?? '');
        const rendered = this.renderInternal(chosenContent, context, depth + 1);
        result = result.substring(0, startPos) + rendered + result.substring(endPos);
        changed = true;
      }
    }

    return result;
  }

  private findEachBlock(template: string): {
    fullMatch: string;
    listPath: string;
    innerContent: string;
    startPos: number;
    endPos: number;
  } | null {
    const eachStartRegex = /\{\{#each\s+([\w.]+)\s*\}\}/g;
    const match = eachStartRegex.exec(template);
    if (!match) return null;

    const startPos = match.index;
    const listPath = match[1];
    const contentStart = startPos + match[0].length;

    const endTag = '{{/each}}';
    const result = this.findMatchingEnd(template, contentStart, '{{#each', endTag);
    if (!result) return null;

    const { innerContent, endPos } = result;
    return {
      fullMatch: template.substring(startPos, endPos + endTag.length),
      listPath,
      innerContent,
      startPos,
      endPos: endPos + endTag.length,
    };
  }

  private findIfBlock(template: string): {
    fullMatch: string;
    condPath: string;
    trueContent: string;
    falseContent: string | null;
    startPos: number;
    endPos: number;
  } | null {
    const ifStartRegex = /\{\{#if\s+([\w.]+)\s*\}\}/g;
    const match = ifStartRegex.exec(template);
    if (!match) return null;

    const startPos = match.index;
    const condPath = match[1];
    const contentStart = startPos + match[0].length;

    const endTag = '{{/if}}';
    const elseTag = '{{else}}';
    const result = this.findMatchingEnd(template, contentStart, '{{#if', endTag, elseTag);
    if (!result) return null;

    const { innerContent, endPos, elsePos } = result;
    let trueContent: string;
    let falseContent: string | null = null;

    if (elsePos !== null) {
      trueContent = innerContent.substring(0, elsePos - contentStart);
      falseContent = innerContent.substring(elsePos - contentStart + elseTag.length);
    } else {
      trueContent = innerContent;
    }

    return {
      fullMatch: template.substring(startPos, endPos + endTag.length),
      condPath,
      trueContent,
      falseContent,
      startPos,
      endPos: endPos + endTag.length,
    };
  }

  private findMatchingEnd(
    template: string,
    contentStart: number,
    startPattern: string,
    endTag: string,
    elseTag?: string,
  ): { innerContent: string; endPos: number; elsePos: number | null } | null {
    let depth = 1;
    let i = contentStart;
    let elsePos: number | null = null;
    const startLen = startPattern.length;
    const endLen = endTag.length;
    const elseLen = elseTag ? elseTag.length : 0;

    while (i <= template.length) {
      if (i + startLen <= template.length && template.substring(i, i + startLen) === startPattern) {
        const following = template.substring(i + startLen, i + startLen + 20);
        if (/^\s+\w/.test(following)) {
          depth++;
          i += startLen;
          continue;
        }
      }

      if (elseTag && i + elseLen <= template.length && template.substring(i, i + elseLen) === elseTag) {
        if (depth === 1 && elsePos === null) {
          elsePos = i;
        }
        i += elseLen;
        continue;
      }

      if (i + endLen <= template.length && template.substring(i, i + endLen) === endTag) {
        depth--;
        if (depth === 0) {
          return {
            innerContent: template.substring(contentStart, i),
            endPos: i,
            elsePos,
          };
        }
        i += endLen;
        continue;
      }

      i++;
    }

    return null;
  }

  private processVariables(template: string, context: Record<string, unknown>): string {
    const varRegex = /\{\{\{?\s*([\w.]+)\s*\}\}\}?/g;
    return template.replace(varRegex, (fullMatch, path: string) => {
      const isRaw = fullMatch.startsWith('{{{') && fullMatch.endsWith('}}}');
      const value = this.getPathValue(context, path);
      const strValue = value === undefined || value === null ? '' : String(value);
      return isRaw ? strValue : this.escapeHtml(strValue);
    });
  }

  private getPathValue(context: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return '';
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }

    return current === undefined ? '' : current;
  }

  private isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
