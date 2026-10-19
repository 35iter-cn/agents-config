---
name: magicdoor-resident-android-e2e
description: Use when a magic-resident change must be seen working in the real app rather than in jest — running the resident app on the Windows Android emulator from WSL, rebuilding the dev APK, pointing it at a local dev server, injecting crafted API responses, and driving the screens with adb. Triggers: "run the resident app", 手机端冒烟, emulator/AVD, `adb install`, dev client won't connect, red screen `Property 'MessageQueue' doesn't exist`, verified in jest but needs live evidence.
category: workflow
date_added: "2026-10-19"
---

# magic-resident on the Windows emulator (from WSL)

## Overview

The resident app is an Expo development build. Verifying it means: a native shell built from the current
commit, JS served by Metro from the topic worktree, and — when the point is an API state — a local stub the
app talks to instead of the dev backend. Everything runs from WSL except the emulator itself, which is a
Windows process reachable only through Windows `adb.exe`.

## When to Use

- A magic-resident change needs live evidence: rendered copy, an error alert, a screen reached by
  navigation.
- A UI state depends on a server response that is hard or destructive to produce for real (declines,
  409s, quota errors) — inject it instead.
- NOT for web portals (use `magicdoor-e2e`), and not as a substitute for the repo's own jest suite, which
  does run: install dependencies with **npm** (`npm install`), never pnpm — a pnpm tree puts packages under
  `node_modules/.pnpm/@react-native+...`, which `transformIgnorePatterns` cannot match and jest then fails
  before a single test runs.

## Environment facts (verified 2026-10-19)

| Thing | Where |
| --- | --- |
| AVD | `ANDROID_AVD_HOME=D:\Android\.android\avd` — **not** `%USERPROFILE%\.android\avd` (that dir is empty; `emulator -list-avds` is the authority) |
| Windows SDK | `D:\Android\Sdk` — `platform-tools\adb.exe`, `emulator\emulator.exe` |
| WSL SDK | `~/android-sdk` (platforms 34/35/36, build-tools 36, NDK 27.1, cmake 3.22) + warm `~/.gradle` |
| Device access | only Windows `adb.exe` sees the emulator; the WSL `adb` does not |
| Cleartext | `android/app/src/debug/AndroidManifest.xml` sets `usesCleartextTraffic="true"`, so plain-HTTP stubs work in debug builds |

## Workflow

1. **Check the shell before believing the JS.** `adb.exe shell dumpsys package com.magicdoor.magicresident |
   grep versionCode` against the worktree's `android/app/build.gradle`. A shell older than the JS loads the
   bundle fine and then crashes (`Property 'MessageQueue' doesn't exist` when the SDK was bumped). Mismatch
   ⇒ rebuild.
1. **Build in WSL.**
   ```bash
   cd <worktree>/android
   printf 'sdk.dir=/home/<you>/android-sdk\n' > local.properties   # gitignored
   ANDROID_HOME=/home/<you>/android-sdk ./gradlew app:assembleDebug \
     -x lint -x test --no-configure-on-demand -PreactNativeArchitectures=x86_64
   ```
   ~6 min warm. Do not use `expo run:android` on Windows and do not add ABIs.
1. **Install through Windows adb.** Copy to `/mnt/d/...`, then `adb.exe install -r "D:\...\app-debug.apk"`.
1. **Serve JS.** Metro in WSL (`npx expo start --clear --port 8081`), then
   `adb.exe reverse tcp:8081 tcp:8081` (plus your stub port). Confirm the whole chain before blaming the
   app: `curl localhost:8081/status` from **Windows** must print `packager-status:running`.
1. **Load the bundle you think you loaded.** Launch the activity, tap the dev-server row in the dev
   launcher, and verify: `adb.exe exec-out run-as com.magicdoor.magicresident cat
   files/DevLauncherApp-BridgelessReactNativeDevBundle.js | grep <marker>`. A "recently opened" entry can
   replay the previous Metro's bundle — that is how a `env.json` change silently fails to apply.
1. **Drive the UI with dumps, not screenshots for reading.** Screenshots for evidence;
   `adb.exe shell uiautomator dump /sdcard/ui.xml` + `exec-out cat` for text and for button bounds. Alerts
   change height per message, so a fixed tap coordinate lands outside the button and the next tap is eaten.
1. **Inject a response** (see below), re-run the same screen, capture each state.
1. **Restore.** `git restore env.json`, stop Metro and the stub. `pm clear` wipes the login; only do it when
   a stale bundle genuinely cannot be evicted otherwise.

## Injecting backend states

Point the one base URL at a local stub via `env.json` (tracked in this repo — restore it afterwards), then
run the stub in WSL:

```js
// /tmp/stub.mjs — forward everything upstream, rewrite one endpoint
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/tenant-portal/methods/setup')) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'https://httpstatuses.com/422', title: 'Unprocessable Entity',
      status: 422, detail: 'SENTINEL-backend-english', paymentErrorCode: '1001' }));
    return;
  }
  const up = https.request({ hostname: 'pay.magicdoor.dev', path: req.url, method: req.method,
    headers: { ...req.headers, host: 'pay.magicdoor.dev' } }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  req.pipe(up);
}).listen(8799);
```

- Set `payBaseUrl` (or `apiBaseUrl`) to `http://10.0.2.2:8799`; `10.0.2.2` is the Windows host and reaches WSL.
  Drive states with a file the stub reads per request (`echo 1001 > /tmp/mode`), so one app session covers
  every case.
- Use a **sentinel** in the field you must not see (`SENTINEL-backend-english`): its absence from the screen
  is the assertion; a screenshot alone cannot prove it.
- A stub that logs every request is also the fastest way to prove the app path: the log tells you whether
  the app reached you at all.

## Reaching a screen that needs a tenant session

`references/tenant-session.md` — obtain a tenant password through a shadow-logged-in property manager, and
which companies actually expose the pay surface (`centralizedPayments` feature gate).

## Common Mistakes

| Symptom | Cause / fix |
| --- | --- |
| `Property 'MessageQueue' doesn't exist` | JS newer than the installed shell — rebuild, do not poke the JS |
| Stub sees nothing although the bundle contains its URL | the app is running the previous cached bundle — reload from the dev server and re-check with `grep <marker>` on the device bundle |
| `session boot` shows old tokens / 401 after reload | the JS session is new but SecureStore kept the token; sign in again rather than chasing the API |
| `input text 'Pass!'` lands as `Pass%21` | adb does not URL-decode and does; type special characters literally, or set a password without them |
| Taps stop registering mid-flow | an alert is still up; its height differs per message — take bounds from `uiautomator dump` |
| A "clean" `tsc` pass locally, red in CI | `expo-env.d.ts` is gitignored and generated by `expo start`; `expo-env.d.ts` presence is not CI truth — check with `git archive` + the same `node_modules` |
| Rail-2/payment screens never call the pay host | the company is in legacy mode; pay mode requires `companyInfo.features` to include `centralizedPayments` |
