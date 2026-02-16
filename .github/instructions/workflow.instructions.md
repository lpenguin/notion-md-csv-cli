---
description: General development guidelines and project context for AI code generation and review.
applyTo: '**/*'
---
* Make sure that the code is stongly typed and that all types are properly defined.
* After generating code, review it for correctness, readability, and maintainability. 
* After generating code, run npm tasks: `npm run build` to check for build errors, `npm run lint` to check for linting errors and `npm run test` to ensure all tests pass.

# Usage of any, "as any", and "as unknown"
* Avoid using `any`, `as any`, and `as unknown` in the codebase. These constructs bypass TypeScript's type checking and can lead to runtime errors. Instead, strive to define precise types for variables, function parameters, and return values to maintain type safety and improve code quality.
* If you have problems with types: find the correct types in node_modules.
* If nothing help, stop and ask for help. Do not use `any` or `eslint-disable-next-line` as a quick fix to bypass type issues. 