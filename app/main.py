import os
import re
import shutil
import time
import secrets
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict

from fastapi import FastAPI, Request, Response, Depends, HTTPException, status, UploadFile, File, Form, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("docvault_backend")

# Standardized Environment Variables (with legacy fallbacks)
UPLOAD_PASSWORD = os.getenv("DOCVAULT_ADMIN_PASSWORD", os.getenv("UPLOAD_PASSWORD", "devpatel"))
MAX_FILE_SIZE_MB = int(os.getenv("DOCVAULT_MAX_FILE_SIZE_MB", os.getenv("MAX_FILE_SIZE_MB", "100")))
MIN_FREE_DISK_GB = float(os.getenv("DOCVAULT_MIN_FREE_DISK_GB", os.getenv("MIN_FREE_DISK_GB", "1.0")))
DOCUMENTS_DIR = os.path.realpath(os.getenv("DOCVAULT_DOCUMENTS_DIR", os.getenv("DOCUMENTS_DIR", "/documents")))
SESSION_SECRET = os.getenv("DOCVAULT_SESSION_SECRET", os.getenv("SESSION_SECRET", "docvault_secret_key_2026"))

# Session Store: session_token -> { "created": float, "csrf_token": str }
valid_sessions: Dict[str, dict] = {}
failed_login_attempts: Dict[str, dict] = {} # client_ip -> {count: int, timestamp: float}

# Whitelisted File Extensions (Note: .svg excluded for active content/XSS safety)
ALLOWED_EXTENSIONS = {
    # Documents
    "pdf", "txt", "md", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "json", "zip",
    # Images (Raster)
    "png", "jpg", "jpeg", "webp", "gif",
    # Videos
    "mp4", "webm", "mkv", "mov", "avi", "m4v", "3gp", "mpeg", "mpg", "ts"
}

app = FastAPI(title="DocVault Admin Upload API — Hardened V2", version="2.2.0")

class LoginRequest(BaseModel):
    password: str

def check_rate_limit(client_ip: str):
    now = time.time()
    record = failed_login_attempts.get(client_ip)
    if record:
        if now - record["timestamp"] < 60:
            if record["count"] >= 5:
                logger.warning(f"Throttling IP {client_ip} due to excessive failed login attempts.")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed login attempts. Please wait 60 seconds."
                )
        else:
            failed_login_attempts[client_ip] = {"count": 0, "timestamp": now}

def get_session_info(request: Request) -> Optional[dict]:
    session_id = request.cookies.get("docvault_session")
    if session_id and session_id in valid_sessions:
        return valid_sessions[session_id]
    return None

def require_auth(request: Request) -> dict:
    session = get_session_info(request)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    return session

def sanitize_filename(filename: str) -> str:
    """Strictly sanitize uploaded filename to prevent directory traversal and injection"""
    filename = os.path.basename(filename or "")
    filename = re.sub(r"[\x00-\x1f\x7f]", "", filename)
    filename = re.sub(r'[\\/:*?"<>|]', "_", filename)
    filename = filename.lstrip(".")
    if not filename:
        filename = f"file_{secrets.token_hex(4)}"
    return filename[:255]

def validate_magic_bytes(header_bytes: bytes, ext: str) -> bool:
    """Validate file magic byte signatures for common formats"""
    if ext == "pdf":
        return b"%PDF-" in header_bytes[:1024]
    elif ext == "png":
        return header_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    elif ext in ("jpg", "jpeg"):
        return header_bytes.startswith(b"\xff\xd8\xff")
    elif ext == "gif":
        return header_bytes.startswith(b"GIF87a") or header_bytes.startswith(b"GIF89a")
    elif ext == "webp":
        return b"RIFF" in header_bytes[:4] and b"WEBP" in header_bytes[8:12]
    elif ext in ("zip", "docx", "xlsx", "pptx"):
        return header_bytes.startswith(b"PK\x03\x04")
    elif ext in ("mp4", "mov"):
        return b"ftyp" in header_bytes[:32]
    return True

@app.post("/api/auth/login")
async def login(data: LoginRequest, request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip)

    # Constant-time password comparison against timing attacks
    if secrets.compare_digest(data.password, UPLOAD_PASSWORD):
        session_token = secrets.token_hex(32)
        csrf_token = secrets.token_hex(16)
        valid_sessions[session_token] = {
            "created": time.time(),
            "csrf_token": csrf_token
        }

        if client_ip in failed_login_attempts:
            del failed_login_attempts[client_ip]

        is_https = request.headers.get("X-Forwarded-Proto") == "https" or request.url.scheme == "https"

        response.set_cookie(
            key="docvault_session",
            value=session_token,
            httponly=True,
            samesite="lax",
            secure=is_https,
            path="/"
        )
        logger.info(f"[AUTH SUCCESS] Admin login from IP: {client_ip}")
        return {
            "status": "success",
            "message": "Authentication successful",
            "csrfToken": csrf_token
        }
    else:
        now = time.time()
        record = failed_login_attempts.get(client_ip, {"count": 0, "timestamp": now})
        record["count"] += 1
        record["timestamp"] = now
        failed_login_attempts[client_ip] = record
        
        logger.warning(f"[AUTH FAILURE] Invalid credentials attempt from IP: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    session_id = request.cookies.get("docvault_session")
    if session_id and session_id in valid_sessions:
        del valid_sessions[session_id]
    response.delete_cookie("docvault_session", path="/")
    return {"status": "success", "message": "Logged out"}

@app.get("/api/auth/status")
async def auth_status(request: Request):
    session = get_session_info(request)
    if session:
        return {"authenticated": True, "csrfToken": session["csrf_token"]}
    return {"authenticated": False}

@app.get("/api/folders")
async def get_folder_tree():
    """Build and return nested folder tree from /documents directory"""
    if not os.path.exists(DOCUMENTS_DIR):
        os.makedirs(DOCUMENTS_DIR, exist_ok=True)

    def scan_dir(rel_path: str = ""):
        abs_path = os.path.realpath(os.path.join(DOCUMENTS_DIR, rel_path)) if rel_path else DOCUMENTS_DIR
        
        if not abs_path.startswith(DOCUMENTS_DIR) or os.path.islink(abs_path):
            return []

        children = []
        try:
            entries = sorted(os.listdir(abs_path))
        except Exception as e:
            logger.error(f"Failed to scan directory {abs_path}: {e}")
            entries = []

        for entry in entries:
            if entry.startswith(".") or "/" in entry or "\\" in entry:
                continue
            
            entry_abs = os.path.realpath(os.path.join(abs_path, entry))
            if not entry_abs.startswith(DOCUMENTS_DIR) or os.path.islink(entry_abs):
                continue

            if os.path.isdir(entry_abs):
                child_rel = os.path.join(rel_path, entry).replace("\\", "/")
                children.append({
                    "name": entry,
                    "path": child_rel,
                    "type": "folder",
                    "children": scan_dir(child_rel)
                })

        return children

    tree = {
        "name": "Documents",
        "path": "",
        "type": "folder",
        "children": scan_dir("")
    }
    return tree

@app.post("/api/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    folderPath: str = Form(""),
    replace: str = Form("false"),
    session: dict = Depends(require_auth)
):
    # CSRF validation
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        logger.warning("Upload rejected: CSRF token missing or invalid")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"

    # Disk Space Protection Check
    free_bytes = shutil.disk_usage(DOCUMENTS_DIR).free
    min_free_bytes = int(MIN_FREE_DISK_GB * 1024 * 1024 * 1024)
    if free_bytes < min_free_bytes:
        logger.error(f"Disk space threshold triggered: {free_bytes} free bytes remaining.")
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="Server storage space threshold reached. Upload rejected."
        )

    filename = sanitize_filename(file.filename or "")
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Canonical Path Traversal Shield
    clean_folder_path = folderPath.strip().strip("/").strip("\\")
    target_dir = os.path.realpath(os.path.join(DOCUMENTS_DIR, clean_folder_path))

    if not target_dir.startswith(DOCUMENTS_DIR) or os.path.islink(target_dir):
        logger.warning(f"Path traversal blocked from IP {client_ip}: {folderPath}")
        raise HTTPException(status_code=400, detail="Invalid destination path")

    # Extension Whitelist Check
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        logger.warning(f"Unallowed extension '.{ext}' blocked from IP {client_ip}")
        raise HTTPException(
            status_code=400,
            detail=f"File extension '.{ext}' is not allowed for security reasons."
        )

    os.makedirs(target_dir, mode=0o775, exist_ok=True)
    try:
        os.chmod(target_dir, 0o775)
    except Exception:
        pass

    target_file_path = os.path.realpath(os.path.join(target_dir, filename))

    if not target_file_path.startswith(DOCUMENTS_DIR) or os.path.islink(target_file_path):
        raise HTTPException(status_code=400, detail="Forbidden target path")

    # Duplicate File Policy
    is_replace = replace.lower() == "true"
    if os.path.exists(target_file_path) and not is_replace:
        return JSONResponse(
            status_code=409,
            content={
                "status": "exists",
                "filename": filename,
                "folderPath": clean_folder_path,
                "message": f"File '{filename}' already exists in destination folder."
            }
        )

    # Temporary Staging in /tmp/uploads
    tmp_filename = f"{secrets.token_hex(12)}_{filename}"
    tmp_path = os.path.join("/tmp/uploads", tmp_filename)
    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    total_bytes = 0
    header_sample = bytearray()

    try:
        with open(tmp_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if len(header_sample) < 2048:
                    header_sample.extend(chunk[:2048 - len(header_sample)])
                
                if total_bytes > max_bytes:
                    buffer.close()
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                    logger.warning(f"Size limit exceeded ({total_bytes} bytes) from IP {client_ip}")
                    raise HTTPException(
                        status_code=413,
                        detail=f"File size exceeds maximum allowed limit of {MAX_FILE_SIZE_MB}MB"
                    )
                buffer.write(chunk)

        # Magic Bytes Validation
        if not validate_magic_bytes(bytes(header_sample), ext):
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            logger.warning(f"File magic byte validation failed for extension .{ext} from IP {client_ip}")
            raise HTTPException(
                status_code=400,
                detail=f"File signature does not match declared extension '.{ext}'"
            )

        # Atomic Move to destination with safe non-executable permissions (0o664)
        shutil.move(tmp_path, target_file_path)
        try:
            os.chmod(target_file_path, 0o664)
        except Exception:
            pass

        logger.info(
            f"[UPLOAD SUCCESS] IP: {client_ip} | File: {filename} | "
            f"Size: {total_bytes} bytes | Path: /documents/{clean_folder_path}"
        )

        return {
            "status": "success",
            "filename": filename,
            "folderPath": clean_folder_path,
            "size": total_bytes,
            "message": "File uploaded successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        logger.error(f"Internal upload failure: {e}")
        raise HTTPException(status_code=500, detail="Internal error during file upload processing")
