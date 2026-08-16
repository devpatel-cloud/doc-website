/**
 * DocVault V2 — Client Engine
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
    
    // Auth & Upload State
    isAuthenticated: false,
    csrfToken: '',
    selectedUploadPath: '', // e.g. "DevOps/Docker"
    folderTreeData: null,
    queuedFiles: [], // Array of File objects
    uploadingIndex: -1,
    duplicateContext: null // { file, folderPath }
  };

  // Public DOM Elements
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search');
  const sortSelect = document.getElementById('sort-select');
  const btnGridView = document.getElementById('btn-grid-view');
  const btnListView = document.getElementById('btn-list-view');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnBack = document.getElementById('btn-back');
  const breadcrumbsNav = document.getElementById('breadcrumbs');

  const loadingState = document.getElementById('loading-state');
  const documentsGrid = document.getElementById('documents-grid');
  const documentsList = document.getElementById('documents-list');
  const listTbody = document.getElementById('list-tbody');
  const emptyState = document.getElementById('empty-state');
  const emptyTitle = document.getElementById('empty-title');
  const emptyMessage = document.getElementById('empty-message');
  const resetSearchBtn = document.getElementById('reset-search-btn');

  const currentFolderTitle = document.getElementById('current-folder-title');
  const itemCountEl = document.getElementById('item-count');
  const folderCountEl = document.getElementById('folder-count');
  const fileCountEl = document.getElementById('file-count');

  // Preview Modal Elements
  const viewerModal = document.getElementById('viewer-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalExtBadge = document.getElementById('modal-ext-badge');
  const modalExternalBtn = document.getElementById('modal-external-btn');
  const modalDownloadBtn = document.getElementById('modal-download-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalBody = document.getElementById('modal-body');

  // Admin Auth & Upload Elements
  const btnOpenUpload = document.getElementById('btn-open-upload');
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authPasswordInput = document.getElementById('auth-password-input');
  const authErrorMsg = document.getElementById('auth-error-msg');
  const authCancelBtn = document.getElementById('auth-cancel-btn');
  const authCloseBtn = document.getElementById('auth-close-btn');

  const uploadModal = document.getElementById('upload-modal');
  const uploadCloseBtn = document.getElementById('upload-close-btn');
  const btnAdminLogout = document.getElementById('btn-admin-logout');

  const selectedFolderDisplay = document.getElementById('selected-folder-display');
  const folderTreeContainer = document.getElementById('folder-tree-container');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const fileQueueContainer = document.getElementById('file-queue-container');
  const queueCountEl = document.getElementById('queue-count');
  const fileQueueList = document.getElementById('file-queue-list');

  const overallProgressBox = document.getElementById('overall-progress-box');
  const progressStatusText = document.getElementById('progress-status-text');
  const overallProgressPct = document.getElementById('overall-progress-pct');
  const overallProgressFill = document.getElementById('overall-progress-fill');

  const btnClearQueue = document.getElementById('btn-clear-queue');
  const btnStartUpload = document.getElementById('btn-start-upload');

  // Duplicate Modal Elements
  const duplicateModal = document.getElementById('duplicate-modal');
  const duplicateMsgText = document.getElementById('duplicate-msg-text');
  const btnDupCancel = document.getElementById('btn-dup-cancel');
  const btnDupReplace = document.getElementById('btn-dup-replace');

  // File Extension Categories & Metadata
  const extensionMap = {
    pdf: { category: 'pdf', label: 'PDF', iconClass: 'type-pdf' },
    doc: { category: 'doc', label: 'DOC', iconClass: 'type-doc' },
    docx: { category: 'doc', label: 'DOCX', iconClass: 'type-doc' },
    txt: { category: 'doc', label: 'TXT', iconClass: 'type-text' },
    md: { category: 'doc', label: 'MD', iconClass: 'type-text' },
    rtf: { category: 'doc', label: 'RTF', iconClass: 'type-doc' },

    xls: { category: 'sheet', label: 'XLS', iconClass: 'type-sheet' },
    xlsx: { category: 'sheet', label: 'XLSX', iconClass: 'type-sheet' },
    csv: { category: 'sheet', label: 'CSV', iconClass: 'type-sheet' },

    png: { category: 'image', label: 'PNG', iconClass: 'type-image' },
    jpg: { category: 'image', label: 'JPG', iconClass: 'type-image' },
    jpeg: { category: 'image', label: 'JPEG', iconClass: 'type-image' },
    svg: { category: 'image', label: 'SVG', iconClass: 'type-image' },
    webp: { category: 'image', label: 'WEBP', iconClass: 'type-image' },

    mp4: { category: 'video', label: 'MP4', iconClass: 'type-video' },
    webm: { category: 'video', label: 'WEBM', iconClass: 'type-video' },
    mkv: { category: 'video', label: 'MKV', iconClass: 'type-video' },
    mov: { category: 'video', label: 'MOV', iconClass: 'type-video' },
    avi: { category: 'video', label: 'AVI', iconClass: 'type-video' },

    zip: { category: 'archive', label: 'ZIP', iconClass: 'type-archive' },
    tar: { category: 'archive', label: 'TAR', iconClass: 'type-archive' },
    gz: { category: 'archive', label: 'GZ', iconClass: 'type-archive' },
    '7z': { category: 'archive', label: '7Z', iconClass: 'type-archive' }
  };

  /**
   * App Initialization
   */
  async function init() {
    setupEventListeners();
    applyViewMode(state.viewMode);
    await checkAuthStatus();
    parseHashAndNavigate();
  }

  /**
   * Check Auth Status
   */
  async function checkAuthStatus() {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        state.isAuthenticated = !!data.authenticated;
        if (data.csrfToken) {
          state.csrfToken = data.csrfToken;
        }
      }
    } catch (e) {
      state.isAuthenticated = false;
    }
  }

  /**
   * Parse URL Hash & Trigger Navigation
   */
  function parseHashAndNavigate() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    if (!hash) {
      state.currentPath = [];
    } else {
      state.currentPath = hash.split('/').map(decodeURIComponent).filter(Boolean);
    }
    loadCurrentFolder();
  }

  /**
   * Set Path & Update Hash
   */
  function setPath(newPathArray) {
    state.currentPath = newPathArray;
    const hashString = '#' + newPathArray.map(encodeURIComponent).join('/');
    window.location.hash = hashString;
    loadCurrentFolder();
  }

  /**
   * Fetch current directory from Nginx JSON Autoindex
   */
  async function loadCurrentFolder() {
    showLoading(true);
    updateNavigationUI();

    const pathSubString = state.currentPath.length > 0 
      ? state.currentPath.map(encodeURIComponent).join('/') + '/' 
      : '';
    
    const apiEndpoint = `/api/documents/${pathSubString}`;

    try {
      const response = await fetch(apiEndpoint, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Server status ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data)) {
        const items = data.filter(item => item.name && !item.name.startsWith('.'));

        state.currentItems = await Promise.all(items.map(async item => {
          const isDir = item.type === 'directory';
          const relativePath = [...state.currentPath, item.name].join('/');
          const docUrl = `/documents/${encodeURIComponent(relativePath.replace(/\/+/g, '/'))}`;

          let childCount = null;
          if (isDir) {
            childCount = await fetchFolderItemCount([...state.currentPath, item.name]);
          }

          return {
            name: item.name,
            isFolder: isDir,
            size: item.size || 0,
            mtime: new Date(item.mtime || Date.now()),
            url: docUrl,
            ext: isDir ? 'folder' : getFileExtension(item.name),
            path: [...state.currentPath, item.name],
            childCount: childCount
          };
        }));
      } else {
        state.currentItems = [];
      }
    } catch (err) {
      console.error('Error fetching directory contents:', err);
      state.currentItems = [];
    } finally {
      showLoading(false);
      applyFilterAndSort();
    }
  }

  /**
   * Fetch item count inside subfolder
   */
  async function fetchFolderItemCount(pathArray) {
    try {
      const pathSubString = pathArray.map(encodeURIComponent).join('/') + '/';
      const response = await fetch(`/api/documents/${pathSubString}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          return data.filter(item => item.name && !item.name.startsWith('.')).length;
        }
      }
    } catch (e) {}
    return 0;
  }

  /**
   * Filter and Sort Items
   */
  function applyFilterAndSort() {
    let result = [...state.currentItems];

    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(item => 
        item.name.toLowerCase().includes(q) || item.ext.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      if (state.sortBy === 'type-name-asc') {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      switch (state.sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'name-desc':
          return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'date-desc':
          return b.mtime - a.mtime;
        case 'date-asc':
          return a.mtime - b.mtime;
        case 'size-desc':
          return b.size - a.size;
        default:
          return 0;
      }
    });

    state.filteredItems = result;
    render();
  }

  /**
   * Render UI
   */
  function render() {
    const folders = state.currentItems.filter(i => i.isFolder);
    const files = state.currentItems.filter(i => !i.isFolder);

    itemCountEl.textContent = state.filteredItems.length;
    folderCountEl.textContent = folders.length;
    fileCountEl.textContent = files.length;

    if (state.filteredItems.length === 0) {
      documentsGrid.classList.add('hidden');
      documentsList.classList.add('hidden');
      emptyState.classList.remove('hidden');

      if (state.searchQuery.trim() !== '') {
        emptyTitle.textContent = 'No matches found';
        emptyMessage.textContent = `No files or folders matched "${state.searchQuery}".`;
        resetSearchBtn.classList.remove('hidden');
      } else {
        emptyTitle.textContent = 'This folder is empty';
        emptyMessage.textContent = 'No files or subfolders found inside this directory.';
        resetSearchBtn.classList.add('hidden');
      }
      return;
    }

    emptyState.classList.add('hidden');

    if (state.viewMode === 'grid') {
      renderGridView();
      documentsGrid.classList.remove('hidden');
      documentsList.classList.add('hidden');
    } else {
      renderListView();
      documentsList.classList.remove('hidden');
      documentsGrid.classList.add('hidden');
    }
  }

  /**
   * Render Grid View Cards
   */
  function renderGridView() {
    documentsGrid.innerHTML = state.filteredItems.map(item => {
      if (item.isFolder) {
        const countText = item.childCount !== null ? `${item.childCount} ${item.childCount === 1 ? 'item' : 'items'}` : 'Folder';
        return `
          <div class="doc-card folder-card" onclick="window.DocPortal.navigateToFolder('${escapeJS(item.name)}')">
            <div class="doc-card-header">
              <div class="doc-icon-wrapper type-folder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span class="doc-badge type-folder">Folder</span>
            </div>
            <div>
              <h3 class="doc-title" title="${escapeHTML(item.name)}">📁 ${escapeHTML(item.name)}</h3>
              <div class="doc-meta">
                <span>${countText}</span>
              </div>
            </div>
            <div class="doc-card-actions">
              <button class="btn-card-action btn-open-folder">
                Open Folder →
              </button>
            </div>
          </div>
        `;
      } else {
        const extInfo = extensionMap[item.ext] || {
          category: 'other',
          label: (item.ext || 'FILE').toUpperCase(),
          iconClass: 'type-text'
        };

        return `
          <div class="doc-card">
            <div class="doc-card-header">
              <div class="doc-icon-wrapper ${extInfo.iconClass}">
                ${getFileSVGIcon(extInfo.category)}
              </div>
              <span class="doc-badge ${extInfo.iconClass}">${extInfo.label}</span>
            </div>
            <div>
              <h3 class="doc-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</h3>
              <div class="doc-meta">
                <span>${formatFileSize(item.size)}</span>
                <span>•</span>
                <span>${formatDate(item.mtime)}</span>
              </div>
            </div>
            <div class="doc-card-actions">
              <button class="btn-card-action btn-view" onclick="window.DocPortal.openViewer('${escapeJS(item.name)}', '${escapeJS(item.url)}', '${escapeJS(item.ext)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                ${extInfo.category === 'video' ? 'Play' : 'View'}
              </button>
              <a href="${item.url}" download class="btn-card-action btn-download-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download
              </a>
            </div>
          </div>
        `;
      }
    }).join('');
  }

  /**
   * Render List View Rows
   */
  function renderListView() {
    listTbody.innerHTML = state.filteredItems.map(item => {
      if (item.isFolder) {
        const countText = item.childCount !== null ? `${item.childCount} items` : 'Folder';
        return `
          <tr class="row-folder" onclick="window.DocPortal.navigateToFolder('${escapeJS(item.name)}')">
            <td class="col-name">
              <div class="list-doc-name">
                <div class="list-icon-small type-folder">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <strong title="${escapeHTML(item.name)}">📁 ${escapeHTML(item.name)}</strong>
              </div>
            </td>
            <td class="col-type">
              <span class="doc-badge type-folder">Folder</span>
            </td>
            <td class="col-size">${countText}</td>
            <td class="col-date">${formatDate(item.mtime)}</td>
            <td class="col-actions">
              <button class="btn-secondary" style="padding: 0.25rem 0.625rem; font-size: 0.75rem;">Open →</button>
            </td>
          </tr>
        `;
      } else {
        const extInfo = extensionMap[item.ext] || {
          category: 'other',
          label: (item.ext || 'FILE').toUpperCase(),
          iconClass: 'type-text'
        };

        return `
          <tr>
            <td class="col-name">
              <div class="list-doc-name">
                <div class="list-icon-small ${extInfo.iconClass}">
                  ${getFileSVGIcon(extInfo.category, 18)}
                </div>
                <span title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
              </div>
            </td>
            <td class="col-type">
              <span class="doc-badge ${extInfo.iconClass}">${extInfo.label}</span>
            </td>
            <td class="col-size">${formatFileSize(item.size)}</td>
            <td class="col-date">${formatDate(item.mtime)}</td>
            <td class="col-actions">
              <div class="list-actions">
                <button class="btn-icon-action" title="View Document" onclick="window.DocPortal.openViewer('${escapeJS(item.name)}', '${escapeJS(item.url)}', '${escapeJS(item.ext)}')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
                <a href="${item.url}" download class="btn-icon-action" title="Download Document">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                </a>
              </div>
            </td>
          </tr>
        `;
      }
    }).join('');
  }

  /**
   * Render Navigation Bar UI
   */
  function updateNavigationUI() {
    if (state.currentPath.length > 0) {
      btnBack.classList.remove('hidden');
    } else {
      btnBack.classList.add('hidden');
    }

    let html = `
      <a href="#" class="breadcrumb-item ${state.currentPath.length === 0 ? 'active' : ''}" onclick="window.DocPortal.navigateToBreadcrumb(-1); return false;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        Documents
      </a>
    `;

    state.currentPath.forEach((segment, idx) => {
      const isLast = idx === state.currentPath.length - 1;
      html += `<span class="breadcrumb-separator">/</span>`;
      if (isLast) {
        html += `<span class="breadcrumb-item active">${escapeHTML(segment)}</span>`;
      } else {
        html += `<a href="#" class="breadcrumb-item" onclick="window.DocPortal.navigateToBreadcrumb(${idx}); return false;">${escapeHTML(segment)}</a>`;
      }
    });

    breadcrumbsNav.innerHTML = html;

    if (state.currentPath.length === 0) {
      currentFolderTitle.innerHTML = 'Location: <strong>Documents Root</strong>';
    } else {
      const folderName = state.currentPath[state.currentPath.length - 1];
      currentFolderTitle.innerHTML = `Location: <strong>${escapeHTML(folderName)}</strong>`;
    }
  }

  /**
   * Open Modal Document & Video Viewer
   */
  async function openViewer(name, url, ext) {
    modalTitle.textContent = name;
    modalExtBadge.textContent = (ext || 'file').toUpperCase();
    modalExternalBtn.href = url;
    modalDownloadBtn.href = url;

    const extInfo = extensionMap[ext] || { category: 'other' };

    modalBody.innerHTML = '<div style="padding: 2rem; text-align: center;">Loading preview...</div>';
    viewerModal.classList.remove('hidden');

    if (extInfo.category === 'pdf') {
      modalBody.innerHTML = `<iframe class="modal-iframe" src="${url}" title="PDF Preview"></iframe>`;
    } else if (extInfo.category === 'image') {
      modalBody.innerHTML = `<img class="modal-image" src="${url}" alt="${escapeHTML(name)}">`;
    } else if (ext === 'mp4' || ext === 'webm') {
      modalBody.innerHTML = `
        <video class="modal-video-preview" controls autoplay preload="metadata">
          <source src="${url}" type="video/${ext}">
          Your browser does not support HTML5 video preview.
        </video>
      `;
    } else if (['txt', 'md', 'csv', 'json', 'log'].includes(ext)) {
      try {
        const textRes = await fetch(url);
        const textContent = await textRes.text();
        modalBody.innerHTML = `<pre class="modal-text-preview"><code>${escapeHTML(textContent)}</code></pre>`;
      } catch (e) {
        renderModalFallback(name, url);
      }
    } else {
      renderModalFallback(name, url);
    }
  }

  function renderModalFallback(name, url) {
    modalBody.innerHTML = `
      <div class="modal-fallback">
        <div class="empty-icon" style="margin-bottom: 1rem;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <h3 style="margin-bottom: 0.5rem; font-size: 1.1rem;">Direct Download Required</h3>
        <p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 1.5rem;">
          This file format cannot be displayed directly in the web browser preview.
        </p>
        <a href="${url}" download class="btn-secondary" style="display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none;">
          Download File
        </a>
      </div>
    `;
  }

  function closeModal() {
    viewerModal.classList.add('hidden');
    modalBody.innerHTML = '';
  }

  /* ==========================================================================
     Admin Auth & Upload Drawer Logic
     ========================================================================== */

  function handleOpenUploadClick() {
    if (state.isAuthenticated) {
      openUploadDrawer();
    } else {
      authPasswordInput.value = '';
      authErrorMsg.classList.add('hidden');
      authModal.classList.remove('hidden');
      authPasswordInput.focus();
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const password = authPasswordInput.value;
    authErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        const data = await res.json();
        state.isAuthenticated = true;
        state.csrfToken = data.csrfToken || '';
        authModal.classList.add('hidden');
        openUploadDrawer();
      } else {
        const errData = await res.json();
        authErrorMsg.textContent = errData.detail || 'Invalid credentials.';
        authErrorMsg.classList.remove('hidden');
      }
    } catch (err) {
      authErrorMsg.textContent = 'Server error. Please try again.';
      authErrorMsg.classList.remove('hidden');
    }
  }

  async function handleAdminLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    state.isAuthenticated = false;
    uploadModal.classList.add('hidden');
  }

  async function openUploadDrawer() {
    // Default selected path to current viewing folder if any
    state.selectedUploadPath = state.currentPath.join('/');
    selectedFolderDisplay.textContent = state.selectedUploadPath ? `Documents / ${state.selectedUploadPath}` : 'Documents Root';
    
    uploadModal.classList.remove('hidden');
    await fetchAndRenderFolderTree();
  }

  async function fetchAndRenderFolderTree() {
    folderTreeContainer.innerHTML = '<div style="padding: 1rem; color: var(--text-muted);">Loading folder tree...</div>';
    try {
      const res = await fetch('/api/folders');
      if (res.ok) {
        state.folderTreeData = await res.json();
        renderFolderTree();
      }
    } catch (err) {
      folderTreeContainer.innerHTML = '<div style="padding: 1rem; color: var(--danger);">Failed to load folders.</div>';
    }
  }

  function renderFolderTree() {
    if (!state.folderTreeData) return;

    function buildNodeHTML(node) {
      const isSelected = node.path === state.selectedUploadPath;
      const displayName = node.name === 'Documents' ? '📁 Documents Root' : `📁 ${escapeHTML(node.name)}`;

      let html = `
        <div class="tree-node ${isSelected ? 'selected' : ''}" data-path="${escapeHTML(node.path)}">
          <span>${displayName}</span>
        </div>
      `;

      if (node.children && node.children.length > 0) {
        html += `<div class="tree-children">`;
        node.children.forEach(child => {
          html += buildNodeHTML(child);
        });
        html += `</div>`;
      }
      return html;
    }

    folderTreeContainer.innerHTML = buildNodeHTML(state.folderTreeData);

    // Add node click listeners
    folderTreeContainer.querySelectorAll('.tree-node').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        folderTreeContainer.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');

        state.selectedUploadPath = el.dataset.path;
        selectedFolderDisplay.textContent = state.selectedUploadPath ? `Documents / ${state.selectedUploadPath}` : 'Documents Root';
      });
    });
  }

  /* Independent Stateful Upload Queue Architecture */
  const MAX_CONCURRENT_UPLOADS = 2;
  state.uploadQueue = []; // items: { id, file, folderPath, status, progressPct, uploadedMB, totalMB, speedMBs, etaSec, errorMsg, xhr, replace }

  function getFriendlyErrorMessage(status, rawError) {
    if (!status || status === 0) {
      return "Connection interrupted. Please check your network connection and try again.";
    }
    if (status === 413) {
      return "This file is too large. The maximum allowed size is 2 GB.";
    }
    if (status === 401) {
      return "Your upload session has expired. Please sign in again.";
    }
    if (status === 403) {
      return "You don't have permission to upload to this folder.";
    }
    if (status === 415) {
      return "This file type isn't supported.";
    }
    if (status === 507) {
      return "The server doesn't have enough storage space for this file.";
    }
    if (status === 409) {
      return "A file with this name already exists in the destination folder.";
    }
    if (status === 504 || status === 408) {
      return "The upload took too long and was interrupted. Please try again.";
    }
    return rawError || "Something went wrong while uploading this file. Please try again.";
  }

  function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', '3gp'].includes(ext)) return '🎬';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return '📦';
    if (ext === 'pdf') return '📄';
    return '📁';
  }

  function addFilesToQueue(files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = {
        id: `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        file: file,
        folderPath: state.selectedUploadPath || '',
        status: 'queued', // queued, uploading, completed, failed, cancelled
        progressPct: 0,
        uploadedMB: '0.0',
        totalMB: (file.size / (1024 * 1024)).toFixed(1),
        speedMBs: '0.0',
        etaSec: 0,
        errorMsg: '',
        xhr: null,
        replace: false
      };
      state.uploadQueue.push(item);
    }
    renderUploadQueue();
  }

  function renderUploadQueue() {
    if (!state.uploadQueue || state.uploadQueue.length === 0) {
      fileQueueContainer.classList.add('hidden');
      return;
    }

    fileQueueContainer.classList.remove('hidden');

    const total = state.uploadQueue.length;
    const completed = state.uploadQueue.filter(i => i.status === 'completed').length;
    const uploading = state.uploadQueue.filter(i => i.status === 'uploading').length;
    const failed = state.uploadQueue.filter(i => i.status === 'failed').length;
    const queued = state.uploadQueue.filter(i => i.status === 'queued').length;

    const summaryText = document.getElementById('queue-summary-text');
    if (summaryText) {
      if (uploading > 0 || queued > 0) {
        summaryText.textContent = `Uploading ${completed + uploading} of ${total} (✓ ${completed} completed, ↻ ${uploading} active, ✕ ${failed} failed)`;
      } else if (failed > 0) {
        summaryText.textContent = `${completed} uploaded successfully. ${failed} file${failed > 1 ? 's need' : ' needs'} attention.`;
      } else {
        summaryText.textContent = `All ${completed} upload${completed > 1 ? 's' : ''} completed successfully!`;
      }
    }

    fileQueueList.innerHTML = state.uploadQueue.map(item => {
      const icon = getFileIcon(item.file.name);
      
      let badgeHTML = `<span class="card-status-badge badge-${item.status}">${item.status.toUpperCase()}</span>`;
      let progressFillClass = item.status === 'completed' ? 'card-completed-bar' : '';

      let metaText = `${item.uploadedMB} / ${item.totalMB} MB`;
      if (item.status === 'uploading') {
        metaText += ` • ${item.speedMBs} MB/s • ${item.etaSec}s left`;
      } else if (item.status === 'completed') {
        metaText = `${item.totalMB} MB • Uploaded cleanly`;
      }

      let actionsHTML = '';
      if (item.status === 'uploading') {
        actionsHTML = `<button type="button" class="btn-card-cancel" onclick="window.DocPortal.cancelUpload('${item.id}')">Cancel</button>`;
      } else if (item.status === 'failed') {
        actionsHTML = `
          <button type="button" class="btn-card-retry" onclick="window.DocPortal.retryUpload('${item.id}')">Try Again</button>
          <button type="button" class="btn-card-remove" onclick="window.DocPortal.removeQueueItem('${item.id}')">Remove</button>
        `;
      } else if (item.status === 'queued' || item.status === 'cancelled') {
        actionsHTML = `<button type="button" class="btn-card-remove" onclick="window.DocPortal.removeQueueItem('${item.id}')">Remove</button>`;
      }

      let errorBoxHTML = item.errorMsg ? `<div class="card-error-box">${escapeHTML(item.errorMsg)}</div>` : '';

      return `
        <div class="file-upload-card state-${item.status}">
          <div class="card-top-row">
            <div class="card-file-name-group">
              <span class="card-file-icon">${icon}</span>
              <span class="card-file-name" title="${escapeHTML(item.file.name)}">${escapeHTML(item.file.name)}</span>
            </div>
            ${badgeHTML}
          </div>
          <div class="card-progress-bar-bg">
            <div class="card-progress-bar-fill ${progressFillClass}" style="width: ${item.progressPct}%;"></div>
          </div>
          <div class="card-meta-row">
            <span>${metaText}</span>
            <span>${item.progressPct}%</span>
          </div>
          ${errorBoxHTML}
          ${actionsHTML ? `<div class="card-actions-row">${actionsHTML}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function processUploadQueue() {
    const activeTasks = state.uploadQueue.filter(i => i.status === 'uploading');
    const availableSlots = MAX_CONCURRENT_UPLOADS - activeTasks.length;

    if (availableSlots <= 0) return;

    const queuedTasks = state.uploadQueue.filter(i => i.status === 'queued');
    for (let i = 0; i < Math.min(availableSlots, queuedTasks.length); i++) {
      startSingleTaskUpload(queuedTasks[i]);
    }
  }

  function startSingleTaskUpload(item) {
    item.status = 'uploading';
    item.errorMsg = '';
    renderUploadQueue();

    const xhr = new XMLHttpRequest();
    item.xhr = xhr;

    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('folderPath', item.folderPath);
    formData.append('replace', item.replace ? 'true' : 'false');

    xhr.open('POST', '/api/upload', true);
    if (state.csrfToken) {
      xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
    }

    const startTime = Date.now();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && item.status === 'uploading') {
        item.progressPct = Math.round((e.loaded / e.total) * 100);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedBps = elapsedSec > 0 ? (e.loaded / elapsedSec) : 0;
        item.speedMBs = (speedBps / (1024 * 1024)).toFixed(1);
        
        const remainingBytes = e.total - e.loaded;
        item.etaSec = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
        item.uploadedMB = (e.loaded / (1024 * 1024)).toFixed(1);

        renderUploadQueue();
      }
    };

    xhr.onload = () => {
      item.xhr = null;
      if (xhr.status === 200) {
        item.status = 'completed';
        item.progressPct = 100;
        item.uploadedMB = item.totalMB;
        renderUploadQueue();
        processUploadQueue();
        loadCurrentFolder();
      } else if (xhr.status === 409) {
        state.duplicateContext = { item };
        duplicateMsgText.textContent = `File "${item.file.name}" already exists in ${item.folderPath || 'Documents Root'}. Do you want to replace it?`;
        duplicateModal.classList.remove('hidden');
      } else {
        item.status = 'failed';
        let detail = '';
        try {
          const errData = JSON.parse(xhr.responseText);
          detail = errData.detail || '';
        } catch (e) {}
        item.errorMsg = getFriendlyErrorMessage(xhr.status, detail);
        renderUploadQueue();
        processUploadQueue();
      }
    };

    xhr.onerror = () => {
      item.xhr = null;
      if (item.status !== 'cancelled') {
        item.status = 'failed';
        item.errorMsg = getFriendlyErrorMessage(0, '');
        renderUploadQueue();
        processUploadQueue();
      }
    };

    xhr.onabort = () => {
      item.xhr = null;
      item.status = 'cancelled';
      item.errorMsg = 'Upload cancelled by user.';
      renderUploadQueue();
      processUploadQueue();
    };

    xhr.send(formData);
  }

  function cancelUpload(itemId) {
    const item = state.uploadQueue.find(i => i.id === itemId);
    if (item) {
      if (item.xhr) {
        item.xhr.abort();
      } else {
        item.status = 'cancelled';
        renderUploadQueue();
        processUploadQueue();
      }
    }
  }

  function retryUpload(itemId) {
    const item = state.uploadQueue.find(i => i.id === itemId);
    if (item) {
      item.status = 'queued';
      item.errorMsg = '';
      item.progressPct = 0;
      item.uploadedMB = '0.0';
      renderUploadQueue();
      processUploadQueue();
    }
  }

  function removeQueueItem(itemId) {
    const idx = state.uploadQueue.findIndex(i => i.id === itemId);
    if (idx !== -1) {
      const item = state.uploadQueue[idx];
      if (item.xhr) {
        item.xhr.abort();
      }
      state.uploadQueue.splice(idx, 1);
      renderUploadQueue();
    }
  }

  function clearCompletedQueue() {
    state.uploadQueue = state.uploadQueue.filter(i => i.status !== 'completed');
    renderUploadQueue();
  }

  function startUploadQueue() {
    processUploadQueue();
  }

  /**
   * Event Listeners Setup
   */
  function setupEventListeners() {
    window.addEventListener('hashchange', parseHashAndNavigate);

    // Search Input
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      clearSearchBtn.classList.toggle('hidden', state.searchQuery === '');
      applyFilterAndSort();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.classList.add('hidden');
      applyFilterAndSort();
      searchInput.focus();
    });

    resetSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.classList.add('hidden');
      applyFilterAndSort();
    });

    // Navigation Controls
    btnBack.addEventListener('click', () => {
      if (state.currentPath.length > 0) {
        setPath(state.currentPath.slice(0, -1));
      }
    });

    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFilterAndSort();
    });

    btnGridView.addEventListener('click', () => applyViewMode('grid'));
    btnListView.addEventListener('click', () => applyViewMode('list'));
    btnRefresh.addEventListener('click', () => loadCurrentFolder());

    // Admin Auth Listeners
    btnOpenUpload.addEventListener('click', handleOpenUploadClick);
    authForm.addEventListener('submit', handleAuthSubmit);
    authCancelBtn.addEventListener('click', () => authModal.classList.add('hidden'));
    authCloseBtn.addEventListener('click', () => authModal.classList.add('hidden'));
    btnAdminLogout.addEventListener('click', handleAdminLogout);

    uploadCloseBtn.addEventListener('click', () => uploadModal.classList.add('hidden'));

    // Drag & Drop Dropzone Listeners
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFilesToQueue(e.dataTransfer.files);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToQueue(e.target.files);
      }
    });

    btnClearQueue.addEventListener('click', clearCompletedQueue);
    btnStartUpload.addEventListener('click', () => startUploadQueue());

    // Duplicate File Modal Buttons
    btnDupCancel.addEventListener('click', () => {
      duplicateModal.classList.add('hidden');
      state.duplicateContext = null;
    });

    btnDupReplace.addEventListener('click', async () => {
      duplicateModal.classList.add('hidden');
      if (state.duplicateContext) {
        const { file } = state.duplicateContext;
        try {
          await uploadSingleFile(file, state.selectedUploadPath, true);
          alert(`File ${file.name} replaced successfully.`);
          clearQueue();
          uploadModal.classList.add('hidden');
          loadCurrentFolder();
        } catch (e) {
          alert(`Failed to replace file: ${e.message}`);
        }
      }
    });

    // Preview Modal Close
    modalCloseBtn.addEventListener('click', closeModal);
    viewerModal.addEventListener('click', (e) => {
      if (e.target === viewerModal) closeModal();
    });

    // Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === 'Escape') {
        if (!viewerModal.classList.contains('hidden')) closeModal();
        if (!authModal.classList.contains('hidden')) authModal.classList.add('hidden');
        if (!uploadModal.classList.contains('hidden')) uploadModal.classList.add('hidden');
      }
    });
  }

  function applyViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem('docvault_view_mode', mode);

    btnGridView.classList.toggle('active', mode === 'grid');
    btnListView.classList.toggle('active', mode === 'list');
    render();
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

  /* Utility Helpers */
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

  function getFileExtension(filename) {
    const parts = filename.split('.');
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
    return dateObj.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeJS(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  function getFileSVGIcon(category, size = 24) {
    switch (category) {
      case 'pdf':
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M10 12h4"></path><path d="M10 16h4"></path></svg>`;
      case 'sheet':
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`;
      case 'image':
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      case 'video':
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
      case 'archive':
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`;
      default:
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    }
  }

  // Export public helpers
  window.DocPortal = {
    openViewer,
    navigateToFolder,
    navigateToBreadcrumb,
    removeQueueItem,
    cancelUpload,
    retryUpload,
    clearCompletedQueue
  };

  // Start App
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
