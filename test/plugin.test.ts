import { describe, it, expect } from 'vitest';
import { mppxHederaPlugin, mppxHederaPluginToolNames } from '../src/index.js';

describe('mppxHederaPlugin', () => {
  it('has name "hak-mppx-hedera-plugin"', () => {
    expect(mppxHederaPlugin.name).toBe('hak-mppx-hedera-plugin');
  });

  it('has a version string', () => {
    expect(typeof mppxHederaPlugin.version).toBe('string');
    expect(mppxHederaPlugin.version).toBeTruthy();
  });

  it('tools() returns array of 4 tools', () => {
    const tools = mppxHederaPlugin.tools({} as any);
    expect(tools).toHaveLength(4);
  });

  it('each tool has method, name, description, parameters, and execute', () => {
    const tools = mppxHederaPlugin.tools({} as any);
    for (const tool of tools) {
      expect(tool).toHaveProperty('method');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('parameters');
      expect(tool).toHaveProperty('execute');
      expect(typeof (tool as any).method).toBe('string');
      expect(typeof (tool as any).name).toBe('string');
      expect(typeof (tool as any).description).toBe('string');
      expect(typeof (tool as any).execute).toBe('function');
    }
  });

  it('tool names match mppxHederaPluginToolNames constants', () => {
    const tools = mppxHederaPlugin.tools({} as any);
    const toolMethods = tools.map((t: any) => t.method);

    expect(toolMethods).toContain(mppxHederaPluginToolNames.CHARGE_FETCH);
    expect(toolMethods).toContain(mppxHederaPluginToolNames.SESSION_OPEN);
    expect(toolMethods).toContain(mppxHederaPluginToolNames.SESSION_FETCH);
    expect(toolMethods).toContain(mppxHederaPluginToolNames.SESSION_CLOSE);

    expect(mppxHederaPluginToolNames.CHARGE_FETCH).toBe('mppx_hedera_charge_fetch_tool');
    expect(mppxHederaPluginToolNames.SESSION_OPEN).toBe('mppx_hedera_session_open_tool');
    expect(mppxHederaPluginToolNames.SESSION_FETCH).toBe('mppx_hedera_session_fetch_tool');
    expect(mppxHederaPluginToolNames.SESSION_CLOSE).toBe('mppx_hedera_session_close_tool');
  });
});
