# Test review: keep the contract, delete the echo

Reviewers on this repo read tests as noise unless they lock a contract. Two
questions decide every test: *what breaks if this assertion is wrong?* and *would
this test fail if the implementation were subtly incorrect?*

## The standing team rule

Lei set this in a DM on 2026-10-20 and it is the standard every backend PR is
measured against:

> Keep only what protects a real business behaviour or an important contract for
the long run, what gives meaningful regression cover — and do not over-constrain
reasonable evolution. Red tests written during TDD are fine, they can be useful,
but clean them up before the merge; whatever remains is a standing cost to CI and
to every later change.

He said the same thing twice in the same conversation: *"be restrained about
adding tests — the suite is visibly bloating"*, and *"running tests keeps getting
more expensive"*. Treat a growing diff of new tests as a review finding, not as
thoroughness.

The operational test for each new test: **name the real behaviour or external
contract it guards, in one sentence, without using the words "calls", "returns"
or "does not call".** If you cannot, it is an echo of the implementation — delete
it, even if it is green and even if it was useful while writing the code.

Worked case (backend#1247, 9 tests trimmed to 6): kept *already-active is a no-op*,
*reactivation announces itself with the right ids*, *missing property is 404*,
plus the external use case's three branches (delegates, 404 + no delegation across
companies, 404 + no delegation when missing). Dropped *"sets Active and returns
the updated entity"* (restates the change), *"dispatches only the reactivated
event"* (locks the absence of an event and the call counts) and *"does not refetch
when the entity is passed"* (locks internal call shape). The external happy path
stays on purpose: without it an inverted guard passes every remaining test.

## Keep / delete

| Test | Verdict |
|---|---|
| Filter parameter mapping (`Ended`, `Draft`, `IncludeMovedOutTenants`) | keep — this is the requirement |
| Ordering contract (end descending, nulls last) | keep |
| Branch with real logic (search vs null, `[]` vs `null`) | keep |
| "verify the mocked dependency was called" | delete — restates the implementation |
| Pure mapping DTO test | delete — interference, not coverage |
| `MigrateAsync` in the test base instead of `EnsureCreated` | revert; migrations in a test carry no behavior signal |

A suite's runtime is a cost. Three contract tests beat eight echo tests.

## The two assertion deaths

**Vacuous pass.** `Assert.All(records, ...)` over a collection the mock never
populated passes on an empty set. Assert non-empty (or the page/sentinel count)
first, then the invariant.

**Self-referential baseline.** Asserting against a constant the implementation
also defines (`size <= PaginatedFetch.MaxPageSize`) stays green when the contract
(`[Range(1,100)]`) drifts. Validate the request object instead:

```csharp
PayloadValidator.Validate(request, out _);
```

The baseline is the contract owner (`PayloadValidator`), not a copy of the number.

## Fixtures are the test's documentation

A test asserting "must not exceed 100" while its own `Page()` helper hard-codes
`PageSize = 500` teaches the next reader the bug. Fixture defaults match the
contract; a mismatched fixture is a review finding on its own.

## Withdrawing a test addition is a legitimate third path

When review contention concentrates on how the new tests are written, and the
actual fix is already verified independently (existing tests, behavior assertion),
you may withdraw the whole test addition and return the PR to a pure business fix:

```bash
git show <pr-base>:<test-path> > <test-path>   # restore the PR baseline
dotnet test <csproj> --filter "FullyQualifiedName~<Class>"
git commit && git push
```

Precondition: first *prove* the pre-existing tests still cover the change (run the
restored file and watch it go green — an API that kept its signature, e.g. a
return type narrowed inside the client, keeps old mocks compatible). Then file a
follow-up issue for the withdrawn debt (anti-recurrence assertion, shared setup
helper). Do not silence the reviewer without the issue.

## Fake-client parity

A fake that diverges from the repository makes tests pass while production fails:
`null` handling (`Count > 0` vs `!= null`), missing filter fields, missing
defaults. When a repository filter changes, the fake changes in the same commit.
