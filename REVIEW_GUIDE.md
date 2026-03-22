# Code Review Guide

This guide provides systematic review patterns for finding common issues in test infrastructure and smart contract code. Apply each section methodically when reviewing a PR.

---

## 1. Mocking and Test Fidelity

### What to look for
- Any contract, class, or function that replaces real logic with a stub or no-op (names like `Dummy*`, `Mock*`, `Stub*`)
- Code that impersonates addresses or bypasses access-control modifiers for testing
- Proof/signature verification that is skipped or hardcoded to succeed

### Questions to ask
- Could the mock be replaced with the real implementation by providing it the right inputs (e.g., a constructed Merkle proof, a real signed message)?
- Is the mock introduced because the real path is hard to drive, or because it was easier? If the latter, push back.
- If a mock is unavoidable for this release, is it at least isolated in a dedicated test-only contract deployed from the start, rather than being patched in at runtime (e.g., via code replacement on a live address)?
- When impersonating an address to pass an `onlyX` modifier, is impersonation happening at the right level of abstraction (e.g., impersonating the operator, not a higher-level proxy that happens to satisfy the check)?

### Red flags
- Replacing the bytecode at a deployed contract's address at runtime to swap in a mock
- Impersonating a contract address (e.g., a diamond proxy) where the real caller should be an EOA operator

---

## 2. Assertion Completeness

### What to look for
- Assertions that check only a subset of available fields when a richer snapshot/struct is available
- Assertions that are trivially always true (e.g., `x >= 0` for an unsigned integer or a non-negative quantity)
- Tests that only verify the happy path without checking boundary or negative cases

### Questions to ask
- Does the test assert all fields of a result struct/object, or only the convenient ones?
- Is the assertion logically meaningful (could it ever fail given valid code)?
- Are there important negative test cases missing — for example, verifying that *un-registered* entries are not present, not just that registered ones are?

### Red flags
- `expect(x).to.be.at.least(0)` where `x` is inherently non-negative
- Checking only one field of a multi-field result object
- Test iterates over a set of expected items but never checks that no unexpected items exist

---

## 3. Magic Numbers and Unnamed Constants

### What to look for
- Numeric literals (chain IDs, addresses, private keys, amounts, timeouts) used inline without a named constant
- Repeated use of the same literal in multiple places
- Chain IDs or entity IDs used to identify something with a role/purpose

### Questions to ask
- Does this number have a semantic meaning (chain role, known address, protocol constant)?
- Is the same literal duplicated across multiple files or functions?
- Would a future reader understand what this number means without domain knowledge?

### Red flags
- Raw private keys as string literals without a named constant
- Numeric IDs used to identify entities that have a semantic role (e.g. chain IDs used as chain-role identifiers) — these should be named constants like `GATEWAY_CHAIN_ID`, `SETTLEMENT_CHAIN_ID`, etc.
- Default parameter values that are raw numeric IDs (`?? 10`, `?? 11`) instead of named constants

---

## 4. Code Duplication and Missing Abstractions

### What to look for
- Repeated patterns (e.g., the same 3-line sequence appearing in multiple test files)
- Inline logic that belongs in a dedicated helper function
- Common operations (e.g., "get chain by ID from a list") performed inline every time instead of as a utility

### Questions to ask
- Does this logic appear more than once? If so, can it be extracted?
- Is there an existing utility (e.g., a tracker, a helper module) that already does this or something similar? Is it being used?
- Is verbose/encoded form used when a more readable equivalent exists (e.g., calling a function via ABI encoding string when a typed call is available)?

### Red flags
- The same regex, calculation, or lookup pattern repeated across multiple test files
- Inline balance before/after comparisons when a dedicated balance-tracking utility is available
- `contract["functionName(type)"]()` encoding style when `contract.functionName()` works

---

## 5. Function and Interface Design

### What to look for
- Functions that hardcode a choice that the caller should be able to control (e.g., selecting a "random" token internally instead of accepting it as a parameter)
- Functions that accept raw provider/address arguments when they could operate on a richer context/state object that already contains those fields
- Data structures with fields that are redundant (same value repeated in every instance) or whose semantics change depending on context (making them confusing)

### Questions to ask
- Should this parameter be an input to the function instead of being decided internally?
- Could this function be a method on an existing object/class that already holds the required context?
- Does this field in the interface/struct mean something different in different contexts? If so, is that documented, or should the struct be split?

### Red flags
- A function that internally picks which entity (token, chain, account) to operate on — tests become less flexible
- `getField(provider, state.addresses.X)` where `provider` could be derived from `state`
- A field whose semantics silently change depending on context (e.g. a "chain balance" field that stores a different chain's balance for a certain class of chain)

---

## 6. Test Naming and Description Accuracy

### What to look for
- Test suite or test case names that claim to *do* something (setup, deploy, configure) when they only *verify* something
- Test names that are too vague to distinguish failure from a sea of tests

### Questions to ask
- Does the test name accurately describe what the test actually does vs. what it checks?
- Would a developer reading a failing test name immediately understand what broke?

### Red flags
- A `describe` block named after a setup action (e.g. "X Setup", "Deploy Y") when its body only reads state and asserts — should be "X Verification" or "X State Check"
- `it("works correctly")` with no specifics

---

## 7. Data Model and Redundancy

### What to look for
- Interface/type fields that have the same value for every instance in practice
- Fields that could be derived from global/shared config rather than stored per-entity

### Questions to ask
- Is this field actually per-entity, or is it always the same across all entities?
- Can this be moved to a shared config or computed on demand?

### Red flags
- Protocol-level constants (e.g. fixed system contract addresses, well-known chain IDs) stored as per-instance fields in a struct when they are the same for every instance

---

## 8. Dead Code and Unused Entities

### What to look for
- Functions, modifiers, events, errors, or state variables that are declared but never called or referenced
- Imported symbols (contracts, libraries, interfaces) that are never used in the file
- TypeScript functions, types, or constants that are exported but referenced nowhere in the codebase
- Parameters that are accepted by a function but ignored in the body (often named `_param` as a hint)

### Questions to ask
- Is this function/event/error reachable from any external or internal call path?
- Was this entity introduced speculatively ("we might need it later") without a current caller?
- If a parameter is unused, is the function signature correct, or was the parameter accidentally dropped from the body?

### Red flags
- `event Foo(...)` declared with no `emit Foo(...)` anywhere in the contract or its inheritors
- `function _helper(...) internal` with no call sites in the file or any file that inherits/uses the contract
- `import { SomeContract } from "..."` with no reference to `SomeContract` in the importing file
- An `error CustomError(...)` defined but never used in a `revert` statement

---

## 9. Test Coverage Depth

### What to look for
- Tests that verify deployment happened (addresses are non-null) but don't verify the configuration is correct
- Tests that verify only the most obvious outcome, missing secondary effects (e.g., event emission, state changes in other contracts)

### Questions to ask
- What are the meaningful invariants this feature should satisfy? Are they all tested?
- What are the failure modes? Is there at least one test per distinct failure path?

---

## Review Workflow

1. **Read the diff top-down** — note every new `Mock*`/`Dummy*`/`Stub*` symbol. Evaluate necessity.
2. **Check every assertion** — is it complete? is it trivially true? are negative cases present?
3. **Search for repeated literals** — numeric, string, and private keys. Each should be a named constant.
4. **Check each new function signature** — are inputs configurable or hardcoded?
5. **Check existing utilities** — is the codebase's tracker/helper/snapshot abstraction being used consistently?
6. **Read each test name** — does it match what the test body does?
7. **Check each struct/interface** — are fields per-instance or shared? Are semantics consistent?
8. **Scan for dead code** — every new function, event, error, and import should have at least one call/reference site.
