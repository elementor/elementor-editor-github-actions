#!/usr/bin/env zx

// actions/log/index.ts
import { echo, minimist } from "zx";
var args = minimist(process.argv.slice(2), {
  string: ["message"],
  default: {
    message: "Hello, World!"
  }
});
echo(args.message);
