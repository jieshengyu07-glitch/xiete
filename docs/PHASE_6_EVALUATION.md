# Phase 6 Evaluation Feasibility Gate

Audit date: 2026-08-14 (Asia/Shanghai)

## Gate result

`GATE_C_NOT_VERIFIED`

The repository does not contain current evidence that the official Taiyuan University of Science and Technology teaching-evaluation task list can be read reliably. Evaluation remains hidden. This conclusion does not assess or change the separate course-rating community.

## Existing implementation

- `src/evaluation/check.js` accepts an injected HTTP client, sends one GET to the configured JWXT evaluation path, and expects HTML.
- It returns `completed`, `pending`, or `unknown` by scanning broad Chinese keywords.
- Any page containing `评价`, `问卷`, or `评教` can become `pending`; there is no structured task parsing, count, login-page classification, maintenance-page classification, or parse-error result.
- The module is not imported by the checker, scheduler, server, or tests. No HTTP evaluation route is registered.
- No evaluation fixture or provenance record exists. Git history shows the file entered the repository in the initial commit on 2026-06-16; the last real-school verification date is unknown.
- `src/db/storage.js` contains unused legacy evaluation status methods. `src/notifier/console.js` contains unused reminder methods.
- `/status` derives `unevaluatedCount` only from cached grade rows whose score text equals `未评价`. That is grade-cache metadata, not verified access to the official teaching-evaluation system, and it has no registered mini-program UI.

## Official-system candidate

Repository configuration names the following candidate only:

- Host: `newjwc.tyust.edu.cn`
- Base: `/jwglxt`
- Candidate entry: `/jxpg/xsMain.html`
- Expected authentication: existing JWXT session cookies

This is a code declaration, not current-page evidence. An unauthenticated read-only request on 2026-08-14 ended with `ECONNRESET`, so the current page, redirect behavior, DOM, task list, and form were not verified. Existing local user sessions were not used because the active audit process did not have the configured session-encryption key; no credential or plaintext-cookie workaround was attempted.

## Evidence matrix

| Evidence | Level | Current | Proves | Does not prove |
| --- | --- | --- | --- | --- |
| `src/evaluation/check.js` | LEVEL_1 — CODE_EXISTS | Current repository | A one-GET HTML keyword checker exists | Current endpoint, reliable state detection, task count, or submit flow |
| `src/config.js` candidate path | LEVEL_1 — CODE_EXISTS | Current repository | A JWXT host/path was once intended | That the path is current, reachable, or authorized |
| No imports/routes/tests for checker | LEVEL_1 — CODE_EXISTS | Current repository | Checker is isolated from production flows | Any official evaluation capability |
| Git history, initial commit 2026-06-16 | LEVEL_1 — CODE_EXISTS | Historical | Earliest tracked presence of the file | Last real-world verification date or fixture provenance |
| Public TYUST pages describing student evaluation | LEVEL_1 — CODE_EXISTS | Public pages current in 2026 | The institution uses student teaching evaluation in some form | Product endpoint, authentication, task schema, or live status |
| 2026-08-14 unauthenticated GET | LEVEL_0 — ASSUMPTION | Current attempt | Network attempt was non-mutating and failed with `ECONNRESET` | Page existence, state model, or normal authenticated navigation |
| Local user session files not decrypted | LEVEL_0 — ASSUMPTION | Current workspace | Fail-closed security boundary was preserved | Current authenticated evaluation read flow |

No evidence reaches LEVEL_2, LEVEL_3, LEVEL_4, or LEVEL_5.

## Capability assessment

| Capability | Result | Reason |
| --- | --- | --- |
| Pending status | NOT_VERIFIED | Broad keyword scan can false-positive |
| Pending count | NOT_VERIFIED | No structured task parser |
| Course name | NOT_VERIFIED | No current task-list evidence |
| Teacher | NOT_VERIFIED | No current task-list evidence |
| Deadline | NOT_VERIFIED | No field evidence; must remain `null` if absent |
| Completed status | NOT_VERIFIED | Broad `已完成` scan is not evaluation-scoped |
| No task | NOT_VERIFIED | Checker has no `NO_TASK` result |
| Relogin distinction | NOT_VERIFIED | Login pages are not classified by this checker |
| School unavailable distinction | PARTIAL | Exceptions become `unknown`, but no typed state is returned |
| Parse error distinction | NOT_VERIFIED | Unexpected HTML also becomes `unknown` |

## Form and submission audit

Question IDs, option values, hidden fields, CSRF tokens, ViewState/EventValidation, course ID, teacher ID, evaluation ID, submit endpoint, request shape, dynamic fields, and success confirmation are all `NOT_VERIFIED`.

No real evaluation was submitted. No school data was modified. No production write request was sent.

## Performance and authentication

The historical checker intends one request, but the request cost of a reliable current read flow is unknown. Interactive authentication, CAPTCHA dependency, extra login requirements, additional session domains, and cookie scope are all unknown. Any future cookies must use the existing encrypted `campusSessionStore` architecture and user isolation.

## Product recommendation

Select OPTION C: keep evaluation hidden.

- Reminder-only is `NOT_VERIFIED` because no LEVEL_4 read flow exists.
- Full evaluation is `NOT_VERIFIED` and not recommended because no form or safe submit evidence exists.
- Course rating remains a separate, frozen community feature.
- A future re-audit should start from a user-authorized, normal, read-only JWXT session; verify structured `PENDING`, `COMPLETED`, `NO_TASK`, `RELOGIN_REQUIRED`, and unavailable states; record sanitized fixtures and provenance; and send no state-changing requests.

Maintainability: LOW

Reliability: UNKNOWN

Security: ACCEPTABLE only because no evaluation integration or new session handling was added.
