/**
 * DocVault V2 — Client Engine & Premium Obsidian UI/UX Controller
 * Vanilla JavaScript (Zero External Dependencies)
 */

(function () {
  'use strict';

  // Application State
  const state = {
    currentPath: [], // Array of subfolder names, e.g. ['Linux', 'RHCSA']
    currentItems: [], // Items in active directory
    filteredItems: [],
    searchQuery: '',
    sortBy: 'type-name-asc',
    viewMode: localStorage.getItem('docvault_view_mode') || 'grid',
    activeView: 'dashboard', // dashboard, files, trash, storage, activity
    selectedItem: null,
    
    // Auth & Upload State
    isAuthenticated: false,
    csrfToken: '',
    selectedUploadPath: '',
    uploadQueue: []
  };

  // DOM Elements
  const viewDashboard = document.getElementById('view-dashboard');
  const viewFiles = document.getElementById('view-files');
  const viewTrash = document.getElementById('view-trash');
  const viewStorage = document.getElementById('view-storage');
  const viewActivity = document.getElementById('view-activity');

  const navBtnDashboard = document.getElementById('nav-btn-dashboard');
  const navBtnFiles = document.getElementById('nav-btn-files');
  const navBtnTrash = document.getElementById('nav-btn-trash');
  const navBtnStorage = document.getElementById('nav-btn-storage');
  const navBtnActivity = document.getElementById('nav-btn-activity');

  const sortSelect = document.getElementById('sort-select');
  const btnGridView = document.getElementById('btn-grid-view');
  const btnListView = document.getElementById('btn-list-view');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnBack = document.getElementById('btn-back');
  const breadcrumbsNav = document.getElementById('breadcrumbs');

  const loadingState = document.getElementById('loading-state');
  const documentsGrid = document.getElementById('documents-grid');
  const documentsList = document.getElementById('documents-list');
  const listTbody = document.getElementById('documents-list-tbody');
  const emptyState = document.getElementById('empty-state');

  // Command Palette & Inspector Elements
  const btnSearchTrigger = document.getElementById('btn-search-trigger');
  const commandPaletteModal = document.getElementById('command-palette-modal');
  const commandPaletteInput = document.getElementById('command-palette-input');
  const commandPaletteResults = document.getElementById('command-palette-results');

  const inspectorPanel = document.getElementById('file-inspector-panel');
  const btnCloseInspector = document.getElementById('btn-close-inspector');
  const inspectorIcon = document.getElementById('inspector-icon');
  const inspectorFilename = document.getElementById('inspector-filename');
  const inspectorSize = document.getElementById('inspector-size');
  const inspectorMtime = document.getElementById('inspector-mtime');
  const inspectorPath = document.getElementById('inspector-path');
  const inspectorSha256 = document.getElementById('inspector-sha256');
  const btnCopyInspectorSha256 = document.getElementById('btn-copy-inspector-sha256');
  const btnInspectorDownload = document.getElementById('btn-inspector-download');
  const btnInspectorDelete = document.getElementById('btn-inspector-delete');

  // Floating Upload Manager Elements
  const floatingUploader = document.getElementById('floating-uploader');
  const uploaderWidgetBody = document.getElementById('uploader-widget-body');
  const btnCloseUploaderWidget = document.getElementById('btn-close-uploader-widget');
  const btnOpenUpload = document.getElementById('btn-open-upload');
  const fileInput = document.getElementById('file-input');

  // Admin Auth Elements
  const btnAdminAuthHeader = document.getElementById('btn-admin-auth-header');
  const btnAdminAuthSidebar = document.getElementById('btn-admin-auth-sidebar');
  const btnAdminLogoutHeader = document.getElementById('btn-admin-logout-header');
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authPasswordInput = document.getElementById('auth-password');
  const authErrorMsg = document.getElementById('auth-error');
  const btnAuthCancel = document.getElementById('btn-auth-cancel');

  const toastContainer = document.getElementById('toast-container');

  // Extension Mapping & Categories
  const extensionMap = {
    pdf: { category: 'pdf', label: 'PDF', icon: '📄', color: '#EF4444' },
    doc: { category: 'doc', label: 'DOC', icon: '📝', color: '#3B82F6' },
    docx: { category: 'doc', label: 'DOCX', icon: '📝', color: '#3B82F6' },
    txt: { category: 'doc', label: 'TXT', icon: '📃', color: '#94A3B8' },
    md: { category: 'doc', label: 'MD', icon: '📑', color: '#94A3B8' },

    xls: { category: 'sheet', label: 'XLS', icon: '📊', color: '#10B981' },
    xlsx: { category: 'sheet', label: 'XLSX', icon: '📊', color: '#10B981' },
    csv: { category: 'sheet', label: 'CSV', icon: '📊', color: '#10B981' },

    png: { category: 'image', label: 'PNG', icon: '🖼️', color: '#10B981' },
    jpg: { category: 'image', label: 'JPG', icon: '🖼️', color: '#10B981' },
    jpeg: { category: 'image', label: 'JPEG', icon: '🖼️', color: '#10B981' },
    webp: { category: 'image', label: 'WEBP', icon: '🖼️', color: '#10B981' },
    gif: { category: 'image', label: 'GIF', icon: '🖼️', color: '#10B981' },

    mp4: { category: 'video', label: 'MP4', icon: '🎬', color: '#F43F5E' },
    webm: { category: 'video', label: 'WEBM', icon: '🎬', color: '#F43F5E' },
    mkv: { category: 'video', label: 'MKV', icon: '🎬', color: '#F43F5E' },
    mov: { category: 'video', label: 'MOV', icon: '🎬', color: '#F43F5E' },
    avi: { category: 'video', label: 'AVI', icon: '🎬', color: '#F43F5E' },

    zip: { category: 'archive', label: 'ZIP', icon: '📦', color: '#8B5CF6' },
    iso: { category: 'iso', label: 'ISO', icon: '💿', color: '#06B6D4' }
  };

  /**
   * App Initialization
   */
  async function init() {
    setupEventListeners();
    await checkAuthStatus();
    parseHashAndNavigate();
    applyViewMode(state.viewMode);
    loadDashboardMetrics();
  }

  /**
   * Navigation View Switching
   */
  function switchView(viewName) {
    state.activeView = viewName;
    
    [viewDashboard, viewFiles, viewTrash, viewStorage, viewActivity].forEach(el => {
      if (el) el.classList.add('hidden');
    });

    [navBtnDashboard, navBtnFiles, navBtnTrash, navBtnStorage, navBtnActivity].forEach(el => {
      if (el) el.classList.remove('active');
    });

    if (viewName === 'dashboard') {
      viewDashboard.classList.remove('hidden');
      navBtnDashboard.classList.add('active');
      loadDashboardMetrics();
    } else if (viewName === 'files') {
      viewFiles.classList.remove('hidden');
      navBtnFiles.classList.add('active');
      loadCurrentFolder();
    } else if (viewName === 'trash') {
      viewTrash.classList.remove('hidden');
      navBtnTrash.classList.add('active');
      loadTrashList();
    } else if (viewName === 'storage') {
      viewStorage.classList.remove('hidden');
      navBtnStorage.classList.add('active');
      loadStorageAnalytics();
    } else if (viewName === 'activity') {
      viewActivity.classList.remove('hidden');
      navBtnActivity.classList.add('active');
      loadAuditActivity();
    }
  }

  /**
   * Auth Status Check
   */
  async function checkAuthStatus() {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        state.isAuthenticated = data.authenticated;
        state.csrfToken = data.csrfToken || '';
      } else {
        state.isAuthenticated = false;
        state.csrfToken = '';
      }
    } catch (e) {
      state.isAuthenticated = false;
    }
    updateAuthUI();
  }

  function updateAuthUI() {
    const roleBadge = document.getElementById('user-role-badge');
    if (state.isAuthenticated) {
      if (btnAdminAuthHeader) btnAdminAuthHeader.classList.add('hidden');
      if (btnOpenUpload) btnOpenUpload.classList.remove('hidden');
      if (btnAdminLogoutHeader) btnAdminLogoutHeader.classList.remove('hidden');
      if (roleBadge) roleBadge.textContent = 'Admin';
    } else {
      if (btnAdminAuthHeader) btnAdminAuthHeader.classList.remove('hidden');
      if (btnOpenUpload) btnOpenUpload.classList.add('hidden');
      if (btnAdminLogoutHeader) btnAdminLogoutHeader.classList.add('hidden');
      if (roleBadge) roleBadge.textContent = 'Visitor';
    }
  }

  /**
   * Dashboard Summary Controller
   */
  async function loadDashboardMetrics() {
    try {
      const res = await fetch('/api/storage/summary');
      if (res.ok) {
        const data = await res.json();
        const dv = data.docvault || {};
        const disk = data.server_disk || data.disk || {};
        const cat = data.categories || {};

        document.getElementById('dash-storage-used').textContent = formatFileSize(dv.total_size_bytes || 0);
        document.getElementById('dash-count-docs').textContent = dv.file_count || data.counts?.total_files || 0;
        document.getElementById('dash-count-folders').textContent = dv.folder_count || data.counts?.total_folders || 0;
        document.getElementById('dash-count-videos').textContent = cat.videos?.files || data.counts?.videos || 0;
        document.getElementById('dash-count-isos').textContent = cat.iso?.files || data.counts?.isos || 0;

        document.getElementById('dash-docvault-size-badge').textContent = `${formatFileSize(dv.total_size_bytes || 0)} Total User Storage`;

        // Bar segments & legend percentages
        if (cat.documents) {
          document.getElementById('bar-segment-docs').style.width = `${cat.documents.percentage}%`;
          document.getElementById('legend-pct-docs').textContent = `${cat.documents.percentage}%`;
        }
        if (cat.videos) {
          document.getElementById('bar-segment-videos').style.width = `${cat.videos.percentage}%`;
          document.getElementById('legend-pct-videos').textContent = `${cat.videos.percentage}%`;
        }
        if (cat.iso) {
          document.getElementById('bar-segment-isos').style.width = `${cat.iso.percentage}%`;
          document.getElementById('legend-pct-isos').textContent = `${cat.iso.percentage}%`;
        }
        if (cat.images) {
          document.getElementById('bar-segment-images').style.width = `${cat.images.percentage}%`;
          document.getElementById('legend-pct-images').textContent = `${cat.images.percentage}%`;
        }
        if (cat.archives) {
          document.getElementById('bar-segment-archives').style.width = `${cat.archives.percentage}%`;
          document.getElementById('legend-pct-archives').textContent = `${cat.archives.percentage}%`;
        }
        if (cat.other) {
          document.getElementById('bar-segment-other').style.width = `${cat.other.percentage}%`;
          document.getElementById('legend-pct-other').textContent = `${cat.other.percentage}%`;
        }

        // Server disk physical stats
        const usedPct = disk.usage_percent || disk.used_percent || 0;
        document.getElementById('server-disk-percent').textContent = `${usedPct}%`;
        document.getElementById('server-disk-bar').style.width = `${usedPct}%`;
        document.getElementById('server-disk-used').textContent = formatFileSize(disk.used_bytes || disk.used || 0);
        document.getElementById('server-disk-total').textContent = formatFileSize(disk.total_bytes || disk.total || 0);
        document.getElementById('server-disk-free').textContent = formatFileSize(disk.free_bytes || disk.free || 0);

        // Recent files
        const recentGrid = document.getElementById('dash-recent-files-grid');
        const recentList = data.recent_files || data.largest_files || [];
        if (recentGrid && recentList.length > 0) {
          recentGrid.innerHTML = recentList.slice(0, 4).map(f => {
            const extInfo = extensionMap[f.ext] || { icon: '📄' };
            const fname = f.filename || f.name;
            const fsize = f.size_bytes || f.size;
            return `
              <div class="doc-card" onclick="window.DocPortal.selectFileItem('${escapeJS(fname)}', '${escapeJS(f.path)}')">
                <div class="doc-card-top">
                  <span class="doc-type-icon" style="background: var(--bg-card); font-size: 1.5rem;">${extInfo.icon}</span>
                  <span style="font-size: 0.75rem; color: var(--primary-light); font-weight: 700;">${formatFileSize(fsize)}</span>
                </div>
                <div>
                  <div class="doc-card-name" title="${escapeHTML(fname)}">${escapeHTML(fname)}</div>
                  <div class="doc-card-meta">
                    <span>/${escapeHTML(f.path)}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    } catch (e) {
      console.error('Dashboard metrics load error:', e);
    }
  }

  /**
   * Current Folder Explorer Controller
   */
  async function loadCurrentFolder() {
    showLoading(true);
    const subPath = state.currentPath.join('/');
    const cleanPath = subPath ? subPath.replace(/^\/+/, '') : '';
    const endpoint = cleanPath ? `/documents/${cleanPath}/` : '/documents/';

    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      state.currentItems = parseDirectoryListing(data);
      applyFilterAndSort();
      renderBreadcrumbs();
    } catch (e) {
      console.error('Failed loading folder:', e);
      state.currentItems = [];
      applyFilterAndSort();
    } finally {
      showLoading(false);
    }
  }

  function parseDirectoryListing(rawItems) {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .filter(item => item && item.name && !item.name.startsWith('.'))
      .map(item => ({
        name: item.name,
        type: item.type === 'directory' ? 'folder' : 'file',
        size: item.size || 0,
        mtime: item.mtime ? new Date(item.mtime) : new Date(),
        ext: item.type === 'directory' ? '' : getFileExtension(item.name),
        url: buildItemURL(item.name)
      }));
  }

  function buildItemURL(itemName) {
    const parts = [...state.currentPath, itemName].map(p => encodeURIComponent(p));
    return `/documents/${parts.join('/')}`;
  }

  function applyFilterAndSort() {
    let items = [...state.currentItems];

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q));
    }

    items.sort((a, b) => {
      if (state.sortBy === 'type-name-asc') {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      } else if (state.sortBy === 'name-asc') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      } else if (state.sortBy === 'name-desc') {
        return b.name.localeCompare(a.name, undefined, { sensitivity: 'base', numeric: true });
      } else if (state.sortBy === 'date-desc') {
        return b.mtime - a.mtime;
      } else if (state.sortBy === 'date-asc') {
        return a.mtime - b.mtime;
      } else if (state.sortBy === 'size-desc') {
        return b.size - a.size;
      }
      return 0;
    });

    state.filteredItems = items;
    renderExplorer();
  }

  function renderExplorer() {
    if (state.filteredItems.length === 0) {
      emptyState.classList.remove('hidden');
      documentsGrid.classList.add('hidden');
      documentsList.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    if (state.viewMode === 'grid') {
      documentsGrid.classList.remove('hidden');
      documentsList.classList.add('hidden');
      renderGridView();
    } else {
      documentsGrid.classList.add('hidden');
      documentsList.classList.remove('hidden');
      renderListView();
    }
  }

  function renderGridView() {
    documentsGrid.innerHTML = state.filteredItems.map(item => {
      const relPath = [...state.currentPath, item.name].join('/');

      if (item.type === 'folder') {
        return `
          <div class="doc-card" onclick="window.DocPortal.navigateToFolder('${escapeJS(item.name)}')">
            <div class="doc-card-top">
              <span class="doc-type-icon" style="background: var(--folder-bg); color: var(--folder-icon); font-size: 1.5rem;">📁</span>
              <span style="font-size: 0.75rem; color: var(--text-muted);">Folder</span>
            </div>
            <div>
              <div class="doc-card-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
              <div class="doc-card-meta">
                <span>${formatDate(item.mtime)}</span>
              </div>
            </div>
          </div>
        `;
      } else {
        const extInfo = extensionMap[item.ext] || { icon: '📄' };
        return `
          <div class="doc-card" onclick="window.DocPortal.selectFileItem('${escapeJS(item.name)}', '${escapeJS(relPath)}')">
            <div class="doc-card-top">
              <span class="doc-type-icon" style="background: var(--bg-card); font-size: 1.5rem;">${extInfo.icon}</span>
              <span style="font-size: 0.75rem; color: var(--primary-light); font-weight: 700;">${formatFileSize(item.size)}</span>
            </div>
            <div>
              <div class="doc-card-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
              <div class="doc-card-meta">
                <span>${formatDate(item.mtime)}</span>
              </div>
            </div>
          </div>
        `;
      }
    }).join('');
  }

  function renderListView() {
    listTbody.innerHTML = state.filteredItems.map(item => {
      const relPath = [...state.currentPath, item.name].join('/');

      if (item.type === 'folder') {
        return `
          <tr onclick="window.DocPortal.navigateToFolder('${escapeJS(item.name)}')">
            <td><strong style="color: var(--folder-icon);">📁 ${escapeHTML(item.name)}</strong></td>
            <td><span style="color: var(--text-muted); font-size: 0.75rem;">Folder</span></td>
            <td>-</td>
            <td>${formatDate(item.mtime)}</td>
            <td style="text-align: right;"><button class="btn-secondary" style="font-size: 0.75rem; padding: 2px 8px;">Open</button></td>
          </tr>
        `;
      } else {
        const extInfo = extensionMap[item.ext] || { icon: '📄' };
        return `
          <tr onclick="window.DocPortal.selectFileItem('${escapeJS(item.name)}', '${escapeJS(relPath)}')">
            <td><strong>${extInfo.icon} ${escapeHTML(item.name)}</strong></td>
            <td><span style="color: var(--text-muted); font-size: 0.75rem;">${item.ext.toUpperCase()}</span></td>
            <td>${formatFileSize(item.size)}</td>
            <td>${formatDate(item.mtime)}</td>
            <td style="text-align: right;">
              <a href="${item.url}" download class="btn-secondary" style="font-size: 0.75rem; padding: 2px 8px;" onclick="event.stopPropagation();">Download</a>
            </td>
          </tr>
        `;
      }
    }).join('');
  }

  function renderBreadcrumbs() {
    let html = `<span class="breadcrumb-crumb ${state.currentPath.length === 0 ? 'active' : ''}" onclick="window.DocPortal.navigateToBreadcrumb(-1)">Documents</span>`;

    state.currentPath.forEach((folder, idx) => {
      html += ` <span style="color: var(--text-subtle);">/</span> `;
      const isLast = idx === state.currentPath.length - 1;
      html += `<span class="breadcrumb-crumb ${isLast ? 'active' : ''}" onclick="window.DocPortal.navigateToBreadcrumb(${idx})">${escapeHTML(folder)}</span>`;
    });

    breadcrumbsNav.innerHTML = html;
    btnBack.classList.toggle('hidden', state.currentPath.length === 0);
  }

  /**
   * Select File & Right Inspector Drawer Controller
   */
  async function selectFileItem(filename, relPath) {
    const cleanPath = (relPath || '').replace(/^\/+/, '');
    const ext = getFileExtension(filename);
    const extInfo = extensionMap[ext] || { icon: '📄' };

    inspectorIcon.textContent = extInfo.icon;
    inspectorFilename.textContent = filename;
    inspectorSize.textContent = 'Loading...';
    inspectorMtime.textContent = '-';
    inspectorPath.textContent = `/documents/${cleanPath}`;
    inspectorSha256.textContent = 'Computing SHA-256...';
    btnInspectorDownload.href = `/documents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`;

    inspectorPanel.classList.remove('hidden');

    try {
      const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, '/');
      const res = await fetch(`/api/documents/metadata/${encodedPath}`);
      if (res.ok) {
        const data = await res.json();
        inspectorSize.textContent = formatFileSize(data.size);
        inspectorMtime.textContent = formatDate(new Date(data.mtime * 1000));
        inspectorSha256.textContent = data.sha256;

        btnInspectorDelete.onclick = () => {
          handleDeleteClick(filename, cleanPath);
        };
      } else {
        inspectorSha256.textContent = 'Metadata unavailable';
      }
    } catch (e) {
      inspectorSha256.textContent = 'Error computing checksum';
    }
  }

  /**
   * Resumable Upload Engine & Floating Widget Controller
   */
  const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB Chunks
  const INITIAL_CONCURRENCY = 2;
  const DEFAULT_CONCURRENCY = 4;
  const MAX_CONCURRENCY_CAP = 6;

  function handleFileSelect(files) {
    if (!files || files.length === 0) return;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = {
        id: `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        file: file,
        folderPath: state.currentPath.join('/'),
        status: 'queued',
        progressPct: 0,
        uploadedMB: '0.0',
        totalMB: (file.size / (1024 * 1024)).toFixed(1),
        speedMBs: '0.0',
        speedMbps: '0.0',
        etaSec: 0,
        activeWorkers: INITIAL_CONCURRENCY,
        errorMsg: ''
      };
      state.uploadQueue.push(item);
    }
    renderUploadQueueWidget();
    processUploadQueue();
  }

  function renderUploadQueueWidget() {
    if (!state.uploadQueue || state.uploadQueue.length === 0) {
      floatingUploader.classList.add('hidden');
      return;
    }

    floatingUploader.classList.remove('hidden');
    uploaderWidgetBody.innerHTML = state.uploadQueue.map(item => {
      const ext = getFileExtension(item.file.name);
      const extInfo = extensionMap[ext] || { icon: '📄' };

      let metaText = `${item.uploadedMB} / ${item.totalMB} MB`;
      if (item.status === 'uploading') {
        const mbpsText = item.speedMbps ? ` (${item.speedMbps} Mbps)` : '';
        const workersText = item.activeWorkers ? ` • ⚡ ${item.activeWorkers} workers` : '';
        metaText += ` • ${item.speedMBs} MB/s${mbpsText} • ${item.etaSec}s left${workersText}`;
      } else if (item.status === 'completed') {
        metaText = `${item.totalMB} MB • Uploaded cleanly`;
      }

      return `
        <div class="upload-card-item">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem;">
            <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 220px;">${extInfo.icon} ${escapeHTML(item.file.name)}</span>
            <span style="font-size: 0.75rem; color: var(--primary-light); font-weight: 700;">${item.progressPct}%</span>
          </div>
          <div class="upload-progress-bar-bg">
            <div class="upload-progress-bar-fill" style="width: ${item.progressPct}%;"></div>
          </div>
          <div style="font-size: 0.6875rem; color: var(--text-muted); display: flex; justify-content: space-between;">
            <span>${metaText}</span>
            <button class="btn-icon" style="padding: 0; font-size: 0.75rem;" onclick="window.DocPortal.cancelUpload('${item.id}')">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function processUploadQueue() {
    const activeTasks = state.uploadQueue.filter(i => i.status === 'uploading');
    if (activeTasks.length >= 2) return;

    const queuedTasks = state.uploadQueue.filter(i => i.status === 'queued');
    if (queuedTasks.length > 0) {
      startSingleTaskUpload(queuedTasks[0]);
    }
  }

  async function startSingleTaskUpload(item) {
    item.status = 'uploading';
    item.errorMsg = '';
    renderUploadQueueWidget();

    if (item.file.size <= DEFAULT_CHUNK_SIZE) {
      uploadFileSingleRequest(item);
      return;
    }

    try {
      const totalChunks = Math.ceil(item.file.size / DEFAULT_CHUNK_SIZE);

      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.csrfToken || ''
        },
        body: JSON.stringify({
          filename: item.file.name,
          folderPath: item.folderPath,
          totalSize: item.file.size,
          totalChunks: totalChunks,
          replace: true
        })
      });

      if (!initRes.ok) {
        item.status = 'failed';
        item.errorMsg = 'Upload init failed';
        renderUploadQueueWidget();
        processUploadQueue();
        return;
      }

      const initData = await initRes.json();
      const uploadId = initData.uploadId;
      const pendingQueue = Array.from({ length: totalChunks }, (_, i) => i);
      
      let completedBytes = 0;
      const workerInFlight = [0, 0, 0, 0];
      const startTime = Date.now();
      item.activeWorkers = 4;

      // High-Frequency Live UI Ticker (Fires every 250ms / 4x per second for smooth 1-second live updates)
      const uiTicker = setInterval(() => {
        if (item.status === 'uploading') {
          const currentInFlightSum = workerInFlight.reduce((a, b) => a + b, 0);
          const totalUploaded = Math.min(item.file.size, completedBytes + currentInFlightSum);
          
          item.progressPct = Math.min(99, Math.round((totalUploaded / item.file.size) * 100));
          item.uploadedMB = (totalUploaded / (1024 * 1024)).toFixed(1);

          const elapsedSec = (Date.now() - startTime) / 1000;
          const speedBps = elapsedSec > 0 ? (totalUploaded / elapsedSec) : 0;
          const speedMBsNum = (speedBps / (1024 * 1024));
          item.speedMBs = speedMBsNum.toFixed(1);
          item.speedMbps = (speedMBsNum * 8).toFixed(1);
          const remainingBytes = item.file.size - totalUploaded;
          item.etaSec = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0;

          renderUploadQueueWidget();
        } else {
          clearInterval(uiTicker);
        }
      }, 250);

      const runWorker = async (workerId) => {
        while (pendingQueue.length > 0 && item.status === 'uploading') {
          const chunkIndex = pendingQueue.shift();
          if (chunkIndex === undefined) break;

          const start = chunkIndex * DEFAULT_CHUNK_SIZE;
          const end = Math.min(start + DEFAULT_CHUNK_SIZE, item.file.size);
          const chunkBlob = item.file.slice(start, end);
          const chunkSize = end - start;

          workerInFlight[workerId] = 0;

          const success = await new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            item.xhr = xhr;
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', chunkIndex);
            formData.append('chunk', chunkBlob, item.file.name);

            xhr.open('POST', '/api/upload/chunk', true);
            if (state.csrfToken) {
              xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
            }

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                workerInFlight[workerId] = e.loaded;
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(true);
              } else {
                resolve(false);
              }
            };
            xhr.onerror = () => resolve(false);
            xhr.onabort = () => resolve(false);

            xhr.send(formData);
          });

          if (success) {
            completedBytes += chunkSize;
            workerInFlight[workerId] = 0;
          } else {
            workerInFlight[workerId] = 0;
            pendingQueue.unshift(chunkIndex);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      };

      const workers = [runWorker(0), runWorker(1), runWorker(2), runWorker(3)];
      await Promise.all(workers);
      clearInterval(uiTicker);

      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.csrfToken || ''
        },
        body: JSON.stringify({ uploadId: uploadId, replace: true })
      });

      if (completeRes.ok) {
        item.status = 'completed';
        item.progressPct = 100;
        item.uploadedMB = item.totalMB;
        showToast(`✓ Uploaded ${item.file.name} cleanly`);
        renderUploadQueueWidget();
        processUploadQueue();
        if (state.activeView === 'files') loadCurrentFolder();
      } else {
        item.status = 'failed';
        renderUploadQueueWidget();
        processUploadQueue();
      }
    } catch (e) {
      item.status = 'failed';
      renderUploadQueueWidget();
      processUploadQueue();
    }
  }

  function uploadFileSingleRequest(item) {
    const xhr = new XMLHttpRequest();
    item.xhr = xhr;

    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('folderPath', item.folderPath);
    formData.append('replace', 'true');

    xhr.open('POST', '/api/upload', true);
    if (state.csrfToken) {
      xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
    }

    const startTime = Date.now();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        item.progressPct = Math.round((e.loaded / e.total) * 100);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedBps = elapsedSec > 0 ? (e.loaded / elapsedSec) : 0;
        const speedMBsNum = (speedBps / (1024 * 1024));
        item.speedMBs = speedMBsNum.toFixed(1);
        item.speedMbps = (speedMBsNum * 8).toFixed(1);
        item.etaSec = speedBps > 0 ? Math.ceil((e.total - e.loaded) / speedBps) : 0;
        item.uploadedMB = (e.loaded / (1024 * 1024)).toFixed(1);

        renderUploadQueueWidget();
      }
    };

    xhr.onload = () => {
      item.xhr = null;
      if (xhr.status === 200) {
        item.status = 'completed';
        item.progressPct = 100;
        showToast(`✓ Uploaded ${item.file.name}`);
        renderUploadQueueWidget();
        processUploadQueue();
        if (state.activeView === 'files') loadCurrentFolder();
      } else {
        item.status = 'failed';
        renderUploadQueueWidget();
        processUploadQueue();
      }
    };

    xhr.send(formData);
  }

  function cancelUpload(itemId) {
    const item = state.uploadQueue.find(i => i.id === itemId);
    if (item) {
      if (item.xhr) item.xhr.abort();
      item.status = 'cancelled';
      renderUploadQueueWidget();
      processUploadQueue();
    }
  }

  /**
   * Command Palette Search Controller (⌘K)
   */
  function setupCommandPalette() {
    btnSearchTrigger.addEventListener('click', () => {
      commandPaletteModal.classList.remove('hidden');
      commandPaletteInput.value = '';
      commandPaletteInput.focus();
    });

    commandPaletteInput.addEventListener('input', async (e) => {
      const q = e.target.value.trim();
      if (!q) {
        commandPaletteResults.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.875rem;">Type to search server documents...</div>`;
        return;
      }

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const results = await res.json();
          if (!results || results.length === 0) {
            commandPaletteResults.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.875rem;">No document matches found</div>`;
            return;
          }
          commandPaletteResults.innerHTML = results.map(item => `
            <div class="palette-result-item" onclick="window.DocPortal.selectFileItem('${escapeJS(item.name)}', '${escapeJS(item.path)}')">
              <div>
                <strong>📄 ${escapeHTML(item.name)}</strong>
                <div style="font-size: 0.75rem; color: var(--text-muted);">/${escapeHTML(item.path)}</div>
              </div>
              <span style="font-size: 0.75rem; color: var(--primary-light); font-weight: 700;">${formatFileSize(item.size)}</span>
            </div>
          `).join('');
        }
      } catch (err) {
        commandPaletteResults.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--danger); font-size: 0.875rem;">Search error</div>`;
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        commandPaletteModal.classList.remove('hidden');
        commandPaletteInput.focus();
      } else if (e.key === 'Escape') {
        commandPaletteModal.classList.add('hidden');
        authModal.classList.add('hidden');
        inspectorPanel.classList.add('hidden');
      }
    });

    commandPaletteModal.addEventListener('click', (e) => {
      if (e.target === commandPaletteModal) commandPaletteModal.classList.add('hidden');
    });
  }

  /**
   * Delete & Trash Operations
   */
  async function handleDeleteClick(filename, cleanPath) {
    if (!confirm(`Are you sure you want to move '${filename}' to Trash?`)) return;

    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': state.csrfToken || '' }
      });

      if (res.ok) {
        showToast(`✓ '${filename}' moved to Trash`);
        inspectorPanel.classList.add('hidden');
        if (state.activeView === 'files') loadCurrentFolder();
        if (state.activeView === 'trash') loadTrashList();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Failed to move to Trash.');
      }
    } catch (e) {
      alert('Delete operation failed.');
    }
  }

  async function loadTrashList() {
    const tbody = document.getElementById('trash-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 1.5rem;">Loading trash contents...</td></tr>`;

    try {
      const res = await fetch('/api/trash');
      if (res.ok) {
        const list = await res.json();
        if (!list || list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 1.5rem; color: var(--text-muted);">Trash is empty.</td></tr>`;
          return;
        }
        tbody.innerHTML = list.map(item => `
          <tr>
            <td><strong>${escapeHTML(item.name)}</strong></td>
            <td><code style="font-size: 0.75rem; color: var(--text-muted);">/${escapeHTML(item.original_path)}</code></td>
            <td>${formatDate(new Date(item.deleted_at * 1000))}</td>
            <td style="text-align: right;">
              <button class="btn-secondary" style="font-size:0.75rem; padding: 3px 8px;" onclick="window.DocPortal.restoreTrashItem('${item.id}')">↩ Restore</button>
              <button class="btn-secondary" style="font-size:0.75rem; padding: 3px 8px; color: var(--danger);" onclick="window.DocPortal.deleteTrashItem('${item.id}')">🗑️ Permanent Delete</button>
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 1.5rem; color: var(--danger);">Admin sign in required to view trash.</td></tr>`;
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 1.5rem; color: var(--danger);">Failed loading trash.</td></tr>`;
    }
  }

  async function restoreTrashItem(trashId) {
    try {
      const res = await fetch(`/api/trash/restore/${trashId}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': state.csrfToken || '' }
      });
      if (res.ok) {
        showToast('✓ Item restored successfully');
        loadTrashList();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Could not restore item.');
      }
    } catch (e) {
      alert('Error restoring item.');
    }
  }

  async function deleteTrashItem(trashId) {
    if (!confirm('Permanently delete this item? This action cannot be undone.')) return;
    try {
      const res = await fetch(`/api/trash/permanent/${trashId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': state.csrfToken || '' }
      });
      if (res.ok) {
        showToast('✓ Permanently deleted item');
        loadTrashList();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Could not delete item.');
      }
    } catch (e) {
      alert('Error deleting item.');
    }
  }

  /**
   * Storage Analytics Controller
   */
  async function loadStorageAnalytics() {
    const container = document.getElementById('storage-metrics-container');
    if (!container) return;
    container.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Loading storage metrics...</div>`;

    try {
      const res = await fetch('/api/storage/summary');
      if (res.ok) {
        const data = await res.json();
        const dv = data.docvault || {};
        const disk = data.server_disk || data.disk || {};
        const cat = data.categories || {};

        container.innerHTML = `
          <div style="margin-bottom: 0.5rem;"><span style="font-size: 0.75rem; font-weight: 700; letter-spacing: 1px; color: var(--primary-light); text-transform: uppercase;">DocVault Storage (/documents)</span></div>
          <div class="storage-overview-card" style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>DocVault Storage Usage</strong>
              <span style="font-weight: 700; color: var(--primary-light);">${formatFileSize(dv.total_size_bytes || 0)} (${dv.file_count || 0} files, ${dv.folder_count || 0} folders)</span>
            </div>
            <div class="storage-bar-bg" style="height: 14px; margin: 1rem 0;">
              <div style="background: var(--primary-gradient); height: 100%; width: 100%;"></div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; font-size: 0.8125rem;">
              <div>📄 Documents: <strong>${formatFileSize(cat.documents?.size_bytes || 0)}</strong> (${cat.documents?.percentage || 0}%)</div>
              <div>🎥 Videos: <strong>${formatFileSize(cat.videos?.size_bytes || 0)}</strong> (${cat.videos?.percentage || 0}%)</div>
              <div>💿 ISO Images: <strong>${formatFileSize(cat.iso?.size_bytes || 0)}</strong> (${cat.iso?.percentage || 0}%)</div>
              <div>🖼️ Images: <strong>${formatFileSize(cat.images?.size_bytes || 0)}</strong> (${cat.images?.percentage || 0}%)</div>
              <div>📦 Archives: <strong>${formatFileSize(cat.archives?.size_bytes || 0)}</strong> (${cat.archives?.percentage || 0}%)</div>
              <div>📃 Other: <strong>${formatFileSize(cat.other?.size_bytes || 0)}</strong> (${cat.other?.percentage || 0}%)</div>
            </div>
          </div>

          <div style="margin-bottom: 0.5rem;"><span style="font-size: 0.75rem; font-weight: 700; letter-spacing: 1px; color: var(--text-muted); text-transform: uppercase;">Server Physical Disk</span></div>
          <div class="storage-overview-card" style="margin-bottom: 1.5rem; background: var(--bg-card);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>Physical File System Capacity</strong>
              <span style="font-weight: 700; color: var(--accent-cyan);">${disk.usage_percent || disk.used_percent || 0}% Disk Used</span>
            </div>
            <div class="storage-bar-bg" style="height: 8px; margin: 0.75rem 0;">
              <div style="background: var(--accent-cyan); height: 100%; width: ${disk.usage_percent || disk.used_percent || 0}%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
              <span>Disk Used: <strong>${formatFileSize(disk.used_bytes || disk.used || 0)}</strong></span>
              <span>Total Capacity: <strong>${formatFileSize(disk.total_bytes || disk.total || 0)}</strong></span>
              <span>Free Capacity: <strong>${formatFileSize(disk.free_bytes || disk.free || 0)}</strong></span>
            </div>
          </div>

          <h3 style="font-size: 1rem; font-weight: 700; margin-bottom: 1rem;">Top 10 Largest User Storage Files</h3>
          <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden;">
            <table class="documents-list-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Path</th>
                  <th style="text-align: right;">Size</th>
                </tr>
              </thead>
              <tbody>
                ${(data.largest_files || []).map(f => `
                  <tr onclick="window.DocPortal.selectFileItem('${escapeJS(f.filename || f.name)}', '${escapeJS(f.path)}')">
                    <td><strong>📄 ${escapeHTML(f.filename || f.name)}</strong></td>
                    <td><code style="font-size: 0.75rem; color: var(--text-muted);">/${escapeHTML(f.path)}</code></td>
                    <td style="text-align: right; color: var(--primary-light); font-weight: 700;">${formatFileSize(f.size_bytes || f.size)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    } catch (e) {
      container.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--danger);">Failed loading storage analytics.</div>`;
    }
  }

  /**
   * Audit Activity Log Controller
   */
  async function loadAuditActivity() {
    const container = document.getElementById('activity-log-timeline');
    if (!container) return;
    container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">Loading audit timeline...</div>`;

    try {
      const res = await fetch('/api/admin/audit-logs');
      if (res.ok) {
        const logs = await res.json();
        if (!logs || logs.length === 0) {
          container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No audit activity recorded yet.</div>`;
          return;
        }
        container.innerHTML = logs.reverse().slice(0, 50).map(log => `
          <div style="padding: 0.75rem; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); font-size: 0.8125rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <strong style="color: var(--primary-light);">${escapeHTML(log.action)}</strong>
              <span style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(new Date(log.timestamp))}</span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.75rem;">IP: ${escapeHTML(log.ip)} • Details: ${escapeHTML(JSON.stringify(log.details || {}))}</div>
          </div>
        `).join('');
      } else {
        container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--danger);">Admin sign in required to view audit logs.</div>`;
      }
    } catch (e) {
      container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--danger);">Failed loading activity log.</div>`;
    }
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    // Navigation Buttons
    navBtnDashboard.addEventListener('click', () => switchView('dashboard'));
    navBtnFiles.addEventListener('click', () => switchView('files'));
    navBtnTrash.addEventListener('click', () => switchView('trash'));
    navBtnStorage.addEventListener('click', () => switchView('storage'));
    navBtnActivity.addEventListener('click', () => switchView('activity'));

    // View toggles
    btnGridView.addEventListener('click', () => applyViewMode('grid'));
    btnListView.addEventListener('click', () => applyViewMode('list'));
    btnRefresh.addEventListener('click', () => loadCurrentFolder());
    btnBack.addEventListener('click', () => {
      if (state.currentPath.length > 0) {
        setPath(state.currentPath.slice(0, -1));
      }
    });

    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFilterAndSort();
    });

    // Inspector close
    btnCloseInspector.addEventListener('click', () => inspectorPanel.classList.add('hidden'));

    // Copy SHA-256 Checksum
    btnCopyInspectorSha256.addEventListener('click', () => {
      const text = inspectorSha256.textContent;
      if (text && text !== 'Computing SHA-256...') {
        navigator.clipboard.writeText(text);
        showToast('✓ SHA-256 copied to clipboard');
      }
    });

    // Upload Triggers & File Inputs
    btnOpenUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files) handleFileSelect(e.target.files);
    });

    btnCloseUploaderWidget.addEventListener('click', () => floatingUploader.classList.add('hidden'));

    // Admin Auth Listeners
    const openAuthModal = () => {
      authPasswordInput.value = '';
      authErrorMsg.classList.add('hidden');
      authModal.classList.remove('hidden');
      authPasswordInput.focus();
    };

    if (btnAdminAuthHeader) btnAdminAuthHeader.addEventListener('click', openAuthModal);
    if (btnAdminAuthSidebar) btnAdminAuthSidebar.addEventListener('click', openAuthModal);
    if (btnAuthCancel) btnAuthCancel.addEventListener('click', () => authModal.classList.add('hidden'));

    if (btnAdminLogoutHeader) {
      btnAdminLogoutHeader.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        state.isAuthenticated = false;
        updateAuthUI();
        showToast('Logged out successfully');
      });
    }

    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      authErrorMsg.classList.add('hidden');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: authPasswordInput.value })
        });

        if (res.ok) {
          const data = await res.json();
          state.isAuthenticated = true;
          state.csrfToken = data.csrfToken || '';
          updateAuthUI();
          authModal.classList.add('hidden');
          showToast('✓ Admin login successful');
        } else {
          authErrorMsg.textContent = 'Invalid admin credentials';
          authErrorMsg.classList.remove('hidden');
        }
      } catch (err) {
        authErrorMsg.textContent = 'Login network error';
        authErrorMsg.classList.remove('hidden');
      }
    });

    setupCommandPalette();
  }

  /* Utility Helpers */
  function applyViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem('docvault_view_mode', mode);
    btnGridView.classList.toggle('active', mode === 'grid');
    btnListView.classList.toggle('active', mode === 'list');
    renderExplorer();
  }

  function setPath(newPathArr) {
    state.currentPath = newPathArr;
    window.location.hash = state.currentPath.map(p => encodeURIComponent(p)).join('/');
    loadCurrentFolder();
  }

  function parseHashAndNavigate() {
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    if (!rawHash) {
      state.currentPath = [];
    } else {
      state.currentPath = rawHash.split('/').map(p => decodeURIComponent(p)).filter(Boolean);
    }
  }

  function navigateToFolder(folderName) {
    setPath([...state.currentPath, folderName]);
  }

  function navigateToBreadcrumb(index) {
    if (index === -1) {
      setPath([]);
    } else {
      setPath(state.currentPath.slice(0, index + 1));
    }
  }

  function showLoading(isLoading) {
    if (isLoading) {
      loadingState.classList.remove('hidden');
      documentsGrid.classList.add('hidden');
      documentsList.classList.add('hidden');
      emptyState.classList.add('hidden');
    } else {
      loadingState.classList.add('hidden');
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  function getFileExtension(filename) {
    const parts = (filename || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return 'Unknown';
    return dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHTML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function escapeJS(str) {
    return String(str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  // Export public helpers
  window.DocPortal = {
    navigateToFolder,
    navigateToBreadcrumb,
    selectFileItem,
    cancelUpload,
    handleDeleteClick,
    restoreTrashItem,
    deleteTrashItem
  };

  // Start App
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
