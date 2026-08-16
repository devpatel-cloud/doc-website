FROM python:3.11-slim

# Create non-root user (UID 100) and group (GID 101) using Debian shadow-utils
RUN groupadd -g 101 appgroup && \
    useradd -u 100 -g appgroup -m -s /bin/sh appuser

WORKDIR /app

# Install dependencies with upgraded pip for fast pre-compiled binary wheels
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Create temporary upload directory with non-root permissions
RUN mkdir -p /tmp/uploads && chown -R appuser:appgroup /tmp/uploads

# Switch to non-root user (UID 100 / GID 101)
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
