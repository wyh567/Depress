# DePress Mentor MVP Manual Sign-off Runbook

Release candidate: `________________________________`

This is one guided, non-public usability session. Use a disposable account
created by the staging harness and delete it with the staging environment during
cleanup. Give its password to the mentor privately; never copy it into this
runbook, a checklist, chat, screen recording, or screenshot.

A developer-local ignored `.env` may exist. It must remain untracked and
excluded from release artifacts; production uses external process-specific
environment files. Its presence alone does not fail mentor sign-off readiness.

## Before the mentor joins

- Confirm the release marker is the exact SHA above.
- Confirm migrations completed without error (fresh staging should apply once;
  a rerun should report zero pending migrations).
- Confirm API readiness, outbox, pointer Worker, and the loopback HTTPS Web
  proxy are healthy.
- Open only the Web login page in the browser. Keep terminals, service
  dashboards, database tools, Docker tools, credentials, cookies, storage
  details, and internal URLs off screen.
- Open the sign-off checklist and operator observation sheet on the operator's
  device. Start both timers when the mentor begins the login task.

## Demonstration data

- Document title: `________________________________`
- Authors: `________________________________`
- Affiliation: `________________________________`
- Abstract: `________________________________`
- Keywords: `________________________________`
- Reference A: citeKey `A`; title `________________________________`; author
  `________________________________`; year `________________________________`
- Reference B: citeKey `B`; title `________________________________`; author
  `________________________________`; year `________________________________`
- Body:
  - Heading: `________________________________`
  - Paragraph: use a disposable paragraph, insert citations A, B, A in order.
  - Second paragraph: `________________________________`

## Mentor workflow

The operator reads only the task prompt unless the mentor asks for help. Record
every explanation in the observation sheet.

1. Sign in with the privately supplied disposable mentor account.
2. Create one new document.
3. Enter the exact title, authors, affiliation, abstract, keywords, and body
   above.
4. Save. Record the time to first saved document.
5. Refresh the browser, reopen the document from Documents, and confirm all
   metadata and body text remain present.
6. Add Reference A and Reference B.
7. In the first body paragraph, insert citations in literal order A, B, A.
8. Save again, refresh and reopen, and visually confirm the three citation
   nodes remain in A, B, A order.
9. Select IEEE, compile, wait for success, choose Download PDF, and open the
   downloaded PDF. Confirm the title, body, citation order, and bibliography
   are readable. Record the time to first PDF.
10. Select Elsevier, compile, download, and open its PDF. Confirm readability.
11. Select GB/T 7714, compile, download, and open its PDF. Confirm readability.
12. Make a small body edit without saving. Confirm the UI says
    `Save the document before compiling` and Compile is disabled.
13. Choose Sign out and confirm the login screen replaces the workspace.

## Closeout

- Ask the mentor for the overall rating, blocking issues, non-blocking
  feedback, decision, and date. Complete and retain signed records outside this
  repository; only a sanitized acceptance summary may later be committed.
- Classify every requested change as `BLOCKER`, `POST-LAUNCH`, or
  `OUT_OF_SCOPE`; do not implement feedback during the session.
- End the disposable staging environment and verify its listeners, processes,
  containers, volumes, networks, runtime files, PDFs, and generated credentials
  are removed.
