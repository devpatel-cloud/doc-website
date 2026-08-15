# Production Server Deployment Guide — DocVault V2

Complete step-by-step production deployment guide for **DocVault V2** on Ubuntu 22.04 / 24.04 LTS Linux servers using **Docker Compose**, **Nginx**, **FastAPI**, and **Let's Encrypt HTTPS**.

---

## 🔒 Document Directory Permissions (Least-Privilege Model)

To allow the non-root FastAPI process (`UID 100` / `GID 101`) to write uploaded files while preserving owner access for host user (`dev_patel`) and read-only access for Nginx, run these three commands on your server in `/opt/docvault`:

```bash
# 1. Assign group ownership of ./documents to GID 101 (appgroup / nginx)
sudo chown -R $USER:101 ./documents

# 2. Set mode 775 (Owner: rwx, Group 101: rwx, Others: r-x)
sudo chmod -R 775 ./documents

# 3. Enable setgid bit so all newly created subfolders automatically inherit GID 101
sudo chmod g+s ./documents
```

> [!IMPORTANT]
> **Why This Works**:
> - Group GID `101` is shared between FastAPI (`appuser`, `UID 100:GID 101`) and Nginx (`nginx`, `UID 101:GID 101`).
> - Mode `775` grants group write permissions without exposing `777` permissions to other users.
> - The `setgid` bit (`g+s`) ensures any new folder created by FastAPI or the host user automatically inherits group `101` and mode `775`.

---

## 📋 Environment Configuration & Secret Setup

### 1. Copy Environment Template
On your production server, copy `.env.example` to create `.env`:

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

## 🔍 Verification & Troubleshooting

### Check Container Write Access
Run the touch permission check inside the container:

```bash
docker exec docvault-fastapi touch /documents/.upload-permission-test
docker exec docvault-fastapi rm /documents/.upload-permission-test
```

### Troubleshooting "Permission Denied" Error
If an upload returns `HTTP 500: Permission denied writing to folder...`, re-run the group ownership setup:

```bash
sudo chown -R $USER:101 ./documents
sudo chmod -R 775 ./documents
sudo chmod g+s ./documents
```
