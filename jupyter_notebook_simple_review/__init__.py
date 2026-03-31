"""Jupyter Notebook Simple Review extension."""

from ._version import __version__

__all__ = ["__version__"]


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyter-notebook-simple-review"}]
