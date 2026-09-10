"""StudyPilot local syllabus parser (mechanical extraction only).

Reads a PDF page-by-page with PyMuPDF, normalizes text, removes
confidently-detected repeated headers/footers, detects unit headings,
and prints ONE JSON document to stdout.

No AI, no embeddings, no semantic reasoning here — the job is fast,
deterministic, structured context. Memory stays flat: pages are
processed incrementally and only the joined (truncated) text is kept.

Usage:
    python scripts/syllabus_parse.py <pdf-path> [--max-chars N] [--max-pages N]

Exit codes: 0 = SUCCESS (even with zero text — caller decides),
            1 = failure (message on stderr).
"""

import argparse
import hashlib
import json
import re
import sys
import time

# Separator between keyword and numeral is optional so compact headings
# like "UNIT-I" parse the same way as "Unit 1".
UNIT_HEADING = re.compile(
    r"^\s*\b(unit|module|chapter|part|section)\s*[-\u2013\u2014:.]?\s*(\d{1,2}|[ivxlcdm]{1,5})\b\s*[:.\-_\u2013\u2014]?\s*(.{0,120})$",
    re.IGNORECASE,
)
NUMBERED_HEADING = re.compile(r"^\s*\d{1,2}\s*[:.\-_\u2013\u2014]\s+([A-Za-z].{2,100})$")


def clean_line(line: str) -> str:
    line = line.replace("\x00", "").strip()
    return re.sub(r"\s+", " ", line)


def main() -> int:
    started = time.perf_counter()
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf_path")
    ap.add_argument("--max-chars", type=int, default=500_000)
    ap.add_argument("--max-pages", type=int, default=2_000)
    args = ap.parse_args()

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("PyMuPDF (fitz) is not installed", file=sys.stderr)
        return 1

    try:
        doc = fitz.open(args.pdf_path)
    except Exception as exc:  # corrupt / not a PDF
        print(f"cannot open pdf: {exc}", file=sys.stderr)
        return 1

    # Password-protected PDFs get their own exit code so the caller can
    # show "password protected" ONLY for genuinely encrypted files.
    try:
        if doc.needs_pass:
            print("PASSWORD_REQUIRED", file=sys.stderr)
            return 2
    except Exception:
        pass

    try:
        page_count = doc.page_count
        limit = min(page_count, args.max_pages)
        meta = doc.metadata or {}
        metadata = {
            "title": (meta.get("title") or "")[:200],
            "author": (meta.get("author") or "")[:200],
        }

        # Pass 1 — extract + clean each page incrementally.
        raw_pages: list[list[str]] = []
        first_lines: dict[str, int] = {}
        last_lines: dict[str, int] = {}
        for i in range(limit):
            try:
                page = doc[i]
                raw = page.get_text("text")
            except Exception:
                raw_pages.append([])
                continue
            lines = [clean_line(l) for l in raw.splitlines()]
            lines = [l for l in lines if l]
            raw_pages.append(lines)
            if lines:
                first_lines[lines[0]] = first_lines.get(lines[0], 0) + 1
                last_lines[lines[-1]] = last_lines.get(lines[-1], 0) + 1
            # release page resources promptly for large documents
            page = None  # noqa: F841

        # Pass 2 — repeated header/footer detection: a first/last line seen
        # on >=3 pages (and >=10% of pages) is a document artifact, not content.
        threshold = max(3, int(limit * 0.10))
        artifacts = {
            line
            for line, n in list(first_lines.items()) + list(last_lines.items())
            if n >= threshold and len(line) <= 140
        }

        pages = []
        headings: list[dict] = []
        kept_chars = 0
        truncated = False
        for idx, lines in enumerate(raw_pages):
            kept = [l for l in lines if l not in artifacts]
            page_headings = []
            for l in kept:
                m = UNIT_HEADING.match(l)
                if m:
                    page_headings.append(l[:140])
                    headings.append({"pageNumber": idx + 1, "text": l[:140]})
                    continue
                m2 = NUMBERED_HEADING.match(l)
                if m2 and len(l) <= 110:
                    page_headings.append(l[:140])
            text = "\n".join(kept)
            if kept_chars + len(text) > args.max_chars:
                room = max(0, args.max_chars - kept_chars)
                text = text[:room]
                truncated = True
            kept_chars += len(text)
            pages.append(
                {"pageNumber": idx + 1, "text": text, "headings": page_headings}
            )
            if truncated:
                break

        full_text = "\n\n".join(p["text"] for p in pages if p["text"]).strip()
        duration_ms = int((time.perf_counter() - started) * 1000)
        out = {
            "status": "SUCCESS",
            "engine": "python-pymupdf",
            "pageCount": page_count,
            "pagesParsed": len(pages),
            "pages": pages,
            "headings": headings[:200],
            "metadata": metadata,
            "fullText": full_text,
            "charsExtracted": len(full_text),
            "artifactsRemoved": sorted(artifacts)[:50],
            "truncated": truncated or limit < page_count,
            "durationMs": duration_ms,
        }
        sys.stdout.write(json.dumps(out))
        return 0
    finally:
        doc.close()


if __name__ == "__main__":
    sys.exit(main())
