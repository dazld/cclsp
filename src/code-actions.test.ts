import { beforeEach, describe, expect, it, jest } from 'bun:test';
import { resolve } from 'node:path';
import type { LSPClient } from './lsp-client.js';
import { applyCodeActionTool, getCodeActionsTool } from './tools/code-actions.js';
import { pathToUri } from './utils.js';

type MockLSPClient = {
  codeAction: ReturnType<typeof jest.fn>;
  executeCommand: ReturnType<typeof jest.fn>;
};

function createMockClient(): MockLSPClient {
  return {
    codeAction: jest.fn(),
    executeCommand: jest.fn(),
  };
}

function asClient(mock: MockLSPClient): LSPClient {
  return mock as unknown as LSPClient;
}

describe('get_code_actions', () => {
  let mockClient: MockLSPClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('should return available code actions', async () => {
    mockClient.codeAction.mockResolvedValue([
      { title: 'Extract function', kind: 'refactor.extract' },
      { title: 'Add missing import', kind: 'quickfix', edit: { changes: {} } },
      {
        title: 'Organize imports',
        kind: 'source.organizeImports',
        command: { title: 'Organize', command: 'editor.organizeImports' },
      },
    ]);

    const result = await getCodeActionsTool.handler(
      { file_path: 'test.ts', line: 5, character: 10 },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain('3 code action(s) available');
    expect(result.content[0]?.text).toContain('1. Extract function');
    expect(result.content[0]?.text).toContain('Kind: refactor.extract');
    expect(result.content[0]?.text).toContain('2. Add missing import');
    expect(result.content[0]?.text).toContain('Has edit: yes');
    expect(result.content[0]?.text).toContain('3. Organize imports');
    expect(result.content[0]?.text).toContain('Command: editor.organizeImports');
  });

  it('should convert 1-indexed input to 0-indexed LSP range', async () => {
    mockClient.codeAction.mockResolvedValue([]);

    await getCodeActionsTool.handler(
      { file_path: 'test.ts', line: 5, character: 10 },
      asClient(mockClient)
    );

    expect(mockClient.codeAction).toHaveBeenCalledWith(resolve('test.ts'), {
      start: { line: 4, character: 9 },
      end: { line: 4, character: 9 },
    });
  });

  it('should support range selection with end_line and end_character', async () => {
    mockClient.codeAction.mockResolvedValue([]);

    await getCodeActionsTool.handler(
      { file_path: 'test.ts', line: 5, character: 1, end_line: 10, end_character: 20 },
      asClient(mockClient)
    );

    expect(mockClient.codeAction).toHaveBeenCalledWith(resolve('test.ts'), {
      start: { line: 4, character: 0 },
      end: { line: 9, character: 19 },
    });
  });

  it('should return message when no actions available', async () => {
    mockClient.codeAction.mockResolvedValue([]);

    const result = await getCodeActionsTool.handler(
      { file_path: 'test.ts', line: 1, character: 1 },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toBe('No code actions available at this position.');
  });

  it('should handle null result', async () => {
    mockClient.codeAction.mockResolvedValue(null);

    const result = await getCodeActionsTool.handler(
      { file_path: 'test.ts', line: 1, character: 1 },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toBe('No code actions available at this position.');
  });

  it('should handle errors', async () => {
    mockClient.codeAction.mockRejectedValue(new Error('LSP timeout'));

    const result = await getCodeActionsTool.handler(
      { file_path: 'test.ts', line: 1, character: 1 },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain('Error getting code actions: LSP timeout');
  });
});

describe('apply_code_action', () => {
  let mockClient: MockLSPClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('should match action by exact title', async () => {
    mockClient.codeAction.mockResolvedValue([
      { title: 'Extract function', kind: 'refactor.extract' },
      { title: 'Extract variable', kind: 'refactor.extract' },
    ]);

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'Extract function' },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain('Applying code action: "Extract function"');
    expect(result.content[0]?.text).toContain('Action executed successfully (no file changes)');
  });

  it('should match action by case-insensitive title', async () => {
    mockClient.codeAction.mockResolvedValue([
      { title: 'Extract Function', kind: 'refactor.extract' },
    ]);

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'extract function' },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain('Applying code action: "Extract Function"');
  });

  it('should match action by partial title', async () => {
    mockClient.codeAction.mockResolvedValue([
      { title: 'Extract function to module scope', kind: 'refactor.extract' },
    ]);

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'extract function' },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain(
      'Applying code action: "Extract function to module scope"'
    );
  });

  it('should list available actions when no match found', async () => {
    mockClient.codeAction.mockResolvedValue([
      { title: 'Extract function', kind: 'refactor.extract' },
      { title: 'Add import', kind: 'quickfix' },
    ]);

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'rename' },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain('No code action matching "rename" found');
    expect(result.content[0]?.text).toContain('- Extract function');
    expect(result.content[0]?.text).toContain('- Add import');
  });

  it('should return message when no actions available', async () => {
    mockClient.codeAction.mockResolvedValue([]);

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'anything' },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toBe('No code actions available at this position.');
  });

  it('should execute command when action has command but no edit', async () => {
    mockClient.codeAction.mockResolvedValue([
      {
        title: 'Organize imports',
        command: {
          title: 'Organize',
          command: 'editor.organizeImports',
          arguments: [{ uri: 'file:///test.ts' }],
        },
      },
    ]);
    mockClient.executeCommand.mockResolvedValue(null);

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'Organize imports' },
      asClient(mockClient)
    );

    expect(mockClient.executeCommand).toHaveBeenCalledWith(
      resolve('test.ts'),
      'editor.organizeImports',
      [{ uri: 'file:///test.ts' }]
    );
    expect(result.content[0]?.text).toContain('Action executed successfully');
  });

  it('should handle errors', async () => {
    mockClient.codeAction.mockRejectedValue(new Error('Server crashed'));

    const result = await applyCodeActionTool.handler(
      { file_path: 'test.ts', line: 1, character: 1, title: 'anything' },
      asClient(mockClient)
    );

    expect(result.content[0]?.text).toContain('Error applying code action: Server crashed');
  });
});
