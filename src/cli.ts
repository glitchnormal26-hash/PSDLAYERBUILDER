#!/usr/bin/env node
import { Command } from 'commander';
import { ZodError } from 'zod';
import { doctorPsd } from './doctor.js';
import { buildMockupFile } from './engine.js';
import { inspectPsd } from './inspect.js';
import { replaceSmartObjects, replaceSmartObjectsFromMap } from './template.js';

const program = new Command();
program
  .name('psdlayer')
  .description('Build, validate and modify editable layered PSD mockups')
  .version('1.1.0');

program.command('build')
  .argument('<manifest>', 'Path to mockup manifest JSON')
  .requiredOption('-o, --output <file>', 'Output PSD file')
  .option('--no-composite', 'Skip the flattened convenience composite for lower RAM/CPU usage')
  .action(async (manifest, options) => {
    try {
      const result = await buildMockupFile(manifest, options.output, {
        generateComposite: options.composite !== false,
      });
      console.log(`PSD written: ${result.output}`);
      console.log(`Layers: ${result.layerCount} | Smart objects: ${result.smartObjectCount} | Bytes: ${result.bytes}`);
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    } catch (error) {
      reportError(error);
    }
  });

program.command('replace')
  .argument('<template>', 'PSD template file')
  .option('--layer <name>', 'Unique smart-object layer name')
  .option('--path <path>', 'Exact slash-separated smart-object layer path')
  .requiredOption('--artwork <file>', 'Replacement PNG/JPEG/WebP artwork')
  .requiredOption('-o, --output <file>', 'Output PSD file')
  .action(async (template, options) => {
    try {
      if (Number(Boolean(options.layer)) + Number(Boolean(options.path)) !== 1) {
        throw new Error('Specify exactly one of --layer or --path');
      }
      const selector = options.path
        ? { path: String(options.path).split('/').filter(Boolean) }
        : { name: String(options.layer) };
      const result = await replaceSmartObjects({
        template,
        replacements: [{ selector, artwork: options.artwork }],
        output: options.output,
      });
      console.log(`PSD written: ${result.output}`);
      for (const replacement of result.replacements) {
        console.log(`Replaced: ${replacement.layerPath} -> ${replacement.artwork}`);
        if (replacement.affectedLayerPaths.length > 1) console.log(`Shared instances refreshed: ${replacement.affectedLayerPaths.join(', ')}`);
      }
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    } catch (error) {
      reportError(error);
    }
  });

program.command('replace-many')
  .argument('<template>', 'PSD template file')
  .requiredOption('--map <json>', 'Replacement map JSON file')
  .requiredOption('-o, --output <file>', 'Output PSD file')
  .action(async (template, options) => {
    try {
      const result = await replaceSmartObjectsFromMap(template, options.map, options.output);
      console.log(`PSD written: ${result.output}`);
      console.log(`Replacements: ${result.replacements.length} | Bytes: ${result.bytes}`);
      for (const replacement of result.replacements) console.log(`- ${replacement.layerPath} -> ${replacement.artwork}`);
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    } catch (error) {
      reportError(error);
    }
  });

program.command('inspect')
  .argument('<psd>', 'PSD file to inspect')
  .action(async (psdFile) => {
    try {
      console.log(JSON.stringify(await inspectPsd(psdFile), null, 2));
    } catch (error) {
      reportError(error);
    }
  });

program.command('doctor')
  .argument('<psd>', 'PSD file to validate structurally')
  .option('--strict', 'Treat warnings as a failing result')
  .action(async (psdFile, options) => {
    try {
      const result = await doctorPsd(psdFile);
      console.log(JSON.stringify(result, null, 2));
      const hasWarning = result.diagnostics.some((item) => item.severity === 'warning');
      if (!result.ok || (options.strict && hasWarning)) process.exitCode = 2;
    } catch (error) {
      reportError(error);
    }
  });

function reportError(error: unknown): void {
  if (error instanceof ZodError) {
    console.error('Invalid input:');
    for (const issue of error.issues) console.error(`- ${issue.path.join('.')}: ${issue.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

await program.parseAsync(process.argv);
