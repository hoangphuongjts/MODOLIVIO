# ADR: Windows CI model provenance and fail-closed QA (2026-11-17)

**Decision:** Windows feature-branch CI uses a portable TypeScript project config, downloads
ONNX models from the OpenCV-maintained Hugging Face mirror with pinned SHA-256,
falls back to GitHub media only when hashes match, and downloads public demo
portrait fixtures on the ephemeral runner. No private image or session data is used.

**Three-perspective review:** (1) implementation: avoid shell-dependent `p3/*.js`
globbing and Windows open-file deletion; (2) alternative: binary models in Git LFS
are rejected because repo/CI should not bundle the 38 MB file; (3) risk: source
mirrors could be unavailable, test fixtures may not represent customer identities,
and unsigned QA binaries are not production-ready.

**Threats/gates:** actual step outcomes, not green jobs masked by `continue-on-error`;
model SHA-256 verification, real OpenCV inference, zero skipped Python tests,
correct `../dist-win` output path, and portable EXE artifact with checksum. Any
gate failure blocks release. Model artifacts and photos never enter git or EXE
artifact. Windows CI must not open Muse or main account and must not deploy.

**Scenario A (free CI now):** use public sources and ephemeral Windows Actions,
run 100% test gate and upload a clearly labeled QA-only portable EXE. Trigger:
feature-branch push. Stop when sources fail or quota is exhausted.

**Scenario B (commercial later):** preserve an optional, disabled package signing
and controlled model mirror mechanism, license/privacy review, verification on
real customer hardware, audit retention and cost budgeting. Activation requires
separate funding/security approval; none of those capabilities is enabled here.

**Revisit if:** upstream model hashes change intentionally, a test fixture is
removed or fails licensing review, runtime moves away from Node/Electron versions,
or when preparing a signed commercial release. Rollback: revert this feature
branch commit; default branch and production are unchanged.