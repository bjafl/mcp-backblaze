---
name: doc-to-skill-scraper
description: Scrape external documentation (API references, library docs, protocol specifications) and generate Claude Agent Skills in SKILL.md format. Use when creating skills from documentation, integrating third-party knowledge, or building domain-specific skills from a URL. Always use this skill when the user provides a URL and wants a skill generated from it, or says things like "scrape these docs", "make a skill from this page", "convert this API reference to a skill", "generate skill from docs", "docs to skill", or "turn this documentation into a skill" — even if phrased casually.
compatibility: python>=3.8, beautifulsoup4, requests, pyyaml
---
 
# Documentation to Skill Scraper
 
## Purpose
 
Fetch external documentation from a URL, extract its structure and key information, and emit a well-formed SKILL.md file ready for installation.
 
## Security Requirements
 
**These checks are mandatory before any HTTP request is made.**
 
### URL Validation
 
```python
import ipaddress
import re
from urllib.parse import urlparse
 
BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local / AWS metadata
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]
 
def validate_url(url: str) -> str:
    """
    Validate URL before fetching. Returns sanitised URL or raises ValueError.
    - Only https:// is accepted
    - Hostname must not resolve to a private/loopback/link-local range
    - Raises ValueError with a user-facing message on any violation
    """
    parsed = urlparse(url)
 
    if parsed.scheme != "https":
        raise ValueError(f"Only HTTPS URLs are allowed (got '{parsed.scheme}://').")
 
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL has no hostname.")
 
    # Reject bare IP literals
    try:
        addr = ipaddress.ip_address(hostname)
        for network in BLOCKED_NETWORKS:
            if addr in network:
                raise ValueError(f"Requests to private/loopback IP ranges are not allowed ({addr}).")
    except ValueError as exc:
        # ip_address() raises ValueError for hostnames — that's fine, continue
        if "not allowed" in str(exc):
            raise
 
    return url
```
 
> **Note:** DNS-rebinding is not fully mitigated by hostname checks alone. For sensitive deployments, resolve the hostname and check the resulting IP. For typical skill-generation use this is an acceptable trade-off; the user is trusted to provide legitimate documentation URLs.
 
### robots.txt Check
 
```python
from urllib.robotparser import RobotFileParser
 
def check_robots(url: str, user_agent: str = "ClaudeSkillScraper/1.0") -> bool:
    """Returns True if fetching is allowed, False otherwise."""
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
    except Exception:
        return True  # If robots.txt is unreachable, proceed cautiously
    return rp.can_fetch(user_agent, url)
```
 
If `check_robots()` returns `False`, inform the user and **stop**. Do not fetch.
 
---
 
## Core Workflow
 
### Step 1: Validate and Fetch
 
```python
import requests
from bs4 import BeautifulSoup
 
HEADERS = {"User-Agent": "ClaudeSkillScraper/1.0"}
TIMEOUT = 15  # seconds
 
def fetch_doc(url: str) -> BeautifulSoup:
    url = validate_url(url)  # raises on violation
 
    if not check_robots(url):
        raise PermissionError(f"robots.txt disallows scraping: {url}")
 
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")
```
 
### Step 2: Extract Structure
 
```python
def extract_doc(soup: BeautifulSoup, source_url: str) -> dict:
    title = (soup.find("h1") or soup.find("title") or {}).get_text(strip=True) or "Untitled"
 
    sections = []
    for heading in soup.find_all(["h1", "h2", "h3"]):
        content_parts = []
        for sibling in heading.find_next_siblings():
            if sibling.name in ("h1", "h2", "h3"):
                break
            content_parts.append(sibling.get_text(" ", strip=True))
        sections.append({
            "level": heading.name,
            "title": heading.get_text(strip=True),
            "content": " ".join(content_parts)[:800],  # cap per-section
        })
 
    code_blocks = [
        cb.get_text() for cb in soup.find_all("code")
        if len(cb.get_text()) > 30
    ][:10]  # at most 10 examples
 
    return {
        "title": title,
        "url": source_url,
        "sections": sections[:40],
        "code_blocks": code_blocks,
    }
```
 
### Step 3: Sanitise Before Writing
 
All extracted text must be sanitised before it is embedded in the generated SKILL.md. This prevents scraped content from injecting instructions into the skill.
 
```python
import re
 
# Characters and patterns that could be interpreted as YAML control flow or
# markdown front-matter delimiters
_YAML_INJECTION = re.compile(r"^---", re.MULTILINE)
_NULL_BYTES = re.compile(r"\x00")
 
def sanitise(text: str) -> str:
    text = _NULL_BYTES.sub("", text)
    text = _YAML_INJECTION.sub("\\-\\-\\-", text)
    # Collapse excessive whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
```
 
Call `sanitise()` on **every string** from `extract_doc()` before writing it into SKILL.md.
 
### Step 4: Generate SKILL.md
 
```python
import yaml
 
def build_skill_md(doc: dict) -> str:
    title = sanitise(doc["title"])
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
 
    # Build description from first meaningful section
    intro = ""
    for s in doc["sections"]:
        if len(s["content"]) > 80:
            intro = sanitise(s["content"])[:400]
            break
 
    purpose_hint = intro or f"Interact with {title} APIs and documentation."
    description = (
        f"Work with {title} ({doc['url']}). "
        f"{purpose_hint} "
        f"Use this skill whenever the user wants to integrate, call, or understand {title}. "
        f"Triggers on mentions of '{title}', related API methods, or direct links to these docs."
    )
    description = description[:1021] + "..." if len(description) > 1024 else description
    if len(description) < 200:
        description += f" Auto-generated from {doc['url']}."
 
    frontmatter = yaml.dump({"name": slug, "description": description}, default_flow_style=False)
 
    section_body = "\n\n".join(
        f"{'#' * (int(s['level'][1]) + 1)} {sanitise(s['title'])}\n\n{sanitise(s['content'])}"
        for s in doc["sections"]
        if s["content"]
    )
 
    examples_body = "\n\n".join(
        f"```\n{sanitise(cb)}\n```" for cb in doc["code_blocks"]
    ) or "_No code examples extracted._"
 
    return f"""---
{frontmatter}---
 
# {title}
 
> Auto-generated from {doc['url']}  
> **Review this file before use** — verify accuracy and remove any sections that do not apply.
 
## Purpose
 
{purpose_hint}
 
## Key Sections
 
{section_body}
 
## Code Examples
 
{examples_body}
 
## Dependencies
 
_Review and fill in manually._
 
## Version
 
v1.0.0 (auto-generated)
"""
```
 
### Step 5: Validate Output
 
```python
def validate_skill_md(content: str) -> None:
    parts = content.split("---\n", 2)
    assert len(parts) >= 3, "Frontmatter block missing."
    fm = yaml.safe_load(parts[1])
    assert "name" in fm and "description" in fm, "name and description required."
    desc_len = len(fm["description"])
    assert 200 <= desc_len <= 1024, f"Description length {desc_len} out of range [200, 1024]."
    assert fm["name"] == fm["name"].lower(), "name must be lowercase."
    assert "_" not in fm["name"], "Use hyphens, not underscores in name."
```
 
---
 
## Full Usage Example
 
```python
url = "https://stripe.com/docs/api/payment_intents"
soup = fetch_doc(url)          # validates URL + robots.txt, fetches with timeout
doc  = extract_doc(soup, url)  # extracts structure
md   = build_skill_md(doc)     # sanitises + generates SKILL.md
validate_skill_md(md)          # asserts spec compliance
print(md)
```
 
Save the output to `<skill-name>/SKILL.md` and review manually before installing.
 
---
 
## Best Practices
 
- **Always review generated output** — auto-generated skills may contain inaccuracies or irrelevant sections.
- **One scrape per session** — cache locally; don't repeatedly hit the same URL.
- **Rate limiting** — add `time.sleep(1)` between multiple URL fetches.
- **Attribution** — preserve the source URL in the generated file (already included above).
- **SPA / JS-rendered pages** — `requests` + BeautifulSoup only works on server-rendered HTML. For JS-heavy docs, use `playwright` or fetch the raw Markdown source from GitHub instead.
---
 
## Dependencies
 
- Python 3.8+
- `beautifulsoup4` — HTML parsing
- `requests` — HTTP client
- `pyyaml` — YAML serialisation
## Version
 
v2.0.0
 