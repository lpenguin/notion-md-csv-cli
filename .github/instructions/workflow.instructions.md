---
description: General development guidelines and project context for AI code generation and review.
applyTo: '**/*'
---
* Make sure that the code is stongly typed and that all types are properly defined.
* After generating code, review it for correctness, readability, and maintainability.
* After generating code, run npm tasks: `npm run build` to check for build errors, `npm run lint` to check for linting errors and `npm run test` to ensure all tests pass.