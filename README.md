# jupyter-notebook-simple-review

A lightweight review/commenting JupyterLab extension for **Jupyter Notebook 7+** that lets reviewers add notes stored directly in cell metadata.

---

## Features

| Feature | Details |
|---|---|
| **Cell-attached comments** | Comments are stored in cell metadata under the key `review_comments` and remain attached across save/reload cycles. |
| **Toolbar button** | Each cell has a 💬 comment button in the top-left area. The button shows a badge with the number of unresolved comments. |
| **In-place UI** | Click the toolbar button to expand a collapsible comment panel below the cell. |
| **Emoji** | Each comment may include an optional emoji chosen from a curated picker. |
| **Resolved state** | Comments can be marked as resolved (with resolver name and timestamp). Resolved comments display a ✓ **Resolved** badge and are collapsed by default. |
| **Collapse / expand** | Any comment card can be manually collapsed or expanded. The collapsed state is persisted in metadata for consistent shared review behavior. |
| **External identity (iframe)** | When the notebook is embedded in an iframe the parent application can inject the reviewer's username via `window.postMessage`. |

---

## Installation

### From source (recommended)

```bash
pip install -e .
```

This installs the prebuilt extension that is included in the repository. The extension will be automatically discovered by Jupyter Notebook 7+.

### Verify the installation

After installation, verify the extension is enabled:

```bash
jupyter labextension list
```

You should see `jupyter-notebook-simple-review` listed as enabled.

### Development install (for contributors)

```bash
# Install Python package in editable mode
pip install -e .

# For development with auto-rebuild
jupyter labextension develop . --overwrite
```

Using docker to run a development environment:

```bash
# start container
docker run --rm -it -v $(pwd):/tmp/jupyter-notebook-simple-review --network host ubuntu:24.04
# inside container
# set up Python environment and install the extension in editable mode
export DEBIAN_FRONTEND=noninteractive
apt update && apt install -y python3.12 python3-pip python3.12-venv nodejs
python3 -m venv /tmp/env
# install Jupyter Notebook 7.5.1 in the virtual environment
/tmp/env/bin/pip install notebook==7.5.1
# install the extension in editable mode
cd /tmp/jupyter-notebook-simple-review
/tmp/env/bin/pip install -e .
# run Jupyter Notebook with the extension enabled
/tmp/env/bin/jupyter notebook --allow-root
```

Rebuilding the extension after making changes to the source code:

```bash
apt install -y nodejs npm
npm install
source /tmp/env/bin/activate
npm run build:lib:prod
jupyter labextension build .
```

Note: make sure to version the generated files under `jupyter_notebook_simple_review/labextension/` before committing, 
as these are not built automatically in the CI pipeline.

---

## Usage

1. Open any notebook in Jupyter Notebook 7+
2. Each cell has a **💬** comment button in its top-right area
3. Click the button to expand/collapse the comment panel below that cell
4. Add a comment using the form (optionally select an emoji)
5. Use **Resolve** to mark comments as resolved
6. Use the collapse/expand button (▶/▼) on each comment card to toggle visibility
7. The button shows a badge with the count of unresolved comments (or ✓ when all are resolved)

---

## iframe identity injection

When Jupyter Notebook is embedded inside an iframe, the parent application can pass the reviewer's identity by posting a message:

```javascript
// In the parent application
notebookIframe.contentWindow.postMessage(
  { type: 'jupyter-review-identity', username: 'alice' },
  'https://your-notebook-host.example.com'   // must match ALLOWED_ORIGINS in src/index.ts
);
```

The extension validates `event.origin` against `ALLOWED_ORIGINS` in `src/index.ts` before accepting the identity.  Edit that constant to include your host's origin before deploying.

---

## Comment metadata format

Comments are stored in cell metadata under the key `review_comments`:

```json
{
  "review_comments": [
    {
      "id": "uuid-v4",
      "author": "alice",
      "authorSource": "iframe",
      "text": "Consider renaming this variable.",
      "emoji": "💡",
      "resolved": false,
      "resolvedBy": null,
      "resolvedAt": null,
      "collapsed": false,
      "createdAt": "2026-03-19T09:30:00Z",
      "updatedAt": "2026-03-19T09:30:00Z"
    }
  ]
}
```

See [`src/types.ts`](src/types.ts) for the full TypeScript interface definition.

---

## Development

### Running tests

```bash
npm test
```

### Type checking

```bash
npx tsc --noEmit
```

### Building

```bash
npm run build       # development build
npm run build:prod  # production build
```

---

## Project structure

```
src/
  index.ts          – main extension plugin (JupyterFrontEnd activation)
  types.ts          – TypeScript interfaces for IReviewComment
  model.ts          – cell metadata read/write helpers
  commentWidget.ts  – Lumino widget rendering comment cards and add-comment form
  __tests__/
    model.test.ts   – Jest tests for the model layer
style/
  base.css          – extension styles (snr-* namespace)
jupyter_notebook_simple_review/
  __init__.py       – Python package entry point
  _version.py       – version string
```
