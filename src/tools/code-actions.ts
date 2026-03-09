import { applyWorkspaceEdit } from '../file-editor.js';
import { resolvePath, textResult } from './helpers.js';
import type { ToolDefinition } from './registry.js';

interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: unknown[];
  edit?: {
    changes?: Record<
      string,
      Array<{
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }>
    >;
    documentChanges?: Array<{
      textDocument: { uri: string; version?: number };
      edits: Array<{
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }>;
    }>;
  };
  command?: {
    title: string;
    command: string;
    arguments?: unknown[];
  };
}

function normalizeChanges(edit: CodeAction['edit']): Record<
  string,
  Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }>
> | null {
  if (!edit) return null;

  if (edit.changes && Object.keys(edit.changes).length > 0) {
    return edit.changes;
  }

  if (edit.documentChanges && edit.documentChanges.length > 0) {
    const changes: Record<
      string,
      Array<{
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }>
    > = {};

    for (const change of edit.documentChanges) {
      if (change.textDocument && change.edits) {
        const uri = change.textDocument.uri;
        if (!changes[uri]) {
          changes[uri] = [];
        }
        changes[uri].push(...change.edits);
      }
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  return null;
}

export const getCodeActionsTool: ToolDefinition = {
  name: 'get_code_actions',
  description:
    'Get available code actions at a position or range. Returns refactoring options, quick fixes, and other actions the LSP server can perform. Use this to discover what actions are available before applying one.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file',
      },
      line: {
        type: 'number',
        description: 'Line number (1-indexed)',
      },
      character: {
        type: 'number',
        description: 'Character/column number (1-indexed)',
      },
      end_line: {
        type: 'number',
        description: 'End line for range selection (1-indexed, defaults to same as line)',
      },
      end_character: {
        type: 'number',
        description: 'End character for range selection (1-indexed, defaults to same as character)',
      },
    },
    required: ['file_path', 'line', 'character'],
  },
  handler: async (args, client) => {
    const { file_path, line, character, end_line, end_character } = args as {
      file_path: string;
      line: number;
      character: number;
      end_line?: number;
      end_character?: number;
    };
    const absolutePath = resolvePath(file_path);

    // Convert from 1-indexed (user) to 0-indexed (LSP)
    const range = {
      start: { line: line - 1, character: character - 1 },
      end: {
        line: (end_line ?? line) - 1,
        character: (end_character ?? character) - 1,
      },
    };

    try {
      const actions = await client.codeAction(absolutePath, range);

      if (!actions || actions.length === 0) {
        return textResult('No code actions available at this position.');
      }

      const formatted = (actions as CodeAction[]).map((action, i) => {
        const parts = [`${i + 1}. ${action.title}`];
        if (action.kind) {
          parts.push(`   Kind: ${action.kind}`);
        }
        if (action.edit) {
          parts.push('   Has edit: yes');
        }
        if (action.command) {
          parts.push(`   Command: ${action.command.command}`);
        }
        return parts.join('\n');
      });

      return textResult(
        `${actions.length} code action(s) available:\n\n${formatted.join('\n\n')}\n\nUse apply_code_action with the exact title to apply one.`
      );
    } catch (error) {
      return textResult(
        `Error getting code actions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export const applyCodeActionTool: ToolDefinition = {
  name: 'apply_code_action',
  description:
    'Apply a code action by title at a given position. First fetches available actions, then applies the one matching the title. The LSP server computes the correct edits, avoiding cursor-position issues that plague execute_command.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file',
      },
      line: {
        type: 'number',
        description: 'Line number (1-indexed)',
      },
      character: {
        type: 'number',
        description: 'Character/column number (1-indexed)',
      },
      end_line: {
        type: 'number',
        description: 'End line for range selection (1-indexed, defaults to same as line)',
      },
      end_character: {
        type: 'number',
        description: 'End character for range selection (1-indexed, defaults to same as character)',
      },
      title: {
        type: 'string',
        description:
          'Exact or partial title of the code action to apply (from get_code_actions output)',
      },
    },
    required: ['file_path', 'line', 'character', 'title'],
  },
  handler: async (args, client) => {
    const { file_path, line, character, end_line, end_character, title } = args as {
      file_path: string;
      line: number;
      character: number;
      end_line?: number;
      end_character?: number;
      title: string;
    };
    const absolutePath = resolvePath(file_path);

    // Convert from 1-indexed (user) to 0-indexed (LSP)
    const range = {
      start: { line: line - 1, character: character - 1 },
      end: {
        line: (end_line ?? line) - 1,
        character: (end_character ?? character) - 1,
      },
    };

    try {
      const actions = (await client.codeAction(absolutePath, range)) as CodeAction[];

      if (!actions || actions.length === 0) {
        return textResult('No code actions available at this position.');
      }

      // Find matching action - exact match first, then partial
      const titleLower = title.toLowerCase();
      let match = actions.find((a) => a.title === title);
      if (!match) {
        match = actions.find((a) => a.title.toLowerCase() === titleLower);
      }
      if (!match) {
        match = actions.find((a) => a.title.toLowerCase().includes(titleLower));
      }

      if (!match) {
        const available = actions.map((a) => `  - ${a.title}`).join('\n');
        return textResult(
          `No code action matching "${title}" found.\n\nAvailable actions:\n${available}`
        );
      }

      const results: string[] = [`Applying code action: "${match.title}"`];

      // Apply workspace edit if present
      if (match.edit) {
        const changes = normalizeChanges(match.edit);
        if (changes) {
          const editResult = await applyWorkspaceEdit({ changes }, { lspClient: client });

          if (!editResult.success) {
            return textResult(
              `Code action "${match.title}" produced edits but failed to apply: ${editResult.error}`
            );
          }

          results.push(
            `Modified files:\n${editResult.filesModified.map((f) => `- ${f}`).join('\n')}`
          );
        }
      }

      // Execute command if present (some actions have both edit + command)
      if (match.command) {
        const cmdResult = await client.executeCommand(
          absolutePath,
          match.command.command,
          match.command.arguments || []
        );

        // Handle WorkspaceEdit from command execution
        if (cmdResult && typeof cmdResult === 'object') {
          const cmdEdit = cmdResult as CodeAction['edit'];
          const changes = normalizeChanges(cmdEdit);

          if (changes && Object.keys(changes).length > 0) {
            const editResult = await applyWorkspaceEdit({ changes }, { lspClient: client });

            if (!editResult.success) {
              results.push(`Command edits failed to apply: ${editResult.error}`);
            } else {
              results.push(
                `Command modified files:\n${editResult.filesModified.map((f) => `- ${f}`).join('\n')}`
              );
            }
          }
        }
      }

      if (results.length === 1) {
        results.push('Action executed successfully (no file changes).');
      }

      return textResult(results.join('\n\n'));
    } catch (error) {
      return textResult(
        `Error applying code action: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export const codeActionTools: ToolDefinition[] = [getCodeActionsTool, applyCodeActionTool];
