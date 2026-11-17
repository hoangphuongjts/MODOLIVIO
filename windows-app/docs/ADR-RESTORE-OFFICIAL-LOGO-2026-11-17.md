# ADR: Recover the official MODOLIVIO logo, not a substitute

Status: BLOCKED on exact source asset.

Root cause: the minified renderer references `./assets/logo-mo-6562vk78.png`, but no such binary asset appears on the feature branch, main, or the other remote branch. The original Windows executable backed up on Google Drive was examined; its `resources/app.asar` also lacks the logo file.

Options:
A. Restore exact user-provided PNG at `windows-app/renderer/assets/logo-mo-6562vk78.png` (required).
B. Replace with generated/mock logo (rejected: violates brand identity requirement).
C. Hide the broken image silently (rejected: masks root cause).

Implemented preparation:
- Favicon HTML uses the exact local logo PNG; legacy `/favicon.ico` redirects to it when present.
- A fail-fast Python guard checks the logo file, PNG structure and renderer/favicon references before expensive CI work.
- Packaged Electron smoke refuses to pass if logo image's naturalWidth is zero on any of the three views.
- No generated logo, no private user image or session, no main/production change.

Release gate: all Windows CI tests must pass with the original logo physically bundled in the EXE and 3 screenshots reviewed; until then FAIL/BLOCKED. The branch is public. Separate user approval may be needed if the original logo has restrictions on public repo redistribution.
