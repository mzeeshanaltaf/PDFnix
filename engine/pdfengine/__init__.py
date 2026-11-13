"""PDFnix engine: a local HTTP service that does all PDF work."""

__version__ = "0.1.0"

from . import compat  # noqa: E402,F401  (PyMuPDF workarounds; must load first)
