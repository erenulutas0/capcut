#!/usr/bin/env node
/**
 * Provider measurement harness — command line. See lib/run.mjs and README.md.
 * Default is a dry run: no key is read and no network request is made.
 */
import { main } from './lib/run.mjs';

process.exitCode = await main(process.argv.slice(2));
