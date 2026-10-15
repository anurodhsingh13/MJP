#!/bin/zsh -l
cd "$(dirname "$0")" || exit 1
npm start || exit $?
node --input-type=module -e 'import "dotenv/config"; import { spawnSync } from "node:child_process"; spawnSync("open", [`http://localhost:${process.env.WEB_PORT || 5173}`]);'
