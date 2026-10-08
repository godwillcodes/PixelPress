#!/usr/bin/env node
/** Entry point for the `exact80` command. */

import { run } from './index';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  }
);
