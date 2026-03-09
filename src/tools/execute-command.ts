import { applyWorkspaceEdit } from '../file-editor.js';
import { uriToPath } from '../utils.js';
import { resolvePath, textResult } from './helpers.js';
import type { ToolDefinition } from './registry.js';

export const executeCommandTool: ToolDefinition = {
  name: 'execute_command',
  description:
    'Execute a custom LSP command via workspace/executeCommand. Many language servers provide powerful commands beyond standard LSP operations (e.g., clojure-lsp provides clean-ns, extract-function, thread-first, inline-symbol, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to a file (used to resolve which LSP server to use)',
      },
      command: {
        type: 'string',
        description: 'The command to execute (e.g., "clean-ns", "extract-function")',
      },
      arguments: {
        type: 'array',
        description:
          'Command arguments. Most clojure-lsp commands expect [file-uri, line, character]. Other servers may vary.',
        items: {},
      },
    },
    required: ['file_path', 'command'],
  },
  handler: async (args, client) => {
    const {
      file_path,
      command,
      arguments: cmdArgs = [],
    } = args as {
      file_path: string;
      command: string;
      arguments?: unknown[];
    };
    const absolutePath = resolvePath(file_path);

    try {
      const result = await client.executeCommand(absolutePath, command, cmdArgs);

      // Handle WorkspaceEdit responses (many refactoring commands return edits)
      if (result && typeof result === 'object' && 'changes' in result) {
        const workspaceEdit = result as {
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
        };

        if (workspaceEdit.changes && Object.keys(workspaceEdit.changes).length > 0) {
          const editResult = await applyWorkspaceEdit(workspaceEdit, { lspClient: client });

          if (!editResult.success) {
            return textResult(
              `Command "${command}" produced edits but failed to apply: ${editResult.error}`
            );
          }

          return textResult(
            `Successfully executed "${command}".\n\nModified files:\n${editResult.filesModified.map((f) => `- ${f}`).join('\n')}`
          );
        }
      }

      // Handle documentChanges variant
      if (result && typeof result === 'object' && 'documentChanges' in result) {
        const workspaceEdit = result as {
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

        if (workspaceEdit.documentChanges && workspaceEdit.documentChanges.length > 0) {
          // Convert documentChanges to changes format
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

          for (const change of workspaceEdit.documentChanges) {
            if (change.textDocument && change.edits) {
              const uri = change.textDocument.uri;
              if (!changes[uri]) {
                changes[uri] = [];
              }
              changes[uri].push(...change.edits);
            }
          }

          const editResult = await applyWorkspaceEdit({ changes }, { lspClient: client });

          if (!editResult.success) {
            return textResult(
              `Command "${command}" produced edits but failed to apply: ${editResult.error}`
            );
          }

          return textResult(
            `Successfully executed "${command}".\n\nModified files:\n${editResult.filesModified.map((f) => `- ${f}`).join('\n')}`
          );
        }
      }

      // Non-edit result (informational commands, etc.)
      if (result === null || result === undefined) {
        return textResult(`Command "${command}" executed successfully (no result returned).`);
      }

      return textResult(
        `Command "${command}" executed successfully.\n\nResult:\n${JSON.stringify(result, null, 2)}`
      );
    } catch (error) {
      return textResult(
        `Error executing command "${command}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export const executeCommandTools: ToolDefinition[] = [executeCommandTool];
