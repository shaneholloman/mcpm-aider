import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import {
  MCPServerConfig,
  MCPServerConfigSource,
  StorageService,
} from './storage.js';

export interface MCPServerBootConfig {
  command: string;
  args: string[];
}

export interface MCPServerMap {
  [key: string]: MCPServerBootConfig;
}

export interface ClaudeConfig {
  mcpServers?: MCPServerMap;
}

export interface MCPServerWithStatus {
  info: MCPServerConfig;
  enabled: boolean;
}

export class ClaudeFileService {
  constructor(private readonly fs: typeof fsp = fsp) {}

  async getClaudeConfig(): Promise<ClaudeConfig | null> {
    try {
      const configPath = ClaudeFileService.getClaudeConfigPath();
      if (!configPath) return null;
      const content = await this.fs.readFile(configPath, 'utf8');
      return JSON.parse(content) as ClaudeConfig;
    } catch {
      console.log('Claude config not found');
      return null;
    }
  }

  private createDefaultClaudeConfig(): ClaudeConfig {
    return {
      mcpServers: {},
    };
  }

  private stringifyClaudeConfig(config: ClaudeConfig): string {
    return JSON.stringify(config, null, 2);
  }

  async createClaudeConfigFile(): Promise<ClaudeConfig> {
    const defaultConfig = this.createDefaultClaudeConfig();
    const configPath = ClaudeFileService.getClaudeConfigPath();
    if (!configPath) throw new Error('Unsupported platform');
    await this.fs.writeFile(
      configPath,
      this.stringifyClaudeConfig(defaultConfig)
    );
    console.log('Claude config created');
    return defaultConfig;
  }

  async getOrCreateClaudeConfig(): Promise<ClaudeConfig> {
    const content = await this.getClaudeConfig();
    if (content) {
      return content;
    }
    return await this.createClaudeConfigFile();
  }

  async writeClaudeConfigFile(config: ClaudeConfig): Promise<void> {
    const configPath = ClaudeFileService.getClaudeConfigPath();
    if (!configPath) throw new Error('Unsupported platform');
    await this.fs.writeFile(configPath, this.stringifyClaudeConfig(config));
  }

  async modifyClaudeConfigFile(
    modifier: (config: ClaudeConfig) => Promise<ClaudeConfig> | ClaudeConfig
  ): Promise<ClaudeConfig> {
    const config = await this.getOrCreateClaudeConfig();
    const newConfig = await modifier(config);
    await this.writeClaudeConfigFile(newConfig);
    return newConfig;
  }

  async saveClaudeConfig(config: ClaudeConfig): Promise<void> {
    await this.writeClaudeConfigFile(config);
  }

  static getClaudeConfigPath(): string {
    // process.platform Posible values：
    // 'aix' - IBM AIX
    // 'darwin' - macOS
    // 'freebsd' - FreeBSD
    // 'linux' - Linux
    // 'openbsd' - OpenBSD
    // 'sunos' - SunOS
    // 'win32' - Windows(32-bit or 64-bit)

    const home = os.homedir();

    if (process.platform === 'win32') {
      // Windows Path
      return path.join(
        home,
        'AppData',
        'Local',
        'Claude',
        'claude_desktop_config.json'
      );
    } else if (process.platform === 'darwin') {
      // macOS Path
      return path.join(
        home,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json'
      );
    } else {
      // Linux/Unix Path
      return path.join(home, '.config', 'claude', 'claude_desktop_config.json');
    }
  }
}

export class ClaudeHostService {
  constructor(
    public readonly fileSrv: ClaudeFileService = new ClaudeFileService(),
    private readonly storageSrv: StorageService = StorageService.getInstance()
  ) {}

  private addMCPServerToConfigJSON(
    config: ClaudeConfig,
    name: string,
    server: MCPServerBootConfig
  ): ClaudeConfig {
    config.mcpServers = config.mcpServers || {};
    if (config.mcpServers[name]) {
      throw new Error('Server already exists');
    }
    config.mcpServers[name] = server;
    return config;
  }

  private removeMCPServerFromConfigJSON(
    config: ClaudeConfig,
    serverName: string
  ): ClaudeConfig {
    config.mcpServers = config.mcpServers || {};
    if (!config.mcpServers[serverName]) {
      throw new Error(`Server ${serverName} not found`);
    }
    delete config.mcpServers[serverName];
    return config;
  }

  async addMCPServer(
    name: string,
    server: MCPServerBootConfig
  ): Promise<ClaudeConfig> {
    this.storageSrv.addMCPServers([
      {
        name,
        appConfig: server,
        from: MCPServerConfigSource.LOCAL,
      },
    ]);
    return await this.fileSrv.modifyClaudeConfigFile(config =>
      this.addMCPServerToConfigJSON(config, name, server)
    );
  }

  async removeMCPServer(name: string): Promise<void> {
    await this.fileSrv.modifyClaudeConfigFile(config =>
      this.removeMCPServerFromConfigJSON(config, name)
    );
    this.storageSrv.removeMCPServer(name);
  }

  async getMCPServersInConfig(): Promise<MCPServerMap> {
    const config = await this.fileSrv.getClaudeConfig();
    return config?.mcpServers || {};
  }

  async getAllMCPServersWithStatus(): Promise<MCPServerWithStatus[]> {
    const enabledServers = await this.getMCPServersInConfig();
    let installedServers = this.storageSrv.getAllMCPServers();
    // Add new enabled servers (not in storage)
    const newEnabledServers = Object.entries(enabledServers).reduce(
      (acc, [name, server]) => {
        if (!name) {
          return acc;
        }
        const isEnabled =
          installedServers.some(
            installedServer => installedServer.claudeId === name
          ) ||
          installedServers.some(
            installedServer => installedServer.name === name
          );
        if (!isEnabled) {
          acc = [
            ...acc,
            {
              name,
              claudeId: name,
              appConfig: server,
              from: MCPServerConfigSource.LOCAL,
            },
          ];
        }
        return acc;
      },
      [] as MCPServerConfig[]
    );
    this.storageSrv.addMCPServers(newEnabledServers);
    installedServers = [...installedServers, ...newEnabledServers];
    return installedServers.map(server => ({
      info: server,
      enabled: !!enabledServers[server.name],
    }));
  }

  async disableMCPServer(name: string): Promise<void> {
    await this.fileSrv.modifyClaudeConfigFile(config => {
      if (!config?.mcpServers?.[name]) {
        throw new Error(`MCP server '${name}' not found`);
      }

      const server = config.mcpServers[name];

      this.storageSrv.addIfNotExistedMCPServer({
        name,
        appConfig: server,
        from: MCPServerConfigSource.LOCAL,
      });

      delete config.mcpServers[name];
      return config;
    });
  }

  async enableMCPServer(name: string): Promise<void> {
    const storaged = this.storageSrv.getMCPServer(name);

    if (!storaged) {
      throw new Error(`MCP server '${name}' not found`);
    }

    await this.fileSrv.modifyClaudeConfigFile(config => {
      if (config?.mcpServers?.[name]) {
        throw new Error(`MCP server '${name}' already exists`);
      }
      config.mcpServers = config.mcpServers || {};
      config.mcpServers[name] = storaged.appConfig;
      return config;
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getDisabledMCPServers(): Promise<{
    [key: string]: MCPServerConfig;
  }> {
    const servers = await this.getAllMCPServersWithStatus();
    return servers
      .filter(server => !server.enabled)
      .reduce(
        (acc, server) => ({ ...acc, [server.info.name]: server.info }),
        {}
      );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getEnabledMCPServers(): Promise<{
    [key: string]: MCPServerConfig;
  }> {
    const servers = await this.getAllMCPServersWithStatus();
    return servers
      .filter(server => server.enabled)
      .reduce(
        (acc, server) => ({ ...acc, [server.info.name]: server.info }),
        {}
      );
  }

  clearAllData(): void {
    this.storageSrv.clear();
  }
}
