# Production Server Setup Guide — DocVault V2

Complete production deployment guide for **DocVault V2** on Ubuntu 22.04 / 24.04 LTS servers with **Docker**, **Nginx**, **FastAPI**, **Let's Encrypt HTTPS**, and **UFW Firewall**.

---

## 📋 Prerequisites

1. Linux server with root or `sudo` access.
2. Domain name (e.g. `docs.yourdomain.com`) pointing to server Public IP (`A` record) and IPv6 (`AAAA` record).
3. Open ports: `80` (HTTP), `443` (HTTPS), `22` (SSH).

---

## 🛠️ Step 1: Server Setup & Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw certbot

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 📂 Step 2: Clone & Environment Configuration

Create application directory `/opt/docvault`:

```bash
sudo mkdir -p /opt/docvault
sudo chown -R $USER:$USER /opt/docvault
cd /opt/docvault

# Clone repository
git clone https://github.com/yourusername/doc-website.git .
```

Create production `.env` file:

```bash
nano .env
```

Add your secure password:

```env
UPLOAD_PASSWORD=YourStrongProductionPassword123!
MAX_FILE_SIZE_MB=100
SESSION_SECRET=GenerateRandomSecretString64CharsLong
```

---

## 🔑 Step 3: SSL Certificate Setup (Let's Encrypt)

```bash
sudo certbot certonly --standalone -d docs.yourdomain.com
```

---

## ⚙️ Step 4: Configure Production Docker Compose & Nginx

### 1. Update `docker-compose.yml` Ports
Edit `docker-compose.yml` to bind Nginx to ports `80` and `443`:

```yaml
services:
  fastapi:
    build: ./app
    container_name: docvault-fastapi
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./documents:/documents:rw
    expose:
      - "8000"

  document-server:
    image: nginx:1.25-alpine
    container_name: docvault-server
    restart: unless-stopped
    depends_on:
      - fastapi
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./website:/var/www/website:ro
      - ./documents:/var/www/documents:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

### 2. Configure `nginx/nginx.conf` for Production HTTPS

Ensure `nginx/nginx.conf` includes your SSL certificates:

```nginx
server {
    listen 80;
    server_name docs.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name docs.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/docs.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docs.yourdomain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Include standard V2 locations for /, /api/documents/, /api/, and /documents/
}
```

---

## 🚀 Step 5: Launch Services

```bash
# Enable Firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Launch Docker Compose
docker compose up -d --build

# Verify Container Status
docker compose ps
```

---

## 🔄 Step 6: Git Pull & Deployment Safety

When updating the application code in production:

```bash
cd /opt/docvault
git pull
docker compose up -d --build
```

> [!IMPORTANT]
> Because `.gitignore` excludes `documents/*`, running `git pull` will **never** delete, overwrite, or modify your published documents on the server!
