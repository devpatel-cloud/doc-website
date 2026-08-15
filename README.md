# Lightweight Public Document Explorer — Folder-Based System

A minimal, high-performance, containerized public document portal powered by **Docker**, **Nginx**, and **Vanilla HTML5/CSS/JavaScript**.

The server's **filesystem structure automatically controls the website structure**.

For step-by-step production server setup with HTTPS & domain names, see **[SERVER-SETUP.md](SERVER-SETUP.md)**.

---

## 🌟 Key Features

- 📁 **Folder-Based Hierarchy**: Folders and subfolders inside `./documents/` automatically appear as categories and subcategories on the website.
- ⚡ **Zero Rebuild Management**: Create folders or drop files into `./documents/`—changes reflect immediately upon browser refresh!
- 🥖 **Interactive Breadcrumb Navigation**: Easily jump back and forth between parent and child directories (`Documents > Linux > RHCSA`).
- 🔍 **Live Search**: Instant search by folder name, file name, or extension.
- 👁️ **In-Browser Document Preview**: Built-in modal viewer for PDFs, images, text, Markdown, JSON, and CSV files.
- 📱 **Modern & Responsive UI**: Clean light theme with Grid and List views, responsive on desktop and mobile.
- 🔒 **Production Security**: Security headers (CSP, X-Frame-Options, X-Content-Type-Options), rate limiting, read-only volume mounts, path traversal prevention, and blocked non-GET HTTP methods.

---

## 📂 Example Folder Structure

```text
documents/
├── Linux/
│   ├── RHCSA/
│   │   ├── Task1-UserManagement.txt
│   │   └── Task2-Permissions.txt
│   └── Linux-Commands-Guide.pdf
├── AWS/
│   ├── EC2-Architecture.json
│   └── S3-Best-Practices.csv
├── DevOps/
│   ├── Docker-CheatSheet.md
│   └── Kubernetes-Setup.txt
└── Empty-Folder/
```

The website automatically renders:

```text
Documents

📁 Linux
📁 AWS
📁 DevOps
📁 Empty-Folder
```

Opening `Linux` displays:

```text
Documents / Linux

← Back

📁 RHCSA
📄 Linux-Commands-Guide.pdf
📄 Linux-Commands-Guide.txt
```

Opening `RHCSA` displays:

```text
Documents / Linux / RHCSA

← Back

📄 Task1-UserManagement.txt
📄 Task2-Permissions.txt
```

---

## 🚀 Quick Start (Local Development & Testing)

### 1. Launch Container
Run from the project root:

```bash
docker compose up -d
```

### 2. Access Web Portal
Open your browser and visit:

```text
http://localhost:8085
```

---

## 📄 Administrator Document Workflow

No code changes or container rebuilds are required.

### Create a Category Folder
```bash
mkdir documents/Networking
```

### Create a Subcategory Folder
```bash
mkdir documents/Linux/RHCE
```

### Add a Document
```bash
cp /path/to/guide.pdf documents/Linux/RHCE/
```

### Remove a Document or Folder
```bash
rm documents/Linux/old-file.pdf
rm -r documents/OldFolder
```

Refresh your browser window to see the updated folder structure immediately.

---

## 🔒 Production Deployment & HTTPS Setup

### 1. Configure Ports in `docker-compose.yml`
In production, map port `80` and `443` directly:

```yaml
ports:
  - "80:80"
  - "443:443"
```

### 2. HTTPS with Let's Encrypt (Certbot)

1. Obtain certificate using standalone mode:
   ```bash
   sudo certbot certonly --standalone -d your-domain.com
   ```
2. Mount certificates into Nginx in `docker-compose.yml`:
   ```yaml
   volumes:
     - /etc/letsencrypt:/etc/letsencrypt:ro
   ```
3. Enable SSL server block in `nginx/nginx.conf`.

---

## 💾 Backup

To create a full backup of all documents and configuration:

```bash
tar -czvf docvault-backup-$(date +%F).tar.gz documents/ website/ nginx/ docker-compose.yml
```
