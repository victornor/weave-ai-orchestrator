#!/usr/bin/env node
// `weave-agent …` is `weave repl …`: the shim runs this file so its exec line keeps the plain `node <target> "$@"` shape.
process.argv.splice(2, 0, 'repl');
void import('./bin.js');
