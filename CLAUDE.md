# PDFnix — PDF reader & editor (Windows desktop)

Electron + React/TypeScript UI with a bundled Python engine (FastAPI + PyMuPDF) that does all PDF work. Built in phases, one phase per session: phases 1–7 shipped as v0.1–0.3; phases 8–10 add a text-selection menu and a local AI assistant (LM Studio).

- Plan: `docs/plan/phase-n-<title>.md` (phase 1 also holds the architecture and project-wide conventions)
- Live status and handoff notes: `docs/plan/STATUS.md`

## Handoff protocol

Each phase is implemented in a fresh session with no memory of earlier ones. `docs/plan/STATUS.md` is the only carrier of state between sessions, so it must always be true and current.

### At the start of every session

Do this before writing any code:

1. Read `docs/plan/STATUS.md` in full.
2. Read `docs/plan/phase-1-foundation.md` sections "Architecture" and "Conventions" (skip if you are implementing phase 1 and reading it anyway).
3. Read the plan document for the phase marked as current in STATUS.md, in full.
4. Check reality against the status file: `git status`, `git log --oneline -15`, and, once phase 1 is complete, run the test commands listed in STATUS.md. If the code and STATUS.md disagree, trust the code, tell the user what differs, and correct STATUS.md first.
5. Tell the user in a few lines: which phase you are on, what is already done in it, what you will do next, and anything from "Carried over" or "Deviations" that affects this phase. Then start.

If the user names a phase that is not the current one in STATUS.md, say so and confirm before proceeding.

### While working

- Work only on the current phase. Ideas or problems that belong to another phase go into STATUS.md under "Carried over", not into the code.
- Keep the "Current phase progress" checklist in STATUS.md up to date as items are finished, not only at the end, so an interrupted session can be resumed.
- When you depart from the plan (different library, changed endpoint, dropped or added item), record it under "Deviations and decisions" with the reason. If it changes what a later phase must do, edit that phase's plan document as well so the plan stays correct.
- When a "confirm against the pinned version" note in a plan is resolved, record the answer under "Verified facts" so later sessions do not re-check it.

### At the end of a session

Do this whenever the user says the session is ending, asks for a handoff, or the phase is complete:

1. Run the phase's tests and the checks in its "Verification" section that can be run now. Record actual results, including failures and anything not run.
2. Update STATUS.md:
   - phase table (status, dates)
   - "Current position" (the exact next action for the next session)
   - "Current phase progress" checklist
   - "Commands", "Pinned versions", "Verified facts" if anything changed
   - "Deviations and decisions", "Known issues", "Carried over"
   - a handoff note for the phase under "Phase handoff notes" when the phase is complete
3. A phase is **complete** only when every item in its "Done when" and "Verification" sections has passed, or the user has explicitly accepted the exceptions, which are then listed in the handoff note. Otherwise it stays "in progress".
4. Make sure the work is committed. Propose a commit message and commit when the user agrees; if work is left uncommitted, say so in "Current position".
5. Do not start the next phase in the same session unless the user asks.

## Working rules

- Platform is Windows 11; shell is PowerShell. Node 24 + pnpm for the app, Python 3.12 + uv for the engine.
- The engine is the single source of truth for document state; the renderer never modifies PDFs itself.
- All engine access from the renderer goes through `src/renderer/src/api/engine.ts`.
- Report results as they are: failing tests are reported as failing, with output.
