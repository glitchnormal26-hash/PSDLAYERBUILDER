#!/usr/bin/env node
import { Command } from 'commander';
import { ZodError } from 'zod';
import { buildMockupFile } from './engine.js';
import { inspectPsd } from './inspect.js';

const program = new Command();
program
  .name('psdlayer')
  .description('Build editable layered PSD mockups from a JSON manifest')
  .version('0.1.0');

program.command('build')
  .argument('<manifest>', 'Path to mockup manifest JSON')
  .requiredOption('-o, --output <file>', 'Output PSD file')
  .action(async (manifest, options) => {
    try {
      const result = await buildMockupFile(manifest, options.output);
      console.log(`PSD written: ${result.output}`);
      console.log(`Layers: ${result.layerCount} | Smart objects: ${result.smartObjectCount} | Bytes: ${result.bytes}`);
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    } catch (error) {
      if (error instanceof ZodError) {
        console.error('Invalid manifest:');
        for (const issue of error.issues) console.error(`- ${issue.path.join('.')}: ${issue.message}`);
      } else {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exitCode = 1;
    }
  });

program.command('inspect')
  .argument('<psd>', 'PSD file to inspect')
  .action(async (psdFile) => {
    try {
      const result = await inspectPsd(psdFile);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
