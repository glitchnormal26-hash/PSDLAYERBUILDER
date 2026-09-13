#!/usr/bin/env node
import { Command } from 'commander';
import { rebuildMagnificBatch } from './magnific-rebuild.js';

const program = new Command();
program
  .name('psdlayer-rebuild')
  .description('Rebuild source mockup photos into editable PSD/JPG Magnific delivery pairs')
  .version('1.4.0')
  .argument('<input-directory>', 'Directory containing source mockup photos')
  .argument('<output-directory>', 'Directory for delivery, manifests and review overlays')
  .option('--ai', 'Mark the resources as containing AI-generated material')
  .option('--min-confidence <value>', 'Surface confidence threshold for review warnings', '0.5')
  .option('--max-analysis-dimension <pixels>', 'Maximum detector analysis dimension', '1600')
  .action(async (inputDirectory, outputDirectory, options) => {
    try {
      const minimumConfidence = Number(options.minConfidence);
      const maxAnalysisDimension = Number.parseInt(String(options.maxAnalysisDimension), 10);
      if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) throw new Error('--min-confidence must be between 0 and 1');
      if (!Number.isFinite(maxAnalysisDimension) || maxAnalysisDimension < 480 || maxAnalysisDimension > 2400) throw new Error('--max-analysis-dimension must be between 480 and 2400');
      const result = await rebuildMagnificBatch({
        inputDirectory,
        outputDirectory,
        createdByAi: Boolean(options.ai),
        minimumConfidence,
        maxAnalysisDimension,
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 2;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
