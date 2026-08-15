# Production Server Deployment Guide — DocVault V2

Complete step-by-step production deployment guide for **DocVault V2** on Ubuntu 22.04 / 24.04 LTS Linux servers using **Docker Compose**, **Nginx**, **FastAPI**, and **Let's Encrypt HTTPS**.

---

## 🔒 Document Directory Permissions (Least-Privilege Model)

To allow the non-root FastAPI process (`UID 100` / `GID 101`) to write uploaded files while preserving owner access for host user (`dev_patel`) and read-only access for Nginx, configure Linux group permissions on `./documents`:

```bash
# 1. Set group ownership of ./documents to GID 101 (appgroup / nginx)
sudo chown -R $USER:101 ./documents

# 2. Set mode 775 (Owner: rwx, Group 101: rwx, Others: r-x)
sudo chmod -R 775 ./documents

# 3. Enable setgid bit so all newly created subfolders automatically inherit GID 101
sudo chmod g+s ./documents
```

> [!IMPORTANT]
> **Least Privilege Assurance**:
> - NO `chmod 777` or `chmod -R 777` permissions are used.
> - FastAPI container runs as non-root user `appuser` (`UID 100`, `GID 101`).
> - Nginx container mounts `./documents` as read-only (`:ro`).
> - All uploaded files are assigned mode `664` (`rw-rw-r--`) non-executable permissions.

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

### 3. Restrict File Permissions
Apply strict file permissions so only the owner can read/write `.env`:

```bash
chmod 600 .env
```

---

## 🚀 Deployment Commands

```bash
# 1. Validate Docker Compose config
docker compose config

# 2. Build container images
docker compose build

# 3. Launch services in background
docker compose up -d

# 4. Verify container status
docker compose ps

# 5. Check FastAPI logs
docker compose logs fastapi --tail=50
```

---

## 🔍 Verification & Health Checks

### Test Container Write Permissions
Run the touch permission check inside the container:

```bash
docker exec docvault-fastapi touch /documents/.upload-permission-test
docker exec docvault-fastapi rm /documents/.upload-permission-test
```

### Test Web Uploads via Browser
1. Open `https://docs.yourdomain.com` in your browser.
2. Click **Upload** -> Enter production password -> Select destination folder -> Upload file.
