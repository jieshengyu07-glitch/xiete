# Campus Assistant Baseline

## Generated At

- Generated: `2026-08-13T19:56:45+08:00`
- Phase: `PHASE_0_BASELINE_LOCK`
- Scope: documentation and read-only verification only
- Product behavior changed: `NO`
- Production state changed: `NO`

## Git Baseline

```text
Branch: main
Upstream: origin/main
Ahead/Behind: +0/-0
HEAD: 631c27fab8e45329df1c865f6c412132fc57c354
Working Tree: DIRTY (USER_EXISTING_CHANGES)
Staged Files: NONE
```

User existing modified files:

```text
src/server.js
weapp/pages/grades/grades.js
weapp/pages/grades/grades.wxml
weapp/pages/grades/grades.wxss
weapp/pages/login/index.js
weapp/pages/login/index.wxml
weapp/pages/profile/index.js
weapp/pages/profile/index.wxml
weapp/pages/settings/settings.js
weapp/pages/settings/settings.wxml
weapp/pages/timetable/timetable.js
weapp/pages/timetable/timetable.wxml
weapp/pages/timetable/timetable.wxss
weapp/project.config.json
```

User existing untracked files:

```text
.codex-audit/contact-sheet.png
scripts/test-high-priority-sync-ux.js
```

Codex Phase 0 change:

```text
docs/BASELINE.md
```

## Active Product Pages

`ACTIVE_PAGE_BASELINE`

| Page | Path | Registered | Tab |
| --- | --- | --- | --- |
| Public landing | `pages/index/index` | YES | NO |
| Timetable | `pages/timetable/timetable` | YES | YES |
| Grades | `pages/grades/grades` | YES | YES |
| Profile | `pages/profile/index` | YES | YES |
| WeChat login | `pages/login/index` | YES | NO |
| Campus account settings | `pages/settings/settings` | YES | NO |
| Privacy | `pages/privacy/index` | YES | NO |

Frozen/unregistered page groups:

```text
pages/calendar  FROZEN / LEGACY
pages/course    FROZEN / LEGACY
pages/food      FROZEN / LEGACY
pages/rank      FROZEN / LEGACY
pages/rating    FROZEN / LEGACY
pages/tools     FROZEN / LEGACY
```

These pages are not registered in `weapp/app.json`. Their folders are also excluded by the current `weapp/project.config.json` packaging configuration. They must not re-enter the formal package without an explicitly approved product change.

## Tab Bar

`TAB_BASELINE`

| Order | Text | Page path | iconPath | selectedIconPath |
| --- | --- | --- | --- | --- |
| 1 | 课表 | `pages/timetable/timetable` | NOT CONFIGURED | NOT CONFIGURED |
| 2 | 成绩 | `pages/grades/grades` | NOT CONFIGURED | NOT CONFIGURED |
| 3 | 我的 | `pages/profile/index` | NOT CONFIGURED | NOT CONFIGURED |

## Core API

Classifications are limited to `ACTIVE_PRODUCT`, `ADMIN`, `LEGACY`, `TEST_ONLY`, and `UNKNOWN`.

| Route | Method | Classification | Authentication | Current status |
| --- | --- | --- | --- | --- |
| `/health` | GET | ACTIVE_PRODUCT | Public | Active; production read-only check returned 200 |
| `/auth/wechat-login` | POST | ACTIVE_PRODUCT | Public WeChat code exchange | Active; covered by automated tests |
| `/status` | GET | ACTIVE_PRODUCT | JWT | Active; unauthenticated production check returned 401 |
| `/bind-account` | POST | ACTIVE_PRODUCT | JWT | Active wiring; mock/integration covered; real campus account NOT_TESTED |
| `/jwxt/captcha-session` | GET | ACTIVE_PRODUCT | JWT | Active; covered by captcha tests |
| `/jwxt/login-with-captcha` | POST | ACTIVE_PRODUCT | JWT | Active; covered by captcha tests |
| `/unbind-account` | POST | ACTIVE_PRODUCT | JWT | Active |
| `/timetable/config` | GET | ACTIVE_PRODUCT | JWT | Active backend support route |
| `/timetable/today` | GET | ACTIVE_PRODUCT | JWT | Active; current-term correctness is KNOWN_BROKEN |
| `/timetable/week` | GET | ACTIVE_PRODUCT | JWT | Active; current-term correctness is KNOWN_BROKEN |
| `/timetable/sync` | POST | ACTIVE_PRODUCT | JWT | Active background sync |
| `/grades` | GET | ACTIVE_PRODUCT | JWT | Active cached read/background sync |
| `/check` | POST | ACTIVE_PRODUCT | JWT | Active manual/background grade refresh |
| `/grade-changes` | GET | LEGACY | JWT | Backend exists; current active pages do not call it |
| `/account/data` | DELETE | ACTIVE_PRODUCT | JWT | Active user-initiated cloud data deletion |
| `/account/delete-data` | POST | LEGACY | JWT | Compatibility alias for released clients |
| `/admin/diagnose-data` | GET | ADMIN | Admin diagnostic secret and admin mode | Hidden by default in production; tests pass |
| `/upload-cookies` | POST | ADMIN | Admin mode plus JWT | Legacy/debug upload surface; default production behavior is hidden |
| `/upload-xg-session` | POST | ADMIN | Admin mode plus JWT | Legacy/debug upload surface; default production behavior is hidden |
| `/grades/import` | POST | LEGACY | JWT | Active backend route but not an approved product flow; P1 integrity risk; Phase 0 action NONE; planned Phase 2 |
| `/api/school` | GET | LEGACY | Public | Course-rating backend; current product feature disabled |
| `/api/courses/search` | GET | LEGACY | Public | Course-rating backend; current product feature disabled |
| `/api/courses/hot` | GET | LEGACY | Public | Course-rating backend; current product feature disabled |
| `/api/courses` | POST | LEGACY | JWT via rating auth | Current product feature disabled |
| `/api/courses/:id` | GET | LEGACY | Optional JWT | Current product feature disabled |
| `/api/courses/:id/reviews` | GET | LEGACY | Optional JWT | Current product feature disabled |
| `/api/courses/:id/reviews` | POST | LEGACY | JWT via rating auth | Current product feature disabled |
| `/api/course-reviews/:id/like` | POST | LEGACY | JWT via rating auth | Current product feature disabled |
| `/api/rank/courses` | GET | LEGACY | Public | Current product feature disabled |
| `/api/home` | GET | LEGACY | Public | Current product feature disabled |

No `TEST_ONLY` HTTP route was identified. No principal route remains `UNKNOWN` after source tracing.

## Authentication Baseline

### WeChat identity

```text
wx.login
→ POST /auth/wechat-login
→ WeChat jscode2session
→ openid
→ 30-day JWT
→ token stored in WeChat local storage
```

Status: `PASS` at code and automated-test level. Production real WeChat user login was not invoked during Phase 0.

### JWT 401 recovery

```text
authenticated request
→ HTTP 401
→ remove stale token
→ force one shared wx.login exchange
→ store new JWT
→ retry original request once
→ second 401 navigates to login
```

Status: `PASS` at source-wiring level. Concurrent login exchange and GET de-duplication tests pass.

### Campus account binding

```text
settings page studentId/password
→ POST /bind-account
→ portal/CAS credential verification
→ encrypted credential storage
→ background JWXT SSO completion
→ user-scoped cookies and sync state
```

Status: `PARTIAL`. Route wiring, mock integration, captcha, recovery, and isolation tests pass. No real campus account was used in Phase 0.

### Credential storage

- Campus passwords are encrypted before persistence using `CREDENTIAL_SECRET`.
- Production rejects missing, short, example, or JWT-reused credential secrets.
- Status: `PASS` at code and automated-test level.

### Cookie storage

- JWXT Cookie arrays are persisted as JSON in the user directory.
- XG session cookies are persisted inside user campus state.
- Values are usable plaintext at rest.
- Status: `KNOWN_SECURITY_RISK`.

## Timetable Baseline

| Capability | Status | Baseline evidence |
| --- | --- | --- |
| Timetable parsing | PASS | Normalizes weekday, large section, classroom, teacher, week range, odd/even week |
| Timetable storage | PASS | User-scoped storage and persistence tests pass |
| Timetable API | PASS | Config/today/week/sync routes are wired and syntax/tests pass |
| Cached timetable read | PASS | First-open and persistence tests cover cache behavior |
| Cache retained on school-system failure | PASS | UI and backend preserve existing rows while syncing/failing |
| Current term correctness | KNOWN_BROKEN | Production is fixed to the completed 2025 academic-year second semester |
| Real school runtime | NOT_TESTED | No real account or school mutation used during Phase 0 |

Current production timetable configuration:

```text
termYear: 2025
termSemester: 12 (second semester)
semesterStartDate: 2026-02-24
teachingWeekStartDate: 2026-03-09
teachingWeekEndDate: 2026-07-12
maxTeachingWeeks: 18
```

Configuration priority:

```text
Render/environment variables
→ data/term_config.json
→ calendar.js default inference
```

Because Render declares the term variables, default inference does not update the production semester. This is `KNOWN_BROKEN_BASELINE`; Phase 0 action is `NONE`.

## Grades Baseline

| Capability | Status | Baseline evidence |
| --- | --- | --- |
| Cached grades read | PASS | Authenticated isolation, persistence, and first-open tests pass |
| JWXT query/parser | PASS | Route and parser wiring exist; error-classifier and sync tests pass |
| XG fallback | PASS | XG parser, routing, session recovery, and fallback tests pass |
| Source-aware merge | PASS | Canonical JWXT priority and unmatched XG candidate tests pass |
| Cache retained on failure | PASS | High-priority sync UX tests pass |
| Current term coverage | KNOWN_BROKEN | `ALL_TERMS` ends at academic year 2025 |
| Real school runtime | NOT_TESTED | No real account or school mutation used during Phase 0 |

Locked `ALL_TERMS` range:

```text
2023-1  xnm=2023 xqm=3
2023-2  xnm=2023 xqm=12
2024-1  xnm=2024 xqm=3
2024-2  xnm=2024 xqm=12
2025-1  xnm=2025 xqm=3
2025-2  xnm=2025 xqm=12
```

Status: `KNOWN_LIMITATION`. Academic year 2026 is not queried. Phase 0 action is `NONE`.

## Privacy Baseline

- Privacy consent is required before the initial user-triggered WeChat login.
- Local consent withdrawal clears local auth state but does not silently delete cloud data.
- Cloud data deletion is explicitly user-triggered through `DELETE /account/data`.
- Deletion uses a per-user lock and performs final cleanup after in-flight background work settles.
- Unbinding deletes the bound credential and JWXT cookies while retaining cached grades/timetable.
- Review-demo data is isolated from real campus credentials, cookies, and user caches.
- Data deletion and logout behavior were verified only through isolated automated fixtures in Phase 0; no real user directory was deleted.

## Production Configuration Baseline

```text
Service: xiete
Runtime: Node
Plan: starter
Instances: 1
Persistent disk: /data (1 GB)
Health check: /health
Build: npm ci --omit=dev
Start: npm start
```

Mini-program API base URL:

```text
development: https://xiete.onrender.com
production:  https://xiete.onrender.com
```

The shared development/production backend is `KNOWN_TECH_DEBT`.

## Known Broken Baseline

1. `KNOWN_BROKEN`: current timetable production configuration is still the completed 2025 academic-year second semester (`2026-03-09` through `2026-07-12`).
2. `KNOWN_BROKEN`: grade `ALL_TERMS` does not include academic year 2026 or any later term.
3. `KNOWN_SECURITY_RISK`: JWXT and XG session cookies are persisted in plaintext at rest.
4. `P1`: authenticated `/grades/import` can modify a user's grade cache outside the approved school-data flow.
5. `P1`: WeChat login and campus binding do not have a unified endpoint rate-limit policy.
6. `KNOWN_TECH_DEBT`: development and production mini-program configurations use the same API base URL.
7. `LEGACY`: `setup.js` and README still describe the old Cookie upload workflow, while production debug routes now require admin mode and JWT.
8. `PARTIAL`: campus binding has mock/integration coverage but no Phase 0 real-account verification.

## Known Security Risks

### Sensitive Git boundary

Status: `PASS` / no `SECURITY_BLOCKER` found.

Tracked `data/` files are limited to:

```text
data/rating/course_review_likes.json
data/rating/course_reviews.json
data/rating/courses.json
data/school.json
data/term_config.json
```

The following are ignored and were not found tracked:

```text
.env
data/users/
data/cookies.json
data/campus.json
data/debug/
logs/
*.log
*.cookie
*.session
```

`weapp/pages/grades/grades.json` and `weapp/pages/timetable/timetable.json` are page configuration files, not personal grade/timetable data.

### LOGGING_RISK_BASELINE

- No source log statement was found printing a complete password, Cookie value, JSESSIONID value, Authorization header, Bearer token, or openid.
- Sensitive-related logs print metadata such as presence, names, count, length, domain/path, status code, or hashed user scope.
- Debug/login scripts can print Cookie names and paths; they state that values are hidden.
- Some error messages are logged verbatim. They should remain covered by the regression requirement that upstream errors must not include secrets.
- Current status: `PASS_WITH_METADATA_RISK`; no P0 raw-secret logging finding.

### Legacy route baseline

- `/upload-cookies` and `/upload-xg-session`: admin/debug surfaces; hidden by default in production.
- `/grades/import`: authenticated legacy backend surface; P1 data-integrity risk.
- Rating/course APIs: backend remains available although current mini-program feature is disabled.

## Test Baseline

Commands executed from the repository root with `NODE_ENV=development` where applicable:

```text
npm run check
npm test
npm audit --omit=dev --json
GET https://xiete.onrender.com/health
GET https://xiete.onrender.com/status (without Authorization)
```

Results:

```text
JavaScript Syntax: PASS (113 files)
Test Runner: PASS (34 test script groups)
Failed Test Groups: 0
Skipped Test Groups: 0
Build: NOT AVAILABLE
Lint: NOT AVAILABLE
Real WeChat Login: NOT_TESTED
Real Campus Binding: NOT_TESTED
Real JWXT/XG Sync: NOT_TESTED
Production /health: PASS, HTTP 200, {"status":"ok","version":"1.0.0"}
Production unauthenticated /status: PASS, HTTP 401
```

The 34 passing groups cover admin authorization, user isolation, binding mocks, session recovery, captcha handling, persistence, cached first-open behavior, grade merge, error classification, privacy deletion, production secret policy, scheduler policy, review-demo isolation, settings/profile state, request de-duplication, WeChat configuration, and XG fallback/parser behavior.

## Dependency Audit

`npm audit --omit=dev --json` baseline:

```text
Critical: 0
High: 0
Moderate: 1
Low: 1
Total vulnerable packages: 2
Production dependencies reported: 124
Direct vulnerable dependencies: 0
Transitive vulnerable dependencies: 2
```

Recorded transitive findings:

- `undici <= 6.27.0`: moderate; fix available.
- `body-parser < 1.20.6`: low; fix available.

No audit fix was executed.

## Regression Guard

`REGRESSION_GUARD_BASELINE`

Future phases must preserve all of the following unless a separately approved product/security change explicitly replaces the behavior:

1. The user-triggered WeChat login route remains available.
2. Successful WeChat identity resolution still signs a user-scoped JWT.
3. Authenticated requests still renew once after the first 401 and do not loop indefinitely.
4. Concurrent login renewal remains shared/de-duplicated.
5. User data remains isolated by sanitized openid-derived user directory.
6. Campus passwords remain encrypted at rest with a secret independent from the JWT secret.
7. Production continues to reject missing, example, short, or reused secrets.
8. Existing cached grades remain readable without requiring a successful live refresh.
9. Existing cached timetable rows remain readable without requiring a successful live refresh.
10. School-system timeout, outage, login failure, or parser failure must not clear a previously valid cache.
11. Grade merging retains JWXT canonical priority and does not present uncertain XG candidates as verified new JWXT grades.
12. User-level grade, timetable, Cookie, credential, and sync state isolation remains enforced.
13. Data deletion remains explicitly user-triggered and removes the scoped cloud directory safely.
14. Unbinding continues to remove credentials and sessions without silently deleting cached academic data.
15. Review-demo users remain isolated from real campus systems and normal user storage.
16. The active page list remains exactly the currently approved seven registered pages until explicitly changed.
17. The formal Tab Bar remains ordered as 课表, 成绩, 我的 until explicitly changed.
18. Frozen calendar/course/food/rank/rating/tools pages do not re-enter `app.json` or the formal package accidentally.
19. Production admin/debug routes remain hidden unless explicit admin mode is enabled.
20. Logs must not output complete passwords, Cookie values, JSESSIONID/rememberMe values, Authorization/Bearer tokens, secret keys, or raw openid values.

## Phase 0 Result

```text
PHASE_0_BASELINE_LOCK_COMPLETE
```

Phase 1 has not started. No Git staging, commit, push, PR, deployment, production write, account binding, Cookie upload, grade import, or data deletion was performed.
