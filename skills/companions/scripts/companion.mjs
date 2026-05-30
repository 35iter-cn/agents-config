#!/usr/bin/env node

import { main } from './lib/companion.mjs';

await main(process.argv.slice(2));
