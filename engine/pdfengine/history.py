"""Undo and redo, on top of PyMuPDF's journal.

Every change to a document is one journal operation, opened with
``History.operation(name)``. MuPDF records what the operation changed and can
step back and forth through the operations. This module adds what the journal
does not keep: which pages each step touched (so the app knows what to
re-render after an undo) and where the last save happened (so the app knows
whether there are unsaved changes, even after undoing back to the saved state).

Rules learned from the pinned PyMuPDF (see STATUS.md, Verified facts):
- with the journal on, any change outside an operation raises, so *all*
  changes go through ``operation``; reads must not change the document either
  (see ``textpages.py``);
- an operation that changes nothing records no step;
- starting a new step after undos discards the steps that could be redone;
- an operation that fails half way still records its partial changes, so it is
  undone here, which leaves a step in the journal that must never be redone;
- *any* write of the document (``save``, ``tobytes``, incremental or not) ends
  with MuPDF setting ``num_incremental_sections`` to 0 ("saved"), after which
  undo restores the wrong objects. ``serialise`` puts the count back. It is a
  private MuPDF field: re-check ``test_undo_still_works_after_saving`` on every
  PyMuPDF upgrade;
- writing with ``garbage`` >= 2 also renumbers objects in the open document,
  so the working document is only ever written with garbage 0 (``save.py``
  compacts a throwaway copy).

Call everything here with the session lock held.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import pymupdf

from .errors import BadRequestError


@dataclass
class Step:
    """One undoable change."""

    name: str
    #: 0-based indexes of the pages whose image or text the change affects.
    pages: set[int] = field(default_factory=set)
    #: True if the change reorders, adds or removes pages. Page indexes then
    #: mean different pages before and after, so the app reloads every page.
    structure: bool = False


class History:
    def __init__(self, doc: pymupdf.Document) -> None:
        doc.journal_enable()
        self._doc = doc
        #: ``_steps[i]`` describes journal step i (0-based).
        self._steps: list[Step] = []
        #: Journal position of the saved state; None once it cannot be reached.
        self._saved: int | None = 0
        #: True while the journal's next redo step is a failed operation.
        self._junk_redo = False

    @property
    def position(self) -> int:
        """How many steps are currently applied."""
        return self._doc.journal_position()[0]

    @contextmanager
    def operation(self, name: str) -> Iterator[Step]:
        """Records the changes made inside the block as one undoable step.

        The caller adds the pages it touched to the yielded step's ``pages``.
        """
        doc = self._doc
        before = self.position
        step = Step(name)
        doc.journal_start_op(name)
        try:
            yield step
        except BaseException:
            doc.journal_stop_op()
            if self.position != before:
                # Take back the partial change. The journal keeps it as a redo
                # step, which is hidden until the next real step replaces it.
                doc.journal_undo()
                self._discard_from(before)
                self._junk_redo = True
            raise
        doc.journal_stop_op()
        if self.position != before:
            self._discard_from(before)
            self._steps.append(step)
            self._junk_redo = False

    def _discard_from(self, position: int) -> None:
        """A new step at ``position`` replaces everything that could be redone."""
        del self._steps[position:]
        if self._saved is not None and self._saved > position:
            self._saved = None

    @property
    def can_undo(self) -> bool:
        return 0 < self.position <= len(self._steps)

    @property
    def can_redo(self) -> bool:
        return not self._junk_redo and self.position < len(self._steps)

    def undo(self) -> Step:
        if not self.can_undo:
            raise BadRequestError("There is nothing to undo.")
        step = self._steps[self.position - 1]
        self._doc.journal_undo()
        return step

    def redo(self) -> Step:
        if not self.can_redo:
            raise BadRequestError("There is nothing to redo.")
        step = self._steps[self.position]
        self._doc.journal_redo()
        return step

    @property
    def modified(self) -> bool:
        return self._saved != self.position

    def mark_saved(self) -> None:
        self._saved = self.position

    def mark_unsaved(self) -> None:
        """The document differs from its file in a way undo cannot reach
        (it was restored from a recovery copy)."""
        self._saved = None

    def serialise(self) -> bytes:
        """The document as PDF bytes, keeping its encryption, without
        disturbing the journal. The only way the working document is written."""
        pdf = pymupdf._as_pdf_document(self._doc)
        sections = pdf.m_internal.num_incremental_sections
        try:
            return self._doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_KEEP)
        finally:
            pdf.m_internal.num_incremental_sections = sections

    def state(self) -> dict[str, Any]:
        can_undo, can_redo = self.can_undo, self.can_redo
        return {
            "canUndo": can_undo,
            "canRedo": can_redo,
            "undoName": self._steps[self.position - 1].name if can_undo else None,
            "redoName": self._steps[self.position].name if can_redo else None,
            "modified": self.modified,
        }
