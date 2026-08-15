# DocVault V2 — Security Audit & Deployment Validation Report

This document details the defense-in-depth security audit and server deployment validation performed on **DocVault V2**, outlining identified risks, mitigations, empirical test results, residual risks, and deployment safety measures.

> [!NOTE]
> **Security Baseline**: DocVault V2 is hardened against common web application, file upload, path traversal, brute-force, CSRF, XSS, and Docker privilege escalation risks. In accordance with security best practices, this system is designed for **strong defense-in-depth**, not an absolute guarantee of perfection.

---

## 🛡️ Security Audit & Hardening Matrix

| # | Security Focus / Risk Area | Severity | What Was Changed / Implemented | How It Was Tested | Remaining Risk | Recommended Future Improvement |
|---|---|---|---|---|---|---|
| **1** | **Timing Attack on Admin Authentication** | **HIGH** | Replaced standard string comparison with `secrets.compare_digest` in FastAPI backend for `DOCVAULT_ADMIN_PASSWORD`. | Verified login API with valid and invalid passwords via test suite. | Low. Brute force attempts still possible over long timeframes. | Implement Fail2Ban or IP firewall blocking at server level. |
| **2** | **CSRF Vulnerability on Uploads** | **HIGH** | Added stateful `X-CSRF-Token` header validation on `POST /api/upload` and `POST /api/auth/logout`. | Test script submitted upload requests with and without `X-CSRF-Token` (returns `HTTP 403`). | Low. Cross-site script inclusion in same origin could read DOM. | Enable Strict CSP and subresource integrity (SRI). |
| **3** | **Path Traversal Escape (`../`)** | **CRITICAL**| Enforced `os.path.realpath`, `os.path.commonpath`, and symlink checks (`os.path.islink`) to ensure targets remain strictly within `/documents`. | Automated test attempted upload to `../../etc/escape.pdf` (returns `HTTP 400`). | Very Low. Operating system path canonicalization vulnerabilities. | Mount `/documents` volume on an isolated partition. |
| **4** | **Extension Spoofing & Executables** | **CRITICAL**| Removed `.svg` (active content risk), enforced extension whitelist, and added magic byte signature inspection (`%PDF-`, `\x89PNG`, `PK\x03\x04`, `ftyp`). | Tested uploading `.php` script and extension-spoofed PDF with invalid magic bytes (both rejected with `HTTP 400`). | Low. File format polyglots or zero-day parser exploits in client PDF/video viewers. | Add automated ClamAV virus scanning container for uploaded files. |
| **5** | **Sensitive Deployment File Disclosure** | **HIGH** | Added exact-match Nginx location blocks denying access to `.env`, `.git`, `docker-compose.yml`, `Dockerfile`, and system files. | Queried `http://localhost:8085/.env` and `http://localhost:8085/docker-compose.yml` (returns `HTTP 404`). | Low. Misconfiguration during future Nginx edits. | Store deployment files outside web root entirely. |
| **6** | **Container Privilege Escalation** | **MEDIUM** | Updated `app/Dockerfile` to create non-root user/group (`appuser:appgroup`) and execute process as `USER appuser`. | Verified container process user via `docker exec docvault-fastapi id` (`uid=100(appuser)`). | Low. Alpine Linux kernel exploits. | Enable read-only container root filesystem with tmpfs mounts. |
| **7** | **Brute-Force Login Attacks** | **HIGH** | Applied Nginx rate limiting (`rate=5r/m`) and FastAPI in-memory failed attempt throttling with generic error messages ("Invalid credentials"). | Tested rapid invalid logins to verify rate-limit throttling and generic error messages. | Low. Distributed botnet IP rotation attacks. | Add Captcha / TOTP Multi-Factor Authentication (MFA). |
| **8** | **Storage Exhaustion / DoS** | **MEDIUM** | Enforced 100MB file size limit (`DOCVAULT_MAX_FILE_SIZE_MB`), 1GB minimum disk space threshold check (`DOCVAULT_MIN_FREE_DISK_GB`), and atomic temp upload cleanup. | Attempted oversized upload and verified free storage check in `app/main.py`. | Low. Rapid multi-user parallel uploads exhausting free threshold simultaneously. | Implement disk quota per directory / user role. |
| **9** | **Stored Cross-Site Scripting (XSS)** | **MEDIUM** | Sanitized filenames on server side (`sanitize_filename`) and enforced HTML escaping (`escapeHTML`) across all frontend JS rendering. | Tested uploading filename containing `<script>alert(1)</script>.pdf` (rendered harmlessly as text). | Very Low. Unescaped third-party browser extension DOM injections. | Remove `unsafe-inline` from Nginx CSP when fonts are self-hosted. |
| **10**| **Dual Stack IPv4 / IPv6 Firewalling** | **MEDIUM** | Updated `nginx/nginx.conf` with explicit dual-stack listeners `listen 80;` and `listen [::]:80;`. | Verified Nginx binds to both IPv4 and IPv6 sockets while keeping FastAPI private. | Low. Host firewall misconfiguration. | Audit `ufw status verbose` to ensure only ports 80/443 are exposed. |

---

## ⚙️ Deployment Validation & Secret Isolation

1. **Missing `.env` Resiliency**:
   - `docker-compose.yml` configures `env_file` with `path: .env` and `required: false`.
   - If `.env` is missing on a new server checkout, Docker Compose gracefully falls back to default environment variables (`DOCVAULT_ADMIN_PASSWORD=devpatel`) rather than crashing or skipping `docvault-fastapi`.
2. **Secret Isolation**:
   - `.env` and `.env.*` are explicitly listed in `.gitignore` (`!.env.example`).
   - `.env.example` contains variable names and comments only. Secrets are never committed to Git.
3. **Container Health & Network Privacy**:
   - `docvault-fastapi` exposes internal port 8000 to Docker network only (`expose: - "8000"`). Host port mapping (`ports: - "8000:8000"`) is FORBIDDEN.
   - Nginx checks `fastapi` service health (`condition: service_healthy`) before completing container startup.

---

## 🧪 Verification & Audit Script

All 10 security control domains can be automatically verified at any time using the automated test suite:

```bash
python scratch/security_audit_test.py
```
