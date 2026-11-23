"""PDFnix engine: a local HTTP service that does all PDF work."""

__version__ = "0.3.0"

from . import compat  # noqa: E402,F401  (PyMuPDF workarounds; must load first)
