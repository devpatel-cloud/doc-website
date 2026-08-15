# Production Server Deployment Guide — DocVault V2

Complete step-by-step production deployment guide for **DocVault V2** on Ubuntu 22.04 / 24.04 LTS Linux servers using **Docker Compose**, **Nginx**, **FastAPI**, and **Let's Encrypt HTTPS**.

---

## 📋 Environment Configuration & Secret Setup

### 1. Copy Environment Template
On your production server, copy the template file `.env.example` to create your server-side `.env`:

```bash
cp .env.example .env
```

### 2. Configure Production Secrets
Edit `.env` to set your strong production administrator password and custom limits:

```bash
nano .env
```

Set the environment variables:

```env
# Administrator Password for Web Portal Uploads (REQUIRED IN PRODUCTION)
DOCVAULT_ADMIN_PASSWORD=YourStrongProductionPassword123!

# Maximum Allowed Upload File Size in Megabytes
DOCVAULT_MAX_FILE_SIZE_MB=100

# Minimum Free Disk Space Threshold in Gigabytes before rejecting uploads
DOCVAULT_MIN_FREE_DISK_GB=1.0

# Cryptographically Secret Session Key
DOCVAULT_SESSION_SECRET=GenerateRandomSecretString64CharsLong
```

> [!IMPORTANT]
> **Zero Password Hardcoding**: `DOCVAULT_ADMIN_PASSWORD` is supplied strictly through `.env` (or environment). Never commit `.env` to Git repository.

### 3. Restrict File Permissions
Apply strict file permissions so only the owner can read/write `.env`:

```bash
chmod 600 .env
```

---

## 🚀 Deployment Commands

### 1. Validate Docker Compose Config
Verify that Docker Compose recognizes your environment variables and YAML structure:

```bash
docker compose config
```

### 2. Build Container Images
Build the FastAPI container image:

```bash
docker compose build
```

### 3. Launch Services in Background
Start both containers in detached mode:

```bash
docker compose up -d
```

### 4. Verify Container Health Status
Confirm that both `docvault-fastapi` and `lightweight-document-server` containers are running and healthy:

```bash
docker compose ps
```

Expected output:
```text
NAME                          STATUS
docvault-fastapi              Up (healthy)
lightweight-document-server   Up (healthy)
```

---

## 🔍 Diagnostic & Verification Commands

### Inspect Container Logs
If a container fails to start, inspect detailed logs:

```bash
# FastAPI backend logs
docker compose logs fastapi

# Nginx web server logs
docker compose logs document-server
```

### Test FastAPI Internal Health Endpoint
Verify that FastAPI's internal health check endpoint responds:

```bash
docker exec docvault-fastapi python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/auth/status').read().decode())"
```

Expected output:
```json
{"authenticated": false}
```

### Test Administrator Upload via Web Browser
1. Open `http://your-server-ip` or `https://docs.yourdomain.com` in your browser.
2. Click **Upload** in the header navigation bar.
3. Enter your production password (configured in `DOCVAULT_ADMIN_PASSWORD`).
4. Choose target destination folder (e.g. `DevOps`).
5. Drag and drop your documents/videos and click **Start Upload**.
