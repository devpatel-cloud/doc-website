import os
import re
import shutil
import time
import secrets
import logging
import hashlib
import json
from datetime import datetime, timezone
from typing import List, Optional, Dict

from fastapi import FastAPI, Request, Response, Depends, HTTPException, status, UploadFile, File, Form, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("docvault_backend")

# Standardized Environment Variables
RAW_ADMIN_PASSWORD = os.getenv("DOCVAULT_ADMIN_PASSWORD", os.getenv("UPLOAD_PASSWORD", "")).strip()
MAX_FILE_SIZE_MB = int(os.getenv("DOCVAULT_MAX_FILE_SIZE_MB", os.getenv("MAX_FILE_SIZE_MB", "20480")))
MIN_FREE_DISK_GB = float(os.getenv("DOCVAULT_MIN_FREE_DISK_GB", os.getenv("MIN_FREE_DISK_GB", "2.5")))
_env_doc_dir = os.getenv("DOCVAULT_DOCUMENTS_DIR", os.getenv("DOCUMENTS_DIR", ""))
if _env_doc_dir:
    DOCUMENTS_DIR = os.path.realpath(_env_doc_dir)
else:
    _fallback = "/documents" if os.path.exists("/documents") else os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "documents"))
    DOCUMENTS_DIR = os.path.realpath(_fallback)
os.makedirs(DOCUMENTS_DIR, exist_ok=True)
SESSION_SECRET = os.getenv("DOCVAULT_SESSION_SECRET", os.getenv("SESSION_SECRET", "docvault_secret_key_2026"))
TRASH_RETENTION_DAYS = int(os.getenv("DOCVAULT_TRASH_RETENTION_DAYS", "30"))
CHUNK_SIZE_MB = int(os.getenv("DOCVAULT_CHUNK_SIZE_MB", "8"))
UPLOAD_EXPIRATION_HOURS = int(os.getenv("DOCVAULT_UPLOAD_EXPIRATION_HOURS", "24"))
CHUNK_CONCURRENCY = int(os.getenv("DOCVAULT_CHUNK_CONCURRENCY", "4"))
MAX_CHUNK_CONCURRENCY = int(os.getenv("DOCVAULT_MAX_CHUNK_CONCURRENCY", "6"))

# PBKDF2-HMAC-SHA256 Password Hashing & Salt
def hash_password(password: str, salt: bytes) -> str:
    """PBKDF2-HMAC-SHA256 password hashing with 100,000 iterations"""
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return key.hex()

ADMIN_SALT = secrets.token_bytes(16)
ADMIN_PASSWORD_HASH = hash_password(RAW_ADMIN_PASSWORD, ADMIN_SALT) if RAW_ADMIN_PASSWORD else None

def verify_admin_password(provided_password: str) -> bool:
    """Constant-time PBKDF2 password verification. Fails safely if password is not configured."""
    if not ADMIN_PASSWORD_HASH or not RAW_ADMIN_PASSWORD:
        logger.error("[SECURITY CONFIG ERROR] DOCVAULT_ADMIN_PASSWORD environment variable is missing!")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error: DOCVAULT_ADMIN_PASSWORD environment variable is not configured."
        )
    provided_hash = hash_password(provided_password, ADMIN_SALT)
    return secrets.compare_digest(provided_hash, ADMIN_PASSWORD_HASH)

# Session Store: session_token -> { "created": float, "csrf_token": str }
valid_sessions: Dict[str, dict] = {}
failed_login_attempts: Dict[str, dict] = {} # client_ip -> {count: int, timestamp: float}

# Active Chunked Upload Sessions Store: upload_id -> session dict
valid_upload_sessions: Dict[str, dict] = {}

# Whitelisted File Extensions
ALLOWED_EXTENSIONS = {
    # Documents & Disk Images
    "pdf", "txt", "md", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "json", "zip", "iso",
    # Images (Raster)
    "png", "jpg", "jpeg", "webp", "gif",
    # Videos
    "mp4", "webm", "mkv", "mov", "avi", "m4v", "3gp", "mpeg", "mpg", "ts"
}

app = FastAPI(title="DocVault Admin Upload API — Hardened 20GB Platform", version="3.1.0")

class LoginRequest(BaseModel):
    password: str

class InitUploadRequest(BaseModel):
    filename: str
    folderPath: Optional[str] = ""
    totalSize: int
    totalChunks: int
    fileHash: Optional[str] = None
    replace: Optional[bool] = False

class CompleteUploadRequest(BaseModel):
    uploadId: str
    replace: Optional[bool] = False

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
        session = valid_sessions[session_id]
        # Session expiration check (24h default)
        if time.time() - session.get("created", 0) > 86400:
            del valid_sessions[session_id]
            return None
        return session
    return None

def require_auth(request: Request) -> dict:
    session = get_session_info(request)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    return session

def validate_safe_path(target_path: str, allow_root: bool = False) -> str:
    """Canonical realpath & commonpath boundary shield against path traversal, symlinks & prefix escapes"""
    if not target_path:
        raise HTTPException(status_code=400, detail="Empty path specified")
    
    real_path = os.path.realpath(target_path)
    
    # Commonpath verification guarantees target is strictly inside DOCUMENTS_DIR (prevents /documents_evil bypass)
    try:
        if os.path.commonpath([DOCUMENTS_DIR, real_path]) != DOCUMENTS_DIR:
            raise HTTPException(status_code=400, detail="Invalid path: outside document storage root")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path structure")

    if os.path.islink(real_path) or os.path.islink(target_path):
        raise HTTPException(status_code=400, detail="Symlink paths are forbidden for security reasons")

    rel_from_root = os.path.relpath(real_path, DOCUMENTS_DIR).replace("\\", "/")
    if rel_from_root == "." or rel_from_root == "":
        if not allow_root:
            raise HTTPException(status_code=400, detail="Cannot target root documents directory")
        return real_path

    # Block direct access to hidden system folders (.trash, .metadata, .tmp_uploads, .audit.log)
    parts = rel_from_root.split("/")
    for p in parts:
        if p.startswith("."):
            raise HTTPException(status_code=404, detail="Requested item not found")

    return real_path

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
    """Validate file magic byte signatures for common formats (ISO treated as binary blob)"""
    if ext == "iso":
        return True
    elif ext == "pdf":
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
    elif ext in ("mp4", "mov", "m4v"):
        return b"ftyp" in header_bytes[:32]
    elif ext in ("mkv", "webm"):
        return header_bytes.startswith(b"\x1a\x45\xdf\xa3")
    elif ext == "avi":
        return b"RIFF" in header_bytes[:4] and b"AVI " in header_bytes[8:12]
    return True

def calculate_sha256(filepath: str) -> str:
    """Streaming SHA-256 calculation to avoid loading large files into RAM"""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()

def sanitize_log_string(s: str) -> str:
    """Strip newlines and control characters to prevent log injection"""
    return re.sub(r"[\r\n\t\x00-\x1f]", "", str(s or ""))[:200]

def log_audit_event(action: str, client_ip: str, admin_user: str = "admin", details: dict = None):
    """Record sanitized security audit log to DOCUMENTS_DIR/.audit.log with 5MB rotation cap"""
    try:
        os.makedirs(DOCUMENTS_DIR, mode=0o775, exist_ok=True)
        log_file = os.path.realpath(os.path.join(DOCUMENTS_DIR, ".audit.log"))
        
        safe_details = {}
        if details:
            for k, v in details.items():
                if k.lower() in ("password", "hash", "secret", "token", "cookie", "auth"):
                    safe_details[k] = "[REDACTED]"
                else:
                    safe_details[k] = sanitize_log_string(v)

        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": sanitize_log_string(action),
            "admin": sanitize_log_string(admin_user),
            "ip": sanitize_log_string(client_ip),
            "details": safe_details
        }

        # Log rotation check (5MB cap)
        if os.path.exists(log_file) and os.path.getsize(log_file) > 5 * 1024 * 1024:
            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                with open(log_file, "w", encoding="utf-8") as f:
                    f.writelines(lines[-2500:])
            except Exception:
                pass

        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
    except Exception as e:
        logger.error(f"Failed writing audit log: {e}")

# Trash Storage Helpers
TRASH_DIR = os.path.realpath(os.path.join(DOCUMENTS_DIR, ".trash"))
TRASH_INDEX_FILE = os.path.realpath(os.path.join(DOCUMENTS_DIR, ".trash_index.json"))

def load_trash_index() -> list:
    if os.path.exists(TRASH_INDEX_FILE):
        try:
            with open(TRASH_INDEX_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed loading trash index: {e}")
            return []
    return []

def save_trash_index(index_data: list):
    try:
        os.makedirs(DOCUMENTS_DIR, mode=0o775, exist_ok=True)
        tmp_file = f"{TRASH_INDEX_FILE}.tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(index_data, f, indent=2)
        os.replace(tmp_file, TRASH_INDEX_FILE)
    except Exception as e:
        logger.error(f"Failed saving trash index: {e}")

def purge_expired_trash():
    """Purge trash items older than TRASH_RETENTION_DAYS"""
    try:
        if not os.path.exists(TRASH_DIR):
            return
        now = time.time()
        cutoff = now - (TRASH_RETENTION_DAYS * 86400)
        index_data = load_trash_index()
        kept_entries = []
        for entry in index_data:
            deleted_at = entry.get("deleted_at", now)
            trash_path = os.path.realpath(os.path.join(TRASH_DIR, entry["trash_name"]))
            if not trash_path.startswith(TRASH_DIR):
                continue
            if deleted_at < cutoff:
                if os.path.exists(trash_path):
                    if os.path.isdir(trash_path):
                        shutil.rmtree(trash_path)
                    else:
                        os.remove(trash_path)
                    logger.info(f"[TRASH AUTO PURGE] Removed expired trash item: {entry['name']}")
            else:
                kept_entries.append(entry)
        save_trash_index(kept_entries)
    except Exception as e:
        logger.error(f"Trash auto-purge failure: {e}")

def cleanup_abandoned_uploads():
    """Purge upload sessions and chunk directories older than 24 hours"""
    try:
        now = time.time()
        cutoff = now - (UPLOAD_EXPIRATION_HOURS * 3600)
        expired_ids = []

        for upload_id, sess in list(valid_upload_sessions.items()):
            if sess.get("created_at", now) < cutoff:
                expired_ids.append(upload_id)
                staging_dir = sess.get("staging_dir")
                if staging_dir and os.path.exists(staging_dir) and staging_dir.startswith(os.path.realpath(os.path.join(DOCUMENTS_DIR, ".tmp_uploads"))):
                    shutil.rmtree(staging_dir, ignore_errors=True)
                logger.info(f"[UPLOAD CLEANUP] Purged expired upload session: {upload_id}")

        for uid in expired_ids:
            if uid in valid_upload_sessions:
                del valid_upload_sessions[uid]
    except Exception as e:
        logger.error(f"Abandoned upload cleanup failure: {e}")

@app.on_event("startup")
async def startup_event():
    os.makedirs(DOCUMENTS_DIR, mode=0o775, exist_ok=True)
    os.makedirs(TRASH_DIR, mode=0o775, exist_ok=True)
    purge_expired_trash()
    cleanup_abandoned_uploads()

# --- Auth Endpoints ---

@app.post("/api/auth/login")
async def login(data: LoginRequest, request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip)

    if verify_admin_password(data.password):
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
        log_audit_event("login_success", client_ip)
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
        log_audit_event("login_failure", client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    session_id = request.cookies.get("docvault_session")
    if session_id and session_id in valid_sessions:
        del valid_sessions[session_id]
    response.delete_cookie("docvault_session", path="/")
    log_audit_event("logout", client_ip)
    return {"status": "success", "message": "Logged out"}

@app.get("/api/auth/status")
async def auth_status(request: Request):
    session = get_session_info(request)
    if session:
        return {"authenticated": True, "csrfToken": session["csrf_token"]}
    return {"authenticated": False}

# --- Directory & Folder Tree Endpoints ---

@app.get("/api/folders")
async def get_folder_tree():
    """Build and return nested folder tree from /documents directory (excluding hidden folders)"""
    if not os.path.exists(DOCUMENTS_DIR):
        try:
            os.makedirs(DOCUMENTS_DIR, mode=0o775, exist_ok=True)
        except Exception:
            pass

    def scan_dir(rel_path: str = ""):
        abs_path = os.path.realpath(os.path.join(DOCUMENTS_DIR, rel_path)) if rel_path else DOCUMENTS_DIR
        
        try:
            validate_safe_path(abs_path, allow_root=True)
        except Exception:
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
            try:
                validate_safe_path(entry_abs, allow_root=False)
            except Exception:
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

# --- Resumable Chunked Upload Engine ---

@app.post("/api/upload/init")
async def init_resumable_upload(
    req: InitUploadRequest,
    request: Request,
    session: dict = Depends(require_auth)
):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"

    free_bytes = shutil.disk_usage(DOCUMENTS_DIR).free
    min_free_bytes = int(MIN_FREE_DISK_GB * 1024 * 1024 * 1024)
    if free_bytes < min_free_bytes:
        raise HTTPException(status_code=507, detail=f"Insufficient server disk storage threshold ({MIN_FREE_DISK_GB}GB required).")

    filename = sanitize_filename(req.filename)
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File extension '.{ext}' is not allowed.")

    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    if req.totalSize > max_bytes:
        raise HTTPException(status_code=413, detail=f"File is too large. Maximum allowed size is {MAX_FILE_SIZE_MB // 1024} GB.")

    clean_folder_path = (req.folderPath or "").strip().strip("/").strip("\\")
    target_dir = os.path.realpath(os.path.join(DOCUMENTS_DIR, clean_folder_path))
    validate_safe_path(target_dir, allow_root=True)

    target_file_path = os.path.realpath(os.path.join(target_dir, filename))
    validate_safe_path(target_file_path, allow_root=False)

    if os.path.exists(target_file_path) and not req.replace:
        return JSONResponse(
            status_code=409,
            content={
                "status": "exists",
                "filename": filename,
                "folderPath": clean_folder_path,
                "message": f"File '{filename}' already exists in target folder."
            }
        )

    upload_id = secrets.token_hex(16)
    staging_dir = os.path.realpath(os.path.join(DOCUMENTS_DIR, ".tmp_uploads", upload_id))
    os.makedirs(staging_dir, mode=0o775, exist_ok=True)

    session_info = {
        "uploadId": upload_id,
        "filename": filename,
        "folderPath": clean_folder_path,
        "totalSize": req.totalSize,
        "totalChunks": req.totalChunks,
        "uploadedChunks": set(),
        "staging_dir": staging_dir,
        "created_at": time.time(),
        "fileHash": req.fileHash
    }
    valid_upload_sessions[upload_id] = session_info

    logger.info(f"[RESUMABLE UPLOAD INIT] ID: {upload_id} | File: {filename} | Chunks: {req.totalChunks} | IP: {client_ip}")
    log_audit_event("upload_init", client_ip, details={"uploadId": upload_id, "filename": filename, "totalSize": req.totalSize})

    return {
        "status": "success",
        "uploadId": upload_id,
        "chunkSize": CHUNK_SIZE_MB * 1024 * 1024,
        "concurrency": CHUNK_CONCURRENCY,
        "maxConcurrency": MAX_CHUNK_CONCURRENCY,
        "uploadedChunks": []
    }

@app.post("/api/upload/chunk")
async def upload_chunk(
    request: Request,
    uploadId: str = Form(...),
    chunkIndex: int = Form(...),
    chunk: UploadFile = File(...),
    session: dict = Depends(require_auth)
):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    session_info = valid_upload_sessions.get(uploadId)
    if not session_info:
        raise HTTPException(status_code=404, detail="Upload session not found or expired")

    if chunkIndex < 0 or chunkIndex >= session_info["totalChunks"]:
        raise HTTPException(status_code=400, detail="Invalid chunk index")

    staging_dir = session_info["staging_dir"]
    chunk_path = os.path.realpath(os.path.join(staging_dir, f"chunk_{chunkIndex}"))
    if not chunk_path.startswith(staging_dir):
        raise HTTPException(status_code=400, detail="Invalid chunk path")

    with open(chunk_path, "wb") as f:
        while data := await chunk.read(1024 * 1024):
            f.write(data)

    session_info["uploadedChunks"].add(chunkIndex)

    return {
        "status": "success",
        "uploadId": uploadId,
        "chunkIndex": chunkIndex,
        "uploadedChunks": sorted(list(session_info["uploadedChunks"]))
    }

@app.get("/api/upload/status/{upload_id}")
async def get_upload_status(upload_id: str, session: dict = Depends(require_auth)):
    session_info = valid_upload_sessions.get(upload_id)
    if not session_info:
        raise HTTPException(status_code=404, detail="Upload session not found")

    return {
        "uploadId": upload_id,
        "filename": session_info["filename"],
        "totalSize": session_info["totalSize"],
        "totalChunks": session_info["totalChunks"],
        "uploadedChunks": sorted(list(session_info["uploadedChunks"]))
    }

@app.post("/api/upload/complete")
async def complete_resumable_upload(
    req: CompleteUploadRequest,
    request: Request,
    session: dict = Depends(require_auth)
):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"
    session_info = valid_upload_sessions.get(req.uploadId)
    if not session_info:
        raise HTTPException(status_code=404, detail="Upload session not found or expired")

    staging_dir = session_info["staging_dir"]
    total_chunks = session_info["totalChunks"]
    filename = session_info["filename"]
    clean_folder_path = session_info["folderPath"]

    for i in range(total_chunks):
        if i not in session_info["uploadedChunks"] or not os.path.exists(os.path.join(staging_dir, f"chunk_{i}")):
            raise HTTPException(status_code=400, detail=f"Missing chunk {i}. Incomplete upload.")

    target_dir = os.path.realpath(os.path.join(DOCUMENTS_DIR, clean_folder_path))
    validate_safe_path(target_dir, allow_root=True)
    os.makedirs(target_dir, mode=0o775, exist_ok=True)

    target_file_path = os.path.realpath(os.path.join(target_dir, filename))
    validate_safe_path(target_file_path, allow_root=False)

    part_file = os.path.join(staging_dir, f".{filename}.part")
    hasher = hashlib.sha256()
    header_sample = bytearray()
    total_bytes = 0

    with open(part_file, "wb") as out_f:
        for i in range(total_chunks):
            chunk_file = os.path.join(staging_dir, f"chunk_{i}")
            with open(chunk_file, "rb") as in_f:
                while data := in_f.read(1024 * 1024):
                    total_bytes += len(data)
                    hasher.update(data)
                    if len(header_sample) < 2048:
                        header_sample.extend(data[:2048 - len(header_sample)])
                    out_f.write(data)

    sha256_hash = hasher.hexdigest()
    ext = filename.split(".")[-1].lower() if "." in filename else ""

    if not validate_magic_bytes(bytes(header_sample), ext):
        if os.path.exists(part_file): os.remove(part_file)
        shutil.rmtree(staging_dir, ignore_errors=True)
        del valid_upload_sessions[req.uploadId]
        raise HTTPException(status_code=400, detail=f"File signature validation failed for extension '.{ext}'")

    shutil.move(part_file, target_file_path)
    try:
        os.chmod(target_file_path, 0o664)
    except Exception:
        pass

    shutil.rmtree(staging_dir, ignore_errors=True)
    del valid_upload_sessions[req.uploadId]

    # Save metadata
    meta_dir = os.path.realpath(os.path.join(DOCUMENTS_DIR, ".metadata", clean_folder_path))
    os.makedirs(meta_dir, mode=0o775, exist_ok=True)
    meta_file = os.path.join(meta_dir, f"{filename}.json")
    meta_data = {
        "filename": filename,
        "folderPath": clean_folder_path,
        "size": total_bytes,
        "ext": ext,
        "sha256": sha256_hash,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "client_ip": client_ip
    }
    try:
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(meta_data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed writing file metadata: {e}")

    logger.info(f"[RESUMABLE UPLOAD COMPLETE] File: {filename} | SHA256: {sha256_hash} | Size: {total_bytes} bytes | IP: {client_ip}")
    log_audit_event("upload_complete", client_ip, details={"filename": filename, "folder": clean_folder_path, "size": total_bytes, "sha256": sha256_hash})

    return {
        "status": "success",
        "filename": filename,
        "folderPath": clean_folder_path,
        "size": total_bytes,
        "sha256": sha256_hash,
        "message": "File uploaded and finalized successfully"
    }

# --- Single POST /api/upload Endpoint ---

@app.post("/api/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    folderPath: str = Form(""),
    replace: str = Form("false"),
    session: dict = Depends(require_auth)
):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"

    free_bytes = shutil.disk_usage(DOCUMENTS_DIR).free
    min_free_bytes = int(MIN_FREE_DISK_GB * 1024 * 1024 * 1024)
    if free_bytes < min_free_bytes:
        raise HTTPException(status_code=507, detail=f"Server storage threshold reached ({MIN_FREE_DISK_GB}GB required). Upload rejected.")

    filename = sanitize_filename(file.filename or "")
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    clean_folder_path = folderPath.strip().strip("/").strip("\\")
    target_dir = os.path.realpath(os.path.join(DOCUMENTS_DIR, clean_folder_path))
    validate_safe_path(target_dir, allow_root=True)

    ext = filename.split(".")[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File extension '.{ext}' is not allowed.")

    os.makedirs(target_dir, mode=0o775, exist_ok=True)
    target_file_path = os.path.realpath(os.path.join(target_dir, filename))
    validate_safe_path(target_file_path, allow_root=False)

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

    staging_dir = os.path.join(DOCUMENTS_DIR, ".tmp_uploads")
    os.makedirs(staging_dir, mode=0o775, exist_ok=True)
    part_filename = f".{filename}.{secrets.token_hex(8)}.part"
    part_path = os.path.join(staging_dir, part_filename)
    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    total_bytes = 0
    header_sample = bytearray()
    hasher = hashlib.sha256()

    try:
        with open(part_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                hasher.update(chunk)
                if len(header_sample) < 2048:
                    header_sample.extend(chunk[:2048 - len(header_sample)])
                
                if total_bytes > max_bytes:
                    buffer.close()
                    if os.path.exists(part_path): os.remove(part_path)
                    raise HTTPException(status_code=413, detail=f"File is too large. Maximum allowed size is {MAX_FILE_SIZE_MB // 1024} GB.")
                buffer.write(chunk)

        if not validate_magic_bytes(bytes(header_sample), ext):
            if os.path.exists(part_path): os.remove(part_path)
            raise HTTPException(status_code=400, detail=f"File signature does not match declared extension '.{ext}'")

        shutil.move(part_path, target_file_path)
        try: os.chmod(target_file_path, 0o664)
        except Exception: pass

        sha256_hash = hasher.hexdigest()
        log_audit_event("upload_single", client_ip, details={"filename": filename, "folder": clean_folder_path, "size": total_bytes, "sha256": sha256_hash})

        return {
            "status": "success",
            "filename": filename,
            "folderPath": clean_folder_path,
            "size": total_bytes,
            "sha256": sha256_hash,
            "message": "File uploaded successfully"
        }
    except Exception:
        if os.path.exists(part_path):
            try: os.remove(part_path)
            except Exception: pass
        raise

# --- Trash & Recycle Bin Endpoints ---

@app.delete("/api/documents/{item_path:path}")
async def delete_item(
    item_path: str,
    request: Request,
    confirm: Optional[str] = None,
    session: dict = Depends(require_auth)
):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"
    clean_path = item_path.strip().strip("/").strip("\\")
    
    target_path = os.path.realpath(os.path.join(DOCUMENTS_DIR, clean_path))
    validate_safe_path(target_path, allow_root=False)

    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="Document or folder no longer exists")

    if os.path.isdir(target_path):
        entries = os.listdir(target_path)
        if entries and confirm != "true":
            return JSONResponse(
                status_code=409,
                content={
                    "status": "requires_confirmation",
                    "itemCount": len(entries),
                    "folderName": os.path.basename(target_path),
                    "message": f"Folder contains {len(entries)} item(s). Require explicit confirmation."
                }
            )

    os.makedirs(TRASH_DIR, mode=0o775, exist_ok=True)
    trash_id = secrets.token_hex(8)
    base_name = os.path.basename(target_path)
    trash_filename = f"{trash_id}_{base_name}"
    trash_dest_path = os.path.realpath(os.path.join(TRASH_DIR, trash_filename))

    item_size = os.path.getsize(target_path) if os.path.isfile(target_path) else 0
    is_dir = os.path.isdir(target_path)

    shutil.move(target_path, trash_dest_path)

    now_ts = time.time()
    trash_entry = {
        "id": trash_id,
        "name": base_name,
        "filename": base_name,
        "original_path": clean_path,
        "trash_name": trash_filename,
        "size": item_size,
        "is_folder": is_dir,
        "deleted_at": now_ts,
        "deleted_date": datetime.now(timezone.utc).isoformat(),
        "expires_at": now_ts + (TRASH_RETENTION_DAYS * 86400)
    }

    index_data = load_trash_index()
    index_data.append(trash_entry)
    save_trash_index(index_data)

    log_audit_event("move_to_trash", client_ip, details={"path": clean_path, "trash_id": trash_id})
    return {"status": "success", "message": f"'{base_name}' moved to Trash", "trashId": trash_id}

@app.get("/api/trash")
async def get_trash_list(session: dict = Depends(require_auth)):
    purge_expired_trash()
    return load_trash_index()

@app.post("/api/trash/restore/{trash_id}")
async def restore_from_trash(trash_id: str, request: Request, session: dict = Depends(require_auth)):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"
    index_data = load_trash_index()
    target_entry = None
    remaining_entries = []

    for entry in index_data:
        if entry["id"] == trash_id:
            target_entry = entry
        else:
            remaining_entries.append(entry)

    if not target_entry:
        raise HTTPException(status_code=404, detail="Item not found in Trash")

    trash_path = os.path.realpath(os.path.join(TRASH_DIR, target_entry["trash_name"]))
    if not os.path.exists(trash_path) or not trash_path.startswith(TRASH_DIR):
        save_trash_index(remaining_entries)
        raise HTTPException(status_code=404, detail="Trash storage file missing")

    orig_rel_path = target_entry["original_path"]
    orig_abs_path = os.path.realpath(os.path.join(DOCUMENTS_DIR, orig_rel_path))
    validate_safe_path(orig_abs_path, allow_root=False)

    if os.path.exists(orig_abs_path):
        raise HTTPException(status_code=409, detail=f"A file or folder already exists at '{orig_rel_path}'. Please remove or rename it first.")

    os.makedirs(os.path.dirname(orig_abs_path), mode=0o775, exist_ok=True)
    shutil.move(trash_path, orig_abs_path)
    save_trash_index(remaining_entries)

    log_audit_event("trash_restore", client_ip, details={"original_path": orig_rel_path, "trash_id": trash_id})
    return {"status": "success", "message": f"'{target_entry['name']}' restored successfully"}

@app.delete("/api/trash/permanent/{trash_id}")
async def permanent_delete_trash(trash_id: str, request: Request, session: dict = Depends(require_auth)):
    x_csrf_token = request.headers.get("X-CSRF-Token")
    if not x_csrf_token or not secrets.compare_digest(x_csrf_token, session.get("csrf_token", "")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    client_ip = request.client.host if request.client else "unknown"
    index_data = load_trash_index()
    target_entry = None
    remaining_entries = []

    for entry in index_data:
        if entry["id"] == trash_id:
            target_entry = entry
        else:
            remaining_entries.append(entry)

    if not target_entry:
        raise HTTPException(status_code=404, detail="Item not found in Trash")

    trash_path = os.path.realpath(os.path.join(TRASH_DIR, target_entry["trash_name"]))
    if os.path.exists(trash_path) and trash_path.startswith(TRASH_DIR):
        if os.path.isdir(trash_path):
            shutil.rmtree(trash_path)
        else:
            os.remove(trash_path)

    save_trash_index(remaining_entries)
    log_audit_event("trash_permanent_delete", client_ip, details={"name": target_entry["name"], "trash_id": trash_id})
    return {"status": "success", "message": f"'{target_entry['name']}' permanently deleted"}

# --- Storage Dashboard & Server-Side Search Endpoints ---

def format_size_human(bytes_size: int) -> str:
    if not bytes_size or bytes_size == 0:
        return "0 B"
    size_float = float(bytes_size)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(size_float) < 1024.0:
            return f"{size_float:.1f} {unit}"
        size_float /= 1024.0
    return f"{size_float:.1f} PB"

@app.get("/api/storage/summary")
async def get_storage_summary():
    """Calculate and return separated DocVault storage statistics and Server Physical Disk metrics"""
    total_bytes, used_bytes, free_bytes = shutil.disk_usage(DOCUMENTS_DIR)
    
    docvault_total_size = 0
    file_count = 0
    folder_count = 0

    categories = {
        "documents": {"files": 0, "size_bytes": 0, "size_gb": 0.0, "percentage": 0.0},
        "videos": {"files": 0, "size_bytes": 0, "size_gb": 0.0, "percentage": 0.0},
        "iso": {"files": 0, "size_bytes": 0, "size_gb": 0.0, "percentage": 0.0},
        "images": {"files": 0, "size_bytes": 0, "size_gb": 0.0, "percentage": 0.0},
        "archives": {"files": 0, "size_bytes": 0, "size_gb": 0.0, "percentage": 0.0},
        "other": {"files": 0, "size_bytes": 0, "size_gb": 0.0, "percentage": 0.0}
    }
    
    all_files = []

    for root, dirs, files in os.walk(DOCUMENTS_DIR):
        # Exclude hidden system directories (.trash, .tmp_uploads, .metadata, etc.)
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        rel_root = os.path.relpath(root, DOCUMENTS_DIR).replace("\\", "/")
        if rel_root != "." and any(p.startswith(".") for p in rel_root.split("/")):
            continue

        folder_count += len(dirs)

        for filename in files:
            if filename.startswith("."):
                continue

            file_abs = os.path.join(root, filename)
            if os.path.islink(file_abs):
                continue

            try:
                validate_safe_path(file_abs, allow_root=False)
            except Exception:
                continue

            stat = os.stat(file_abs)
            size = stat.st_size
            mtime = stat.st_mtime
            ext = filename.split(".")[-1].lower() if "." in filename else ""
            
            docvault_total_size += size
            file_count += 1

            if ext in ("pdf", "txt", "md", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "json"):
                cat_key = "documents"
            elif ext in ("mp4", "webm", "mkv", "mov", "avi", "m4v", "3gp", "mpeg", "mpg", "ts"):
                cat_key = "videos"
            elif ext in ("iso", "img"):
                cat_key = "iso"
            elif ext in ("png", "jpg", "jpeg", "webp", "gif"):
                cat_key = "images"
            elif ext in ("zip", "tar", "gz", "bz2", "7z", "rar"):
                cat_key = "archives"
            else:
                cat_key = "other"

            categories[cat_key]["files"] += 1
            categories[cat_key]["size_bytes"] += size

            rel_file_path = os.path.relpath(file_abs, DOCUMENTS_DIR).replace("\\", "/")
            all_files.append({
                "filename": filename,
                "name": filename,
                "path": rel_file_path,
                "size_bytes": size,
                "size": size,
                "size_human": format_size_human(size),
                "ext": ext,
                "modified_time": mtime,
                "mtime": mtime
            })

    # Calculate category percentages against DocVault Total Storage Size
    for cat_key, cat_data in categories.items():
        cat_data["size_gb"] = round(cat_data["size_bytes"] / (1024 * 1024 * 1024), 2)
        cat_data["percentage"] = round((cat_data["size_bytes"] / docvault_total_size) * 100, 1) if docvault_total_size > 0 else 0.0

    largest_files = sorted(all_files, key=lambda x: x["size_bytes"], reverse=True)[:10]
    recent_files = sorted(all_files, key=lambda x: x["modified_time"], reverse=True)[:10]

    docvault_gb = round(docvault_total_size / (1024 * 1024 * 1024), 2)

    # Legacy compatibility fields kept alongside new schema
    file_counts_compat = {
        "total_files": file_count,
        "total_folders": folder_count,
        "documents": categories["documents"]["files"],
        "videos": categories["videos"]["files"],
        "isos": categories["iso"]["files"],
        "images": categories["images"]["files"],
        "archives": categories["archives"]["files"],
        "others": categories["other"]["files"]
    }

    return {
        "docvault": {
            "path": "/documents",
            "total_size_bytes": docvault_total_size,
            "total_size_gb": docvault_gb,
            "size_bytes": docvault_total_size,
            "size_gb": docvault_gb,
            "file_count": file_count,
            "files": file_count,
            "folder_count": folder_count,
            "folders": folder_count
        },
        "server_disk": {
            "total_bytes": total_bytes,
            "used_bytes": used_bytes,
            "free_bytes": free_bytes,
            "usage_percent": round((used_bytes / total_bytes) * 100, 1) if total_bytes else 0
        },
        "categories": categories,
        "largest_files": largest_files,
        "recent_files": recent_files,

        # Backward compatibility aliases
        "disk": {
            "total": total_bytes,
            "used": used_bytes,
            "free": free_bytes,
            "used_percent": round((used_bytes / total_bytes) * 100, 1) if total_bytes else 0
        },
        "counts": file_counts_compat
    }

@app.get("/api/search")
async def search_files(q: str = "", ext: Optional[str] = None):
    """Server-side search by filename or extension with strict path traversal shield"""
    query = (q or "").strip().lower()
    ext_filter = (ext or "").strip().lower()

    results = []
    if not query and not ext_filter:
        return results

    for root, dirs, files in os.walk(DOCUMENTS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        rel_root = os.path.relpath(root, DOCUMENTS_DIR)
        if rel_root.startswith("."):
            continue

        for filename in files:
            if filename.startswith("."):
                continue

            file_abs = os.path.join(root, filename)
            try:
                validate_safe_path(file_abs, allow_root=False)
            except Exception:
                continue

            file_ext = filename.split(".")[-1].lower() if "." in filename else ""
            if ext_filter and file_ext != ext_filter:
                continue

            if query and query not in filename.lower() and query not in rel_root.lower():
                continue

            rel_file_path = os.path.relpath(file_abs, DOCUMENTS_DIR).replace("\\", "/")
            results.append({
                "name": filename,
                "path": rel_file_path,
                "size": os.path.getsize(file_abs),
                "ext": file_ext,
                "mtime": os.path.getmtime(file_abs)
            })

            if len(results) >= 100:
                break
        if len(results) >= 100:
            break

    return results

import urllib.parse

@app.get("/api/documents/metadata/{item_path:path}")
async def get_file_metadata(item_path: str):
    """Return safe metadata and SHA-256 checksum for document"""
    raw_path = urllib.parse.unquote(item_path)
    clean_path = raw_path.strip().strip("/").strip("\\")
    target_path = os.path.realpath(os.path.join(DOCUMENTS_DIR, clean_path))
    validate_safe_path(target_path, allow_root=False)

    if not os.path.exists(target_path) or not os.path.isfile(target_path):
        raise HTTPException(status_code=404, detail="Document not found")

    filename = os.path.basename(target_path)
    folder_rel = os.path.dirname(clean_path)
    ext = filename.split(".")[-1].lower() if "." in filename else ""

    meta_file = os.path.realpath(os.path.join(DOCUMENTS_DIR, ".metadata", folder_rel, f"{filename}.json"))
    sha256_hash = None

    if os.path.exists(meta_file) and meta_file.startswith(os.path.realpath(os.path.join(DOCUMENTS_DIR, ".metadata"))):
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta_json = json.load(f)
                sha256_hash = meta_json.get("sha256")
        except Exception:
            pass

    if not sha256_hash:
        sha256_hash = calculate_sha256(target_path)

    stat = os.stat(target_path)
    return {
        "name": filename,
        "path": clean_path,
        "folder": folder_rel,
        "size": stat.st_size,
        "ext": ext,
        "sha256": sha256_hash,
        "mtime": stat.st_mtime,
        "modified_date": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
    }

@app.get("/api/admin/audit-logs")
async def get_audit_logs(session: dict = Depends(require_auth)):
    log_file = os.path.join(DOCUMENTS_DIR, ".audit.log")
    if not os.path.exists(log_file):
        return []
    try:
        logs = []
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    logs.append(json.loads(line))
        return logs[-100:]
    except Exception as e:
        logger.error(f"Error reading audit logs: {e}")
        return []
