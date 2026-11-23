# Sphinx configuration for TIde's documentation, with the Read the Docs theme.
# Build it with `make html` here (or `sphinx-build -b html . _build/html`); Read the Docs builds
# it from ../.readthedocs.yaml.
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# -- Project ---------------------------------------------------------------------------------------
project = "TIde"
author = "TIde contributors"
copyright = "TIde contributors, GPL-3.0-or-later"
# The version is the app's, from src-tauri/tauri.conf.json, so the docs always match it.
release = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
version = ".".join(release.split(".")[:2])

# -- General ---------------------------------------------------------------------------------------
extensions = [
    "sphinx.ext.autosectionlabel",  # :ref: any section by its title
    "sphinx.ext.todo",
]
autosectionlabel_prefix_document = True  # page:Section, so titles can repeat across pages
todo_include_todos = True
templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]
language = "en"

# -- HTML: the Read the Docs theme -----------------------------------------------------------------
html_theme = "sphinx_rtd_theme"
html_title = f"TIde {release}"
html_logo = "_static/logo.png"
html_favicon = "_static/favicon.png"
html_static_path = ["_static"]
html_css_files = ["tide.css"]
html_theme_options = {
    "logo_only": False,
    "style_nav_header_background": "#0f1f3f",  # TIde's navy
    "navigation_depth": 3,
    "collapse_navigation": False,
    "sticky_navigation": True,
    "prev_next_buttons_location": "bottom",
}
# "Edit on GitHub" at the top of each page.
html_context = {
    "display_github": True,
    "github_user": "XSamuraiCoder",
    "github_repo": "TIde",
    "github_version": "docs",
    "conf_py_path": "/docs/",
}
