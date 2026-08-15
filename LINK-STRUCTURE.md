# DocVault V2 — Complete Link & URL Architecture Structure

This document outlines the complete URL routing, API link structure, public document endpoints, and Nginx reverse proxy mapping for **DocVault V2**.

---

## 1. Public Visitor Frontend Navigation Links (Client-Side Hash Routing)

The frontend uses clean URL Hash Navigation. Public users can bookmark or share direct links to any folder:

| Navigation Location | URL Link Format | Example |
|---|---|---|
| **Root Documents Folder** | `http://<domain>/#/` | `http://localhost:8085/#/` |
| **Category Folder** | `http://<domain>/#/<folder>` | `http://localhost:8085/#/Linux` |
| **Nested Subfolder** | `http://<domain>/#/<folder>/<subfolder>` | `http://localhost:8085/#/Linux/RHCSA` |
| **Deep Subfolder** | `http://<domain>/#/<folder>/<subfolder>/<child>` | `http://localhost:8085/#/DevOps/Docker/Security` |

---

## 2. Direct Document & Asset Links (Served Directly by Nginx)

Nginx serves files directly from `/var/www/documents/` for maximum performance, inline browser viewing, and high-speed downloads:

| File Type | URL Link Format | Example |
|---|---|---|
| **PDF Document** | `http://<domain>/documents/<path>/<file>.pdf` | `http://localhost:8085/documents/Linux/Linux-Commands-Guide.pdf` |
| **Text / Notes** | `http://<domain>/documents/<path>/<file>.txt` | `http://localhost:8085/documents/Linux/RHCSA/Task1-UserManagement.txt` |
| **Markdown Guide** | `http://<domain>/documents/<path>/<file>.md` | `http://localhost:8085/documents/DevOps/Docker-CheatSheet.md` |
| **Spreadsheet / CSV** | `http://<domain>/documents/<path>/<file>.csv` | `http://localhost:8085/documents/AWS/S3-Best-Practices.csv` |
| **JSON Data** | `http://<domain>/documents/<path>/<file>.json` | `http://localhost:8085/documents/AWS/EC2-Architecture.json` |
| **MP4 / WebM Video** | `http://<domain>/documents/<path>/<video>.mp4` | `http://localhost:8085/documents/DevOps/tutorial.mp4` |

---

## 3. Public Directory Listing API Links (Nginx Autoindex JSON)

Nginx's native `autoindex_format json;` returns folder and file listings dynamically without database queries:

| API Endpoint | Method | Response Description |
|---|---|---|
| `http://<domain>/api/documents/` | `GET` | Returns JSON array of items in Root directory |
| `http://<domain>/api/documents/Linux/` | `GET` | Returns JSON array of items in `/Linux/` folder |
| `http://<domain>/api/documents/Linux/RHCSA/` | `GET` | Returns JSON array of items in `/Linux/RHCSA/` folder |

---

## 4. Administrator API Endpoints (FastAPI Container via Nginx Proxy)

Admin endpoints require authentication via HTTP-only session cookie (`docvault_session`) set upon login:

| Endpoint | Method | Auth Required | Purpose |
|---|---|---|---|
| `/api/auth/login` | `POST` | ❌ No | Authenticates admin password (`devpatel`), sets `docvault_session` cookie |
| `/api/auth/logout` | `POST` | ❌ No | Clears `docvault_session` cookie |
| `/api/auth/status` | `GET` | ❌ No | Checks whether client session cookie is valid (`{"authenticated": true/false}`) |
| `/api/folders` | `GET` | ❌ No | Returns recursive nested JSON folder tree for admin destination folder picker |
| `/api/upload` | `POST` | ✅ Yes | Uploads files to target server folder path with size & extension validation |

---

## 5. Nginx Reverse Proxy Routing Diagram

```text
                                  INTERNET
                                     │
                                     ▼
                            ┌──────────────────┐
                            │      NGINX       │
                            │    Port 80/443   │
                            └────────┬─────────┘
                                     │
     ┌───────────────────────────────┼───────────────────────────────┐
     │                               │                               │
     ▼                               ▼                               ▼
GET /                           GET /documents/*                GET /api/documents/*
Static UI Website               Direct File Delivery            Nginx Autoindex JSON
(index.html, JS, CSS)           (PDFs, Videos, CSVs)            (Directory Listings)
[Nginx Root]                    [Nginx Alias]                   [Nginx Alias]
     │                               │                               │
     └───────────────────────────────┼───────────────────────────────┘
                                     │
                                     ▼
                       POST /api/auth/login
                       POST /api/auth/logout
                       GET  /api/auth/status
                       GET  /api/folders
                       POST /api/upload
                                     │
                             FastAPI Container
                            (http://fastapi:8000)
                                     │
                                     ▼
                              Host Filesystem
                                /documents/
```

---

## 6. Security & Access Rules Summary

- **Public URLs (`/`, `/documents/*`, `/api/documents/*`)**: Unrestricted public access. Direct high-speed Nginx file serving.
- **Admin API URLs (`/api/auth/*`, `/api/folders`, `/api/upload`)**: Protected by FastAPI & Nginx reverse proxy. Brute-force rate limiting (5 req/min on login). Upload path sanitization & file extension whitelist.
