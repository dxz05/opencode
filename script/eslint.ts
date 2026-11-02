#!/usr/bin/env bun

import { $ } from "bun"
import { ESLint } from "eslint"

// Type-aware linting of every package in one process exhausts the heap, so each package gets its own eslint process.
const dirs = (await Array.fromAsync(new Bun.Glob("packages/*/src").scan({ onlyFiles: false }))).sort()
const results: ESLint.LintResult[] = []
const crashed: string[] = []

for (const dir of dirs) {
  const run = await $`bun x eslint ${`${dir}/**/*.ts`} --format json`.nothrow().quiet()
  if (run.exitCode > 1) {
    crashed.push(dir)
    console.error(`${dir}: eslint crashed\n${run.stderr.toString()}`)
    continue
  }
  const lint: ESLint.LintResult[] = run.json()
  results.push(...lint)
  console.log(`${dir}: ${lint.length} files, ${lint.reduce((sum, r) => sum + r.errorCount, 0)} errors`)
}

await Bun.write(process.argv[2] ?? "eslint-report.json", JSON.stringify(results))
console.log(await (await new ESLint().loadFormatter("stylish")).format(results))

if (crashed.length > 0) process.exit(2)
if (results.some((r) => r.errorCount > 0)) process.exit(1)
