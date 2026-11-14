"""Entry script for the frozen engine (PyInstaller, ``pdfengine.spec``).

``freeze_support`` comes before anything else is imported, so a job's child
process (which starts this same executable) goes straight to its work without
loading the web server first. ``pdfengine.__main__.main`` calls it again for
the unfrozen ``python -m pdfengine`` path, where it does nothing.
"""

import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()

    from pdfengine.__main__ import main

    sys.exit(main())
