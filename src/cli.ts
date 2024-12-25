/* eslint-disable no-process-exit */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Command } from 'commander';
import prompts from 'prompts';
import { ClaudeHostService } from './services/claude.js';
import { registrySrv } from './services/registry.js';
import { version } from './utils/version.js';
import { stringifyServerToTitle } from './utils/display.js';
import { formatMCPServers } from './utils/formatter.js';

const program = new Command();

const claudeSrv = new ClaudeHostService();

program
  .version(version)
  .name('mcpm')
  .option('-d, --debug', 'enables verbose logging', false);

program
  .command('add')
  .description('Add a new MCP server to your Claude App')
  .argument('[name]', 'name of the MCP server')
  .option('-c, --command <command>', 'command to run the server')
  .option('-a, --args <args...>', 'arguments for the command')
  .option('--self', 'add the MCPM CLI as a MCP server')
  .action(
    async (
      name: string | undefined,
      options: { command?: string; args?: string[]; self?: boolean }
    ) => {
      if (options.self) {
        await claudeSrv.addMCPMSelfMCPServer();
        console.log('MCPM CLI added successfully');
        return;
      }

      if (!name || !options.command) {
        const questions: prompts.PromptObject<string>[] = [];

        if (!name) {
          questions.push({
            type: 'text',
            name: 'name',
            message: 'Enter a name for the MCP server:',
            validate: (value: string | any[]) =>
              value.length > 0 ? true : 'Name cannot be empty',
          });
        }

        if (!options.command) {
          questions.push({
            type: 'text',
            name: 'command',
            message: 'Enter the command to run the server:',
            validate: (value: string | any[]) =>
              value.length > 0 ? true : 'Command cannot be empty',
          });
        }

        if (!options.args) {
          questions.push({
            type: 'text',
            name: 'args',
            message: 'Enter command arguments (space separated):',
            initial: '',
          });
        }

        const responses = await prompts(questions);

        name = name || responses.name;
        if (!name || (!responses.command && !options.command)) {
          console.log('Operation cancelled');
          return;
        }

        options.command = options.command || responses.command;
        options.args =
          options.args ||
          (responses.args
            ? responses.args
                .split(' ')
                .filter((arg: string | any[]) => arg.length > 0)
            : []);
      }

      if (!options.command) {
        console.log('Operation cancelled');
        return;
      }

      await claudeSrv.addMCPServer(name, {
        command: options.command,
        args: options.args || [],
      });
      console.log(`MCP server '${name}' added successfully`);
    }
  );

program
  .command('remove')
  .description('Remove a MCP server from your Claude App')
  .argument('[name]', 'name of the MCP server to remove')
  .action(async name => {
    if (!name) {
      const servers = await claudeSrv.getMCPServersInConfig();
      const choices = Object.entries(servers).map(([name, server]) => ({
        title: `${name} (${server.command} ${server.args?.join(' ') || ''})`,
        value: name,
      }));

      if (choices.length === 0) {
        console.log('No MCP servers found');
        return;
      }

      const response = await prompts({
        type: 'select',
        name: 'server',
        message: 'Select a server to remove:',
        choices,
      });

      if (!response.server) {
        console.log('Operation cancelled');
        return;
      }

      name = response.server;
    }

    if (!name) {
      console.log('Operation cancelled');
      return;
    }

    try {
      await claudeSrv.removeMCPServer(name);
      console.log(`MCP server '${name}' removed successfully`);
    } catch (error) {
      console.error(`Failed to remove server '${name}':`, error);
    }
  });

program
  .command('disable')
  .description('Disable an MCP server (moves it from Claude to storage)')
  .argument('[name]', 'name of the MCP server to disable')
  .action(async name => {
    if (!name) {
      const servers = await claudeSrv.getEnabledMCPServers();
      const choices = Object.entries(servers).map(([name, info]) => ({
        title: stringifyServerToTitle(info),
        value: name,
      }));

      if (choices.length === 0) {
        console.log('No MCP servers found');
        return;
      }

      const response = await prompts({
        type: 'select',
        name: 'server',
        message: 'Select a server to disable:',
        choices,
      });

      if (!response.server) {
        console.log('Operation cancelled');
        return;
      }

      name = response.server;
    }

    if (!name) {
      console.log('Operation cancelled');
      return;
    }

    try {
      await claudeSrv.disableMCPServer(name);
      console.log(`MCP server '${name}' disabled successfully`);
    } catch (error) {
      console.error(`Failed to disable server '${name}':`, error);
    }
  });

program
  .command('enable')
  .description('Enable a disabled MCP server (moves it from storage to Claude)')
  .argument('[name]', 'name of the MCP server to enable')
  .action(async name => {
    if (!name) {
      const servers = await claudeSrv.getDisabledMCPServers();
      const choices = Object.entries(servers).map(([name, info]) => ({
        title: stringifyServerToTitle(info),
        value: name,
      }));

      if (choices.length === 0) {
        console.log('No disabled MCP servers found');
        return;
      }

      const response = await prompts({
        type: 'select',
        name: 'server',
        message: 'Select a server to enable:',
        choices,
      });

      if (!response.server) {
        console.log('Operation cancelled');
        return;
      }

      name = response.server;
    }

    if (!name) {
      console.log('Operation cancelled');
      return;
    }

    try {
      await claudeSrv.enableMCPServer(name);
      console.log(`MCP server '${name}' enabled successfully`);
    } catch (error) {
      console.error(`Failed to enable server '${name}':`, error);
    }
  });

program
  .command('list')
  .description('List all your MCP servers')
  .option('--json', 'Output in JSON format')
  .action(async (options: { json?: boolean }) => {
    const servers = await claudeSrv.getAllMCPServersWithStatus();
    if (options.json) {
      console.log(JSON.stringify(servers, null, 2));
    } else {
      console.log(formatMCPServers(servers));
    }
  });

program
  .command('install')
  .description('Install a MCP package')
  .argument('<name>', 'Package name to install')
  .option('-y, --yes', 'Skip confirmation')
  .option('-p, --param <param...>', 'Parameters in format KEY=VALUE')
  .action(
    async (name: string, options: { yes?: boolean; param?: string[] }) => {
      try {
        // Get package info
        const packageInfo = await registrySrv.getPackageInfo(name);

        if (!options.yes) {
          console.log(`Package: ${packageInfo.title} (${name})`);
          console.log(`Description: ${packageInfo.description}`);

          const { confirmed } = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: 'Do you want to install this package?',
            initial: true,
          });

          if (!confirmed) {
            console.log('Installation cancelled');
            return;
          }
        }

        // Parse command line parameters
        const paramValues: Record<string, string> = {};
        if (options.param) {
          for (const param of options.param) {
            const [key, value] = param.split('=');
            if (!key || !value) {
              throw new Error(
                `Invalid parameter format: ${param}. Use KEY=VALUE format`
              );
            }
            paramValues[key] = value;
          }
        }

        // Get missing parameters interactively
        const missingParams = Object.entries(packageInfo.parameters).filter(
          ([key, info]) => info.required && !paramValues[key]
        );

        if (missingParams.length > 0) {
          const paramQuestions = missingParams.map(
            ([paramName, paramInfo]): prompts.PromptObject => ({
              type: 'text' as const,
              name: paramName,
              message: `Please enter ${paramName} (${paramInfo.description}):`,
              validate: (value: string) =>
                paramInfo.required && !value ? 'This field is required' : true,
            })
          );

          const paramAnswers = await prompts(paramQuestions);
          Object.assign(paramValues, paramAnswers);
        }

        // Install package
        await claudeSrv.installPackage(name, paramValues);
        console.log(`Package '${name}' installed successfully!`);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    }
  );

program
  .command('mcp')
  .description('Start the MCPM MCP server')
  .action(async () => {
    const { startMCPServer } = await import('./mcp.js');
    await startMCPServer();
  });

program
  .command('search')
  .description('Search for MCP packages')
  .argument('[query]', 'Search query')
  .option('--json', 'Output in JSON format')
  .action(async (query: string | undefined, options: { json?: boolean }) => {
    try {
      if (!query) {
        const response = await prompts({
          type: 'text',
          name: 'query',
          message: 'Enter search query:',
        });

        if (!response.query) {
          console.log('\nSearch cancelled');
          return;
        }

        query = response.query as string;
      }

      const packages = await registrySrv.searchPackages(query);
      if (options.json) {
        console.log(JSON.stringify(packages, null, 2));
      } else {
        if (packages.length === 0) {
          console.log('No packages found.');
          return;
        }

        console.log(`\nSearch results for "${query}":`);
        for (const pkg of packages) {
          console.log(`\n${pkg.title} (${pkg.id})`);
          console.log(`  ${pkg.description}`);
          if (pkg.tags?.length) {
            console.log(`  Tags: ${pkg.tags.join(', ')}`);
          }
        }
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

const debugCmd = program
  .command('debug', { hidden: true })
  .description('Only for Debug');

debugCmd
  .command('clear')
  .description('Clear all data')
  .action(() => {
    console.log('Clearing all data');
    claudeSrv.clearAllData();
  });

program
  .command('restart')
  .description('Restart Claude.app')
  .action(async () => {
    try {
      console.log('Restarting Claude.app...');
      await claudeSrv.restartClaude();
      console.log('Claude.app has been restarted');
    } catch (error: any) {
      console.error('Failed to restart Claude.app:', error.message);
    }
  });

program.command('prepare').description('Prepare Claude.app for MCPM');

program.parse(process.argv);
