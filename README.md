# Lightweight Public Document Explorer — DocVault V2

A minimal, high-performance, containerized public document portal powered by **Docker**, **Nginx**, **FastAPI**, and **Vanilla HTML5/CSS/JavaScript**.

The server's **filesystem structure automatically controls the website structure**.

For complete security audit matrix and defense-in-depth report, see **[SECURITY-AUDIT.md](SECURITY-AUDIT.md)**.
For complete URL routing and API endpoints, see **[LINK-STRUCTURE.md](LINK-STRUCTURE.md)**.
For step-by-step production server setup with HTTPS & domain names, see **[SERVER-SETUP.md](SERVER-SETUP.md)**.

---

## 🌟 What's New in V2

- 🔐 **Password-Protected Admin Upload System**: Click `Upload` in the header, enter password (`devpatel` configured in `.env`), and upload files directly from the browser.
- 📁 **Interactive Destination Folder Tree**: Choose the destination folder from an automatically rendered server folder tree before uploading.
- 📤 **Drag & Drop Multi-File Uploads**: Drag and drop multiple documents or videos with real-time percentage progress bars.
- 🎬 **Native Video Player Support**: Browser preview modal plays `.mp4` and `.webm` videos directly with native HTML5 controls; download links provided for `.mkv`, `.avi`, `.mov`.
- 🛡️ **Duplicate File & Security Validation**:
  - File extension whitelist & path traversal prevention.
  - Interactive prompt when uploading duplicate files ("Replace / Skip").
  - 100MB configurable upload file size limit (`MAX_FILE_SIZE_MB`).
  - Brute-force rate limiting on login attempts.
- 🙈 **Git Document Isolation**: Actual documents in `documents/` are excluded from Git via `.gitignore` (`!documents/.gitkeep`), so `git pull` on the server will **never** delete or overwrite your published files.

---

## 📁 V2 Architecture & Project Structure

```text
doc-website/
├── docker-compose.yml       # Docker Compose setup (Nginx + FastAPI)
├── .env                     # Admin password & upload configuration
├── .gitignore               # Keeps actual documents out of Git
├── README.md                # Project documentation
├── SERVER-SETUP.md          # Production Linux server deployment guide
├── app/                     # FastAPI Admin Backend Service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py              # Auth, Folder Tree API, Upload validation logic
├── nginx/
│   └── nginx.conf           # Security headers, static serving, /api/ reverse proxy
├── website/                 # Web Application Frontend
│   ├── index.html           # Public UI + Admin Upload Drawer + Video Modal
│   ├── style.css            # Responsive Vanilla CSS stylesheet
│   └── script.js            # Vanilla JS folder traversal & upload queue engine
└── documents/               # Public document repository (Host mounted)
    └── .gitkeep
```

---

## 🚀 Quick Start (Local Development)

### 1. Launch Services
Run from the project root:

```bash
docker compose up -d --build
```

### 2. Access Web Portal
Open your browser and visit:

```text
http://localhost:8085
```

### 3. Test Admin Upload
1. Click the **Upload** button in the top header.
2. Enter password: `devpatel` (or value set in `.env`).
3. Select your target folder (e.g. `DevOps`).
4. Drag & drop files or click **Choose Files**, then click **Start Upload**.

---

## ⚙️ Environment Configuration (`.env`)

On your server, create `.env` from the provided template `.env.example`:

```bash
cp .env.example .env
chmod 600 .env
```

Customize administrator settings in `.env`:

```env
DOCVAULT_ADMIN_PASSWORD=YourStrongProductionPassword123!
DOCVAULT_MAX_FILE_SIZE_MB=100
DOCVAULT_MIN_FREE_DISK_GB=1.0
DOCVAULT_SESSION_SECRET=GenerateRandomSecretString64CharsLong
```

---

## 🔒 Security Summary

1. **Public Reading**: Public users browse, search, preview, and download documents without logging in.
2. **Admin Uploading**: Only requests with valid HTTP-only session cookies can post uploads or view folder trees.
3. **Nginx Direct File Serving**: Nginx directly streams large PDFs, ZIPs, and video files to clients without passing through Python/FastAPI.
4. **Read-Only Nginx Mount**: Nginx container volume is `:ro`, while FastAPI volume is `:rw`.
5. **Path Traversal Shield**: Resolves canonical target paths to ensure uploaded files can never escape `/documents`.
