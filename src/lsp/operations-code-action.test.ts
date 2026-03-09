import { describe, expect, it, jest } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToUri } from '../utils.js';
import { codeAction } from './operations.js';
import type { ServerState } from './types.js';

const MOCK_FILE = join(tmpdir(), 'test.ts');

function createMockServerState(
  overrides?: Partial<{
    sendRequest: (...args: unknown[]) => Promise<unknown>;
    defaultTimeout: number;
    adapterTimeout: number | undefined;
  }>
): ServerState {
  const sendRequest = overrides?.sendRequest ?? jest.fn().mockResolvedValue([]);
  return {
    process: {} as any,
    transport: {
      sendRequest: sendRequest as any,
      sendNotification: jest.fn(),
      sendMessage: jest.fn(),
    },
    documentManager: {
      ensureOpen: jest.fn().mockResolvedValue(false),
      sendChange: jest.fn(),
      isOpen: jest.fn().mockReturnValue(false),
      getVersion: jest.fn().mockReturnValue(0),
    },
    initialized: true,
    initializationPromise: Promise.resolve(),
    startTime: Date.now(),
    config: { extensions: ['ts'], command: ['test-server'] },
    diagnosticsCache: {
      get: jest.fn(),
      update: jest.fn(),
      waitForIdle: jest.fn().mockResolvedValue(undefined),
    },
    defaultTimeout: overrides?.defaultTimeout ?? 30000,
    adapter:
      overrides?.adapterTimeout !== undefined
        ? { name: 'test', getTimeout: () => overrides.adapterTimeout! }
        : undefined,
  } as unknown as ServerState;
}

describe('codeAction operation', () => {
  it('should send textDocument/codeAction request with correct params', async () => {
    const sendRequest = jest
      .fn()
      .mockResolvedValue([{ title: 'Extract function', kind: 'refactor.extract' }]);
    const state = createMockServerState({ sendRequest });

    const range = {
      start: { line: 4, character: 0 },
      end: { line: 10, character: 5 },
    };

    const result = await codeAction(state, MOCK_FILE, range);

    expect(sendRequest).toHaveBeenCalledWith(
      'textDocument/codeAction',
      {
        textDocument: { uri: pathToUri(MOCK_FILE) },
        range,
        context: {
          diagnostics: [],
          triggerKind: 1,
        },
      },
      30000
    );
    expect(result).toEqual([{ title: 'Extract function', kind: 'refactor.extract' }]);
  });

  it('should pass diagnostics to context', async () => {
    const sendRequest = jest.fn().mockResolvedValue([]);
    const state = createMockServerState({ sendRequest });
    const diagnostics = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        message: 'Unused variable',
        severity: 2,
      },
    ];

    await codeAction(
      state,
      MOCK_FILE,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      diagnostics
    );

    expect(sendRequest).toHaveBeenCalledWith(
      'textDocument/codeAction',
      expect.objectContaining({
        context: {
          diagnostics,
          triggerKind: 1,
        },
      }),
      30000
    );
  });

  it('should return empty array for non-array result', async () => {
    const sendRequest = jest.fn().mockResolvedValue(null);
    const state = createMockServerState({ sendRequest });

    const result = await codeAction(state, MOCK_FILE, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });

    expect(result).toEqual([]);
  });

  it('should use defaultTimeout from serverState', async () => {
    const sendRequest = jest.fn().mockResolvedValue([]);
    const state = createMockServerState({ sendRequest, defaultTimeout: 60000 });

    await codeAction(state, MOCK_FILE, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });

    expect(sendRequest).toHaveBeenCalledWith('textDocument/codeAction', expect.anything(), 60000);
  });

  it('should prefer adapter timeout over defaultTimeout', async () => {
    const sendRequest = jest.fn().mockResolvedValue([]);
    const state = createMockServerState({
      sendRequest,
      defaultTimeout: 30000,
      adapterTimeout: 90000,
    });

    await codeAction(state, MOCK_FILE, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });

    expect(sendRequest).toHaveBeenCalledWith('textDocument/codeAction', expect.anything(), 90000);
  });

  it('should ensure document is open before requesting', async () => {
    const state = createMockServerState();
    const ensureOpen = state.documentManager.ensureOpen as ReturnType<typeof jest.fn>;

    await codeAction(state, MOCK_FILE, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });

    expect(ensureOpen).toHaveBeenCalledWith(MOCK_FILE);
  });
});
