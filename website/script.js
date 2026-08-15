/**
 * Public Document Portal — Folder-Based Client Engine
 * Vanilla JavaScript (Zero External Dependencies)
 */

(function () {
  'use strict';

  // Application State
  const state = {
    currentPath: [], // Array of subfolder names, e.g. ['Linux', 'RHCSA']
    currentItems: [], // Items (files & folders) in active directory
    filteredItems: [], // Filtered by search / sort
    searchQuery: '',
    sortBy: 'type-name-asc',
    viewMode: localStorage.getItem('docvault_view_mode') || 'grid',
    searchCache: new Map() // Cache for recursive search indexing
  };

  // DOM Elements
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

  // Modal Elements
  const viewerModal = document.getElementById('viewer-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalExtBadge = document.getElementById('modal-ext-badge');
  const modalExternalBtn = document.getElementById('modal-external-btn');
  const modalDownloadBtn = document.getElementById('modal-download-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalBody = document.getElementById('modal-body');

  // File Extension Categories & Icons
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
    
    // Read initial location from URL Hash (e.g. #/Linux/RHCSA)
    parseHashAndNavigate();
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
        // Filter out hidden items starting with '.'
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
   * Fetch item count inside a subfolder
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
    } catch (e) {
      // Ignore background count errors
    }
    return 0;
  }

  /**
   * Filter and Sort Items
   */
  function applyFilterAndSort() {
    let result = [...state.currentItems];

    // Filter by search query
    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(item => 
        item.name.toLowerCase().includes(q) || item.ext.toLowerCase().includes(q)
      );
    }

    // Sort items
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
   * Render Grid View Cards (Folders & Files)
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
                View
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
   * Render List View Rows (Folders & Files)
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
   * Render Breadcrumbs Navigation & Back Button UI
   */
  function updateNavigationUI() {
    // Back Button status
    if (state.currentPath.length > 0) {
      btnBack.classList.remove('hidden');
    } else {
      btnBack.classList.add('hidden');
    }

    // Breadcrumbs Bar
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

    // Header Title
    if (state.currentPath.length === 0) {
      currentFolderTitle.innerHTML = 'Location: <strong>Documents Root</strong>';
    } else {
      const folderName = state.currentPath[state.currentPath.length - 1];
      currentFolderTitle.innerHTML = `Location: <strong>${escapeHTML(folderName)}</strong>`;
    }
  }

  /**
   * Open Modal Document Viewer
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

  /**
   * Event Listeners
   */
  function setupEventListeners() {
    // Hash change event (Browser Back / Forward buttons)
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

    // Back Button
    btnBack.addEventListener('click', () => {
      if (state.currentPath.length > 0) {
        setPath(state.currentPath.slice(0, -1));
      }
    });

    // Sort Selector
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFilterAndSort();
    });

    // View Mode Toggle
    btnGridView.addEventListener('click', () => applyViewMode('grid'));
    btnListView.addEventListener('click', () => applyViewMode('list'));

    btnRefresh.addEventListener('click', () => loadCurrentFolder());

    // Modal Close
    modalCloseBtn.addEventListener('click', closeModal);
    viewerModal.addEventListener('click', (e) => {
      if (e.target === viewerModal) closeModal();
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === 'Escape') {
        if (!viewerModal.classList.contains('hidden')) {
          closeModal();
        }
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

  /* Utility Helper Functions */
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
      case 'archive':
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`;
      default:
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    }
  }

  // Export public methods for global handlers
  window.DocPortal = {
    openViewer,
    navigateToFolder,
    navigateToBreadcrumb
  };

  // Start App
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
