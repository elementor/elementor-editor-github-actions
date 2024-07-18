#!/usr/bin/env zx

// actions/log/index.ts
var args = minimist(process.argv.slice(2), {
  string: ["message"],
  default: {
    message: "Hello, World!"
  },
  alias: {
    m: "message"
  }
});
echo(args.message);
