# Complete Production Server Setup Guide — DocVault Document Portal

This guide provides step-by-step instructions to deploy the **DocVault Public Document Portal** on a fresh production Linux server (Ubuntu 22.04 LTS / 24.04 LTS, Debian, or RHEL) with **Docker**, **Nginx**, **HTTPS (Let's Encrypt)**, and **UFW Firewall security**.

---

## 📋 Prerequisites

Before starting, ensure you have:
1. A Linux server (VPS or Dedicated) with `sudo` root access.
2. A registered domain name (e.g., `docs.yourdomain.com`).
3. An **A Record** in your DNS provider pointing `docs.yourdomain.com` to your server's Public IP address.

---

## 🛠️ Step 1: Server Preparation & Tool Installation

Log into your server via SSH:

```bash
ssh user@your-server-ip
```

Update system packages and install prerequisites:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw tar ca-certificates certbot
```

### Install Docker & Docker Compose

Install Docker using the official installation script:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to the docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify installation
docker --version
docker compose version
```

---

## 📂 Step 2: Set Up Directory Structure

Create a dedicated deployment directory under `/opt/docvault`:

```bash
sudo mkdir -p /opt/docvault/{nginx,website,documents}
sudo chown -R $USER:$USER /opt/docvault
cd /opt/docvault
```

Copy your project files into `/opt/docvault`:

```text
/opt/docvault/
├── docker-compose.yml
├── SERVER-SETUP.md
├── README.md
├── nginx/
│   └── nginx.conf
├── website/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── documents/
    ├── Linux/
    │   ├── RHCSA/
    │   └── Commands.pdf
    ├── AWS/
    └── DevOps/
```

---

## 🔑 Step 3: Obtain Free SSL Certificate (Let's Encrypt)

Obtain a free SSL certificate using Certbot in standalone mode:

```bash
# Stop any temporary web servers running on port 80
sudo certbot certonly --standalone -d docs.yourdomain.com
```

Your SSL certificates will be saved to:
- **Fullchain**: `/etc/letsencrypt/live/docs.yourdomain.com/fullchain.pem`
- **PrivateKey**: `/etc/letsencrypt/live/docs.yourdomain.com/privkey.pem`

---

## ⚙️ Step 4: Configure Production Nginx & Docker Compose

### 1. Update `docker-compose.yml` for Production

Edit `docker-compose.yml`:

```bash
nano docker-compose.yml
```

Replace contents with the production configuration:

```yaml
services:
  document-server:
    image: nginx:1.25-alpine
    container_name: docvault-server
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./website:/var/www/website:ro
      - ./documents:/var/www/documents:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    environment:
      - TZ=UTC
    healthcheck:
      test: ["CMD", "nginx", "-t"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 2. Configure `nginx/nginx.conf` with HTTPS Redirect

Edit `nginx/nginx.conf`:

```bash
nano nginx/nginx.conf
```

Add your domain name and SSL configuration:

```nginx
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
    use epoll;
    multi_accept on;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    tcp_nodelay     on;
    keepalive_timeout  65;
    server_tokens off;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/pdf;

    # Rate limiting zone
    limit_req_zone $binary_remote_addr zone=req_limit:10m rate=10r/s;

    # HTTP Server Block: Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name docs.yourdomain.com;

        location /.well-known/acme-challenge/ {
            root /var/www/website;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS Server Block
    server {
        listen 443 ssl http2;
        server_name docs.yourdomain.com;

        root /var/www/website;
        index index.html;

        # SSL Certificate Paths
        ssl_certificate /etc/letsencrypt/live/docs.yourdomain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/docs.yourdomain.com/privkey.pem;

        # Modern SSL Security Hardening
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 1d;

        # Security Headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; object-src 'self' blob:; frame-src 'self' blob:;" always;

        # Restrict HTTP methods (Read-only document portal)
        if ($request_method !~ ^(GET|HEAD)$ ) {
            return 405;
        }

        # Prevent Directory Traversal & Hidden File Access
        location ~ /\. {
            deny all;
            return 404;
        }

        # Static Web Application Files
        location / {
            try_files $uri $uri/ /index.html;
            limit_req zone=req_limit burst=20 nodelay;

            location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
                expires 7d;
                add_header Cache-Control "public, no-transform";
                add_header X-Frame-Options "SAMEORIGIN" always;
                add_header X-Content-Type-Options "nosniff" always;
            }
        }

        # Documents Directory Listing API (JSON format)
        location = /api/documents {
            alias /var/www/documents/;
            autoindex on;
            autoindex_format json;
            autoindex_exact_size on;
            autoindex_localtime on;
            limit_req zone=req_limit burst=30 nodelay;
        }

        location /api/documents/ {
            alias /var/www/documents/;
            autoindex on;
            autoindex_format json;
            autoindex_exact_size on;
            autoindex_localtime on;
            limit_req zone=req_limit burst=30 nodelay;
        }

        # Direct Document Access and Downloading
        location /documents/ {
            alias /var/www/documents/;
            autoindex on;
            autoindex_format json;
            autoindex_exact_size on;
            autoindex_localtime on;
            limit_req zone=req_limit burst=30 nodelay;

            types {
                application/pdf pdf;
                image/png png;
                image/jpeg jpg jpeg;
                image/svg+xml svg;
                image/webp webp;
                text/plain txt log md;
                application/json json;
                application/vnd.openxmlformats-officedocument.wordprocessingml.document docx;
                application/vnd.openxmlformats-officedocument.spreadsheetml.sheet xlsx;
                application/zip zip;
            }
            
            # Disable execution of scripts/binaries in documents directory
            location ~* \.(php|pl|py|jsp|asp|sh|cgi|bash|exe)$ {
                default_type text/plain;
                add_header Content-Disposition "attachment";
            }
        }
    }
}
```

---

## 🚀 Step 5: Start Service & Verify Firewall

### 1. Enable UFW Firewall

Configure firewall rules to open SSH, HTTP, and HTTPS:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

### 2. Launch Docker Container

Start the service in detached mode:

```bash
docker compose up -d
```

Check container health status:

```bash
docker compose ps
```

You should see:
```text
NAME             IMAGE               STATUS                   PORTS
docvault-server  nginx:1.25-alpine   Up 10 seconds (healthy)  0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

---

## 🔄 Step 6: SSL Auto-Renewal Setup

Let's Encrypt certificates expire every 90 days. Set up automatic renewal with Docker Nginx reload:

Edit system crontab:

```bash
sudo crontab -e
```

Add the following line to renew certificates daily at 3:00 AM and reload Nginx:

```cron
0 3 * * * certbot renew --quiet && docker compose -f /opt/docvault/docker-compose.yml exec -T document-server nginx -s reload
```

---

## 📁 Step 7: Managing Documents on Production

To publish new categories or documents on the live server:

### Create a new folder
```bash
mkdir -p /opt/docvault/documents/CyberSecurity/Certifications
```

### Upload files via SCP / SFTP
From your local machine:

```bash
scp /path/to/security-notes.pdf user@your-server-ip:/opt/docvault/documents/CyberSecurity/
```

The new files and subfolders appear on `https://docs.yourdomain.com` immediately upon refreshing the page!

---

## 💾 Step 8: Automated Daily Backups

Set up an automated daily backup of your documents:

Create a backup script at `/opt/docvault/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/docvault"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y-%m-%d)

tar -czf $BACKUP_DIR/docvault-documents-$TIMESTAMP.tar.gz -C /opt/docvault documents/

# Retain backups for 30 days
find $BACKUP_DIR -name "docvault-documents-*.tar.gz" -mtime +30 -delete
```

Make it executable:

```bash
chmod +x /opt/docvault/backup.sh
```

Add to root crontab (`sudo crontab -e`):

```cron
0 2 * * * /opt/docvault/backup.sh
```
