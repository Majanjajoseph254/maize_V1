/* ═══════════════════════════════════════════════════════════════
   KilimoSmart Maize – Client-side Application Logic
   ═══════════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────
const state = {
    lang: 'en',
    scanCount: 0,
    diseasesFound: 0,
    healthyCount: 0,
    bestPrice: null,
    lastDiagnosis: null,
    selectedFile: null,
    farmer: {
        name: 'John Kamau',
        county: 'Kiambu',
        acres: 5,
        phone: '+254 712 345 678',
        profilePhotoUrl: '',
    },
    location: {
        lat: -1.2995,
        lon: 36.8400,
        county: 'Kiambu',
    },
    lastMarketOffer: null,
    live: {
        stream: null,
        timerId: null,
        isRunning: false,
        isAnalyzing: false,
    },
    debugInternalScores: false,
};

function isSearchingResult(data) {
    const status = String(data?.status || '').toLowerCase();
    return status === 'searching' || status === 'rejected';
}

function toPercent(confidence) {
    const value = Number(confidence || 0);
    if (value <= 1) {
        return Math.max(0, Math.min(100, value * 100));
    }
    return Math.max(0, Math.min(100, value));
}

function normalizeDiagnosisPayload(data) {
    const diagnosis = data.diagnosis || data.disease || 'Unknown';
    return {
        ...data,
        diagnosis,
        disease: diagnosis,
        confidence: toPercent(data.confidence),
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setAvatarImage(url) {
    const hasImage = Boolean(url);
    const sidebarImg = document.getElementById('sidebarAvatarImg');
    const profileImg = document.getElementById('profileAvatarImg');
    const sidebarFallback = document.getElementById('sidebarAvatarFallback');
    const profileFallback = document.getElementById('profileAvatarFallback');

    if (!sidebarImg || !profileImg || !sidebarFallback || !profileFallback) return;

    if (hasImage) {
        sidebarImg.src = url;
        profileImg.src = url;
        sidebarImg.style.display = 'block';
        profileImg.style.display = 'block';
        sidebarFallback.style.display = 'none';
        profileFallback.style.display = 'none';
    } else {
        sidebarImg.style.display = 'none';
        profileImg.style.display = 'none';
        sidebarFallback.style.display = 'inline-flex';
        profileFallback.style.display = 'inline-flex';
    }
}

// ── Navigation ───────────────────────────────────────────────
function navigateTo(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Remove active from nav items
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show target page
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // Mark nav
    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) nav.classList.add('active');

    // Close sidebar on mobile
    closeSidebar();

    // Load page-specific data
    if (page === 'market') loadMillers();
}

// Bind nav clicks
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(item.dataset.page);
    });
});

// ── Sidebar toggle (mobile) ─────────────────────────────────
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

// ── Language toggle ──────────────────────────────────────────
function toggleLanguage() {
    state.lang = state.lang === 'en' ? 'sw' : 'en';
    document.getElementById('langLabel').textContent =
        state.lang === 'en' ? 'Kiswahili' : 'English';
    showToast(`Language: ${state.lang === 'en' ? 'English' : 'Kiswahili'}`, 'info');
}

function setLanguage(lang) {
    state.lang = lang;
    document.getElementById('langLabel').textContent =
        lang === 'en' ? 'Kiswahili' : 'English';
    document.getElementById('settingsLang').value = lang;
}

// ── Image handling ───────────────────────────────────────────
function handleImageUpload(input, source) {
    const file = input.files[0];
    if (!file) return;

    state.selectedFile = file;

    if (source === 'diagnose') {
        // Show preview in diagnose page
        const preview = document.getElementById('previewImage');
        const placeholder = document.getElementById('uploadPlaceholder');
        const reader = new FileReader();
        reader.onload = e => {
            preview.src = e.target.result;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
        document.getElementById('analyzeBtn').disabled = false;
    } else if (source === 'dashboard') {
        // Show a quick preview toast then auto-analyze
        showToast('Image selected – analyzing...', 'info');
        analyzeCrop();
    }
}

// Upload zone drag & drop
const uploadZone = document.getElementById('uploadZone');
if (uploadZone) {
    uploadZone.addEventListener('click', () => {
        document.getElementById('diagnoseFileInput').click();
    });
    uploadZone.addEventListener('dragover', e => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', e => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            state.selectedFile = file;
            const preview = document.getElementById('previewImage');
            const placeholder = document.getElementById('uploadPlaceholder');
            const reader = new FileReader();
            reader.onload = ev => {
                preview.src = ev.target.result;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
            };
            reader.readAsDataURL(file);
            document.getElementById('analyzeBtn').disabled = false;
        }
    });
}

// ── Crop analysis ────────────────────────────────────────────
async function analyzeCrop() {
    if (!state.selectedFile) {
        showToast('Please select an image first', 'error');
        return;
    }

    const progressEl = document.getElementById('diagnoseProgress');
    if (progressEl) {
        progressEl.style.display = 'block';
    }

    showLoading(true);

    const formData = new FormData();
    formData.append('image', state.selectedFile);

    try {
        const endpoint = state.debugInternalScores ? '/api/diagnose?debug=1' : '/api/diagnose';
        const resp = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        });

        const rawData = await resp.json();
        const data = normalizeDiagnosisPayload(rawData);

        if (data.error) {
            showToast(data.error, 'error');
            showLoading(false);
            if (progressEl) progressEl.style.display = 'none';
            return;
        }

        state.scanCount++;
        state.lastDiagnosis = data;

        if (isSearchingResult(data)) {
            showDiagnosisResult(data, 'rejected');
            const reportActions = document.getElementById('diagnoseReportActions');
            if (reportActions) reportActions.style.display = 'none';
        } else {
            if (data.diagnosis === 'Healthy') {
                state.healthyCount++;
            } else {
                state.diseasesFound++;
            }
            showDiagnosisResult(data, data.diagnosis === 'Healthy' ? 'healthy' : 'disease');
            const reportActions = document.getElementById('diagnoseReportActions');
            if (reportActions) reportActions.style.display = 'flex';
            // Auto-fetch market offer
            fetchMarketOffer(data.diagnosis);
        }

        // Save scan to local IndexedDB for offline history
        if (window.offlineDB) {
            window.offlineDB.saveScan({
                timestamp: new Date().toISOString(),
                disease: data.diagnosis || 'Unknown',
                confidence: data.confidence || 0,
                mvp_summary: data.mvp_summary || '',
                treatment: data.treatment || null,
                status: data.status || 'success',
                county: state.location.county,
                is_maize: data.is_maize || false,
            }).then(() => {
                console.log('[App] ✅ Scan saved to history');
            }).catch(err => {
                console.warn('[App] Failed to save scan to history:', err);
            });
        }

        updateDashboardStats();
        showLoading(false);
        if (progressEl) progressEl.style.display = 'none';
    } catch (err) {
        showLoading(false);
        showToast('Analysis failed. Please try again.', 'error');
        console.error(err);
        if (progressEl) progressEl.style.display = 'none';
    }
}

function showDiagnosisResult(data, type) {
    // Show in diagnose page
    const container = document.getElementById('diagnoseResults');
    const content = document.getElementById('diagnoseResultContent');
    container.style.display = 'block';
    content.innerHTML = buildResultHTML(data, type);

    // Also show on dashboard
    const dashContainer = document.getElementById('dashResults');
    const dashContent = document.getElementById('dashResultContent');
    dashContainer.style.display = 'block';
    dashContent.innerHTML = buildResultHTML(data, type);
}

function buildResultHTML(data, type) {
    if (type === 'rejected') {
        return `
            <div class="result-badge rejected">❌ Searching</div>
            <p>${data.message || data.mvp_summary || 'No leaf detected. Try a clearer close-up photo.'}</p>
        `;
    }

    const confClass = data.confidence >= 90 ? 'high' : data.confidence >= 75 ? 'medium' : 'low';
    const badgeClass = type === 'healthy' ? 'healthy' : 'disease';
    const displayName = state.lang === 'sw' && data.disease_sw ? data.disease_sw : data.diagnosis;
    const severityLabel = data.severity ? String(data.severity).toUpperCase() : 'N/A';

    let html = `
        <div class="result-badge ${badgeClass}">
            ${type === 'healthy' ? '✅' : '⚠️'} ${displayName}
        </div>
        <p class="mb-12 text-muted"><strong>Severity:</strong> ${severityLabel}</p>
        ${data.is_maize ? '<p class="mb-12 text-muted">Maize leaf detected successfully.</p>' : ''}
        ${data.mvp_summary ? `<p class="mb-12">${data.mvp_summary}</p>` : ''}
        <div class="confidence-bar">
            <div class="confidence-track">
                <div class="confidence-fill ${confClass}" style="width: ${data.confidence}%"></div>
            </div>
            <div class="confidence-label">
                <span>Confidence</span>
                <span>${data.confidence}%</span>
            </div>
        </div>
    `;

    if (data.internal_scores) {
        const scores = data.internal_scores;
        const morphology = scores.morphology || {};
        html += `
            <div class="treatment-box" style="margin-top:12px; background:#f7fafc; border-style:dashed;">
                <h4>🧪 Internal Scores (Debug)</h4>
                <div class="treatment-item"><strong>Leaf:</strong><span>${scores.leaf_confidence}</span></div>
                <div class="treatment-item"><strong>Model:</strong><span>${scores.model_confidence}</span></div>
                <div class="treatment-item"><strong>Morphology:</strong><span>${scores.morphology_confidence}</span></div>
                <div class="treatment-item"><strong>Lesion Fraction:</strong><span>${scores.lesion_fraction}</span></div>
                <div class="treatment-item"><strong>Backend:</strong><span>${scores.backend}</span></div>
                <div class="treatment-item"><strong>Rust Score:</strong><span>${morphology.rust_score ?? '-'}</span></div>
                <div class="treatment-item"><strong>Gray Score:</strong><span>${morphology.gray_score ?? '-'}</span></div>
                <div class="treatment-item"><strong>Blight Score:</strong><span>${morphology.blight_score ?? '-'}</span></div>
            </div>
        `;
    }

    if (data.treatment) {
        html += `
            <div class="treatment-box">
                <h4>📖 Treatment Advice</h4>
                <div class="treatment-item">
                    <strong>💊 Medication:</strong>
                    <span>${data.treatment.medication}</span>
                </div>
                <div class="treatment-item">
                    <strong>🛡️ Prevention:</strong>
                    <span>${data.treatment.prevention}</span>
                </div>
            </div>
        `;
    }

    return html;
}

// ── Market functions ─────────────────────────────────────────
async function fetchMarketOffer(disease) {
    try {
        const resp = await fetch('/api/market', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                disease: disease,
                lat: state.location.lat,
                lon: state.location.lon,
                lang: state.lang,
            }),
        });

        const data = await resp.json();
        if (data.error) return;

        state.lastMarketOffer = data;

        if (state.bestPrice === null || data.final_price > state.bestPrice) {
            state.bestPrice = data.final_price;
        }

        const offerHTML = buildOfferHTML(data);

        // Show market offer on the MARKET page
        const offerDiv = document.getElementById('marketOffer');
        const offerContent = document.getElementById('marketOfferContent');
        offerDiv.style.display = 'block';
        offerContent.innerHTML = offerHTML;

        // Also show inline on the DIAGNOSE page
        const diagOfferDiv = document.getElementById('diagnoseMarketOffer');
        const diagOfferContent = document.getElementById('diagnoseMarketOfferContent');
        if (diagOfferDiv && diagOfferContent) {
            diagOfferDiv.style.display = 'block';
            diagOfferContent.innerHTML = offerHTML;
        }

        updateDashboardStats();
    } catch (err) {
        console.error('Market fetch failed:', err);
    }
}

function buildOfferHTML(data) {
    const gradeClass = `grade-${data.grade}`;
    const gradeLabel = ['', 'Premium', 'Standard', 'Reject'][data.grade] || '';

    return `
        <div class="offer-card">
            <div class="offer-header">
                <span class="offer-grade ${gradeClass}">Grade ${data.grade} – ${gradeLabel}</span>
            </div>
            <div class="offer-price">KES ${data.final_price.toLocaleString()}</div>
            <p class="offer-details">
                <strong>🏭 Miller:</strong> ${data.miller.name}<br>
                <strong>📍 Location:</strong> ${data.miller.location}<br>
                <strong>📞 Contact:</strong> ${data.miller.contact}<br>
                <strong>🛣️ Distance:</strong> ${data.miller.distance_km} km
            </p>
            <p class="offer-details mt-16">💡 ${data.explanation}</p>
            <button class="btn btn-mpesa" onclick="requestMpesa('${data.miller.name}', ${data.final_price})">
                💰 Accept & Request M-Pesa Deposit
            </button>
        </div>
    `;
}

async function loadMillers() {
    try {
        const params = new URLSearchParams({
            lat: state.location.lat,
            lon: state.location.lon,
        });
        const resp = await fetch(`/api/millers?${params}`);
        const millers = await resp.json();

        const grid = document.getElementById('millersGrid');
        grid.innerHTML = millers.map(m => `
            <div class="miller-card">
                <div class="miller-name">🏭 ${m.name}</div>
                <div class="miller-detail">📍 ${m.location}</div>
                <div class="miller-detail">📞 ${m.contact}</div>
                ${m.distance_km ? `<div class="miller-detail">🛣️ ${m.distance_km} km away</div>` : ''}
                <div class="miller-price">KES ${m.base_price_kes.toLocaleString()} / 90kg bag</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load millers:', err);
    }
}

// ── Location ─────────────────────────────────────────────────
function detectLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                state.location.lat = pos.coords.latitude;
                state.location.lon = pos.coords.longitude;
                document.getElementById('locationStatus').textContent =
                    `📍 Location detected: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
                showToast('Location detected!', 'success');
                loadMillers();
            },
            () => {
                // Use default Kiambu coordinates
                state.location.lat = -1.2995;
                state.location.lon = 36.8400;
                document.getElementById('locationStatus').textContent =
                    '📍 Using default location: Kiambu';
                showToast('Using default Kiambu location', 'info');
                loadMillers();
            }
        );
    } else {
        showToast('Geolocation not supported', 'error');
    }
}

function updateCounty() {
    const county = document.getElementById('countySelect').value;
    if (county) {
        state.location.county = county;
        // Map counties to approximate coordinates
        const coords = {
            'Kiambu':      { lat: -1.1714, lon: 36.8356 },
            'Uasin Gishu': { lat: 0.5143, lon: 35.2698 },
            'Trans-Nzoia': { lat: 1.0567, lon: 34.9507 },
            'Nakuru':      { lat: -0.3031, lon: 36.0800 },
            'Bungoma':     { lat: 0.5635, lon: 34.5607 },
            'Kakamega':    { lat: 0.2827, lon: 34.7519 },
        };
        if (coords[county]) {
            state.location.lat = coords[county].lat;
            state.location.lon = coords[county].lon;
        }
        document.getElementById('locationStatus').textContent = `📍 Location: ${county}`;
        loadMillers();
    }
}

// ── M-Pesa simulation ────────────────────────────────────────
function requestMpesa(millerName, price) {
    const depositAmount = Math.round(price * 0.1);
    showToast(`📲 M-Pesa STK Push sent for KES ${depositAmount.toLocaleString()} deposit`, 'success');
    setTimeout(() => {
        showToast(`✅ Deposit confirmed. ${millerName} will arrange transport.`, 'success');
    }, 2500);
}

// ── Profile ──────────────────────────────────────────────────
function updateProfile() {
    const name = document.getElementById('inputName').value;
    const county = document.getElementById('inputCounty').value;
    const acres = document.getElementById('inputAcres').value;
    const phone = document.getElementById('inputPhone').value;

    state.farmer.name = name;
    state.farmer.county = county;
    state.farmer.acres = parseInt(acres) || 5;
    state.farmer.phone = phone;

    // Update sidebar
    document.getElementById('farmerName').textContent = name;
    document.getElementById('farmerCounty').textContent = county + ' County';
    document.getElementById('profileName').textContent = name;
    document.getElementById('profileCounty').textContent = county + ' County';

    // Update dashboard
    document.getElementById('statAcres').textContent = `${state.farmer.acres} Acres`;
    document.getElementById('statLocation').textContent = county;
}

async function saveProfile() {
    updateProfile();

    try {
        const response = await fetch('/api/user', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: state.farmer.name,
                county: state.farmer.county,
                acres: state.farmer.acres,
                phone: state.farmer.phone,
            }),
        });

        const payload = await response.json();
        if (!response.ok || payload.error) {
            showToast(payload.error || 'Failed to save profile.', 'error');
            return;
        }

        const user = payload.user || {};
        state.farmer.name = user.name || state.farmer.name;
        state.farmer.county = user.county || state.farmer.county;
        state.farmer.acres = Number(user.acres || state.farmer.acres);
        state.farmer.phone = user.phone || state.farmer.phone;
        state.farmer.profilePhotoUrl = user.profile_photo_url || state.farmer.profilePhotoUrl;

        document.getElementById('inputName').value = state.farmer.name;
        document.getElementById('inputCounty').value = state.farmer.county;
        document.getElementById('inputAcres').value = state.farmer.acres;
        document.getElementById('inputPhone').value = state.farmer.phone || '';
        setAvatarImage(state.farmer.profilePhotoUrl);
        updateProfile();
        showToast('Profile saved successfully!', 'success');
    } catch (err) {
        console.error('Failed to save profile:', err);
        showToast('Failed to save profile. Please try again.', 'error');
    }
}

async function uploadProfilePhoto(input) {
    const file = input?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('photo', file);

    try {
        const response = await fetch('/api/user/photo', {
            method: 'POST',
            body: formData,
        });
        const payload = await response.json();

        if (!response.ok || payload.error) {
            showToast(payload.error || 'Photo upload failed.', 'error');
            return;
        }

        state.farmer.profilePhotoUrl = payload.profile_photo_url || '';
        setAvatarImage(state.farmer.profilePhotoUrl);
        showToast('Profile photo updated.', 'success');
    } catch (err) {
        console.error('Photo upload failed:', err);
        showToast('Photo upload failed. Please try again.', 'error');
    } finally {
        input.value = '';
    }
}

function printAnalysisReport() {
    if (!state.lastDiagnosis || isSearchingResult(state.lastDiagnosis)) {
        showToast('Run a successful diagnosis before printing a report.', 'error');
        return;
    }

    const reportRoot = document.getElementById('printReportRoot');
    if (!reportRoot) return;

    const diag = state.lastDiagnosis;
    const treatment = diag.treatment || {};
    const confidencePercent = `${Math.round(Number(diag.confidence || 0))}%`;
    const analyzedAt = diag.analyzed_at ? new Date(diag.analyzed_at).toLocaleString() : new Date().toLocaleString();

    const marketHtml = state.lastMarketOffer
        ? `
            <h3>Market Offer</h3>
            <p><strong>Miller:</strong> ${escapeHtml(state.lastMarketOffer.miller?.name || '-')}</p>
            <p><strong>Grade:</strong> ${escapeHtml(state.lastMarketOffer.grade || '-')}</p>
            <p><strong>Offer Price:</strong> KES ${Number(state.lastMarketOffer.final_price || 0).toLocaleString()}</p>
            <p><strong>Notes:</strong> ${escapeHtml(state.lastMarketOffer.explanation || '-')}</p>
        `
        : '';

    reportRoot.innerHTML = `
        <article class="print-report">
            <h2>KilimoSmart Maize Analysis Report</h2>
            <p>Generated on ${escapeHtml(new Date().toLocaleString())}</p>

            <h3>Farmer Details</h3>
            <div class="print-report-grid">
                <p><strong>Name:</strong> ${escapeHtml(state.farmer.name)}</p>
                <p><strong>County:</strong> ${escapeHtml(state.farmer.county)}</p>
                <p><strong>Farm Size:</strong> ${escapeHtml(state.farmer.acres)} acres</p>
                <p><strong>Phone:</strong> ${escapeHtml(state.farmer.phone || '-')}</p>
            </div>

            <h3>Diagnosis</h3>
            <p><strong>Disease:</strong> ${escapeHtml(diag.diagnosis || '-')}</p>
            <p><strong>Severity:</strong> ${escapeHtml(String(diag.severity || '-').toUpperCase())}</p>
            <p><strong>Confidence:</strong> ${escapeHtml(confidencePercent)}</p>
            <p><strong>Analyzed At:</strong> ${escapeHtml(analyzedAt)}</p>
            <p><strong>Summary:</strong> ${escapeHtml(diag.mvp_summary || '-')}</p>

            <h3>Treatment Advice</h3>
            <p><strong>Medication:</strong> ${escapeHtml(treatment.medication || 'Not specified')}</p>
            <p><strong>Prevention:</strong> ${escapeHtml(treatment.prevention || 'Not specified')}</p>

            ${marketHtml}
        </article>
    `;

    reportRoot.style.display = 'block';
    window.print();
    setTimeout(() => {
        reportRoot.style.display = 'none';
    }, 150);
}

// ── Dashboard stats ──────────────────────────────────────────
function updateDashboardStats() {
    document.getElementById('statScans').textContent = `${state.scanCount} Scans`;
    document.getElementById('summaryScans').textContent = state.scanCount;
    document.getElementById('summaryDiseases').textContent = state.diseasesFound;
    document.getElementById('summaryHealthy').textContent = state.healthyCount;
    if (state.bestPrice) {
        const priceKg = Math.round(state.bestPrice / 90);
        document.getElementById('statPrice').textContent = `KES ${priceKg}/kg`;
        document.getElementById('summaryBestPrice').textContent =
            `KES ${state.bestPrice.toLocaleString()}`;
    }
}

// ── Loading overlay ──────────────────────────────────────────
function showLoading(show) {
    document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

// ── Toast notifications ──────────────────────────────────────
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    state.debugInternalScores = ['1', 'true', 'yes', 'on'].includes(
        String(params.get('debug') || '').toLowerCase(),
    );

    // Load current authenticated user info
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const user = await response.json();
            state.farmer = {
                name: user.name,
                county: user.county,
                acres: user.acres,
                phone: user.phone,
                profilePhotoUrl: user.profile_photo_url || '',
            };
            // Update sidebar with user name
            document.getElementById('farmerName').textContent = user.name;
            document.getElementById('farmerCounty').textContent = user.county;
            // Update form inputs
            document.getElementById('inputName').value = user.name || '';
            document.getElementById('inputCounty').value = user.county || 'Kiambu';
            document.getElementById('inputAcres').value = user.acres || 5;
            document.getElementById('inputPhone').value = user.phone || '';
            document.getElementById('profileName').textContent = user.name;
            document.getElementById('profileCounty').textContent = user.county;
            setAvatarImage(user.profile_photo_url || '');
            console.log('[App] ✅ User loaded:', user.name);
        }
    } catch (err) {
        console.warn('[App] Failed to load user data:', err);
    }
    
    updateDashboardStats();
    // Pre-load millers data
    loadMillers();
    setupLiveCameraUI();

    if (state.debugInternalScores) {
        showToast('Debug mode enabled: internal scores will be shown.', 'info');
    }
});

// ── Authentication ──────────────────────────────────────────
function logout() {
    if (confirm('Are you sure you want to log out?')) {
        window.location.href = '/logout';
    }
}

// From dashboard "Live Camera" button, jump straight into
// Diagnose page with the laptop camera running.
function goToLiveScan() {
    navigateTo('diagnose');
    setTimeout(() => {
        const video = document.getElementById('liveVideo');
        if (video && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            startLiveScan();
        } else {
            const input = document.getElementById('diagnoseCameraInput');
            if (input) input.click();
        }
    }, 150);
}

// ── Live camera (laptop) ─────────────────────────────────────
function setupLiveCameraUI() {
    const video = document.getElementById('liveVideo');
    if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const card = document.getElementById('liveCameraCard');
        if (card) card.style.display = 'none';
        return;
    }
}

async function startLiveScan() {
    if (state.live.isRunning) return;

    const video = document.getElementById('liveVideo');
    const canvas = document.getElementById('liveCanvas');
    const startBtn = document.getElementById('startLiveBtn');
    const stopBtn = document.getElementById('stopLiveBtn');
    const statusEl = document.getElementById('liveStatus');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        state.live.stream = stream;
        state.live.isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusEl.textContent = 'Live scan running. Hold a single maize leaf in front of the camera.';

        // Capture a frame every 2 seconds for near real-time feedback
        state.live.timerId = setInterval(() => {
            captureAndAnalyzeFrame(video, canvas);
        }, 2000);
    } catch (err) {
        console.error('Failed to access camera:', err);
        showToast('Could not access laptop camera. Please allow camera permission in your browser.', 'error');
    }
}

function stopLiveScan() {
    if (!state.live.isRunning) return;

    const stopBtn = document.getElementById('stopLiveBtn');
    const startBtn = document.getElementById('startLiveBtn');
    const statusEl = document.getElementById('liveStatus');

    if (state.live.timerId) {
        clearInterval(state.live.timerId);
        state.live.timerId = null;
    }
    if (state.live.stream) {
        state.live.stream.getTracks().forEach(t => t.stop());
        state.live.stream = null;
    }
    state.live.isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = 'Live scan stopped.';
}

function captureAndAnalyzeFrame(video, canvas) {
    if (!video.videoWidth || !video.videoHeight) return;
    if (state.live.isAnalyzing) return;

    const ctx = canvas.getContext('2d');
    const size = 256;
    canvas.width = size;
    canvas.height = size;

    const minSide = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - minSide) / 2;
    const sy = (video.videoHeight - minSide) / 2;

    ctx.drawImage(video, sx, sy, minSide, minSide, 0, 0, size, size);

    canvas.toBlob(async blob => {
        if (!blob) return;
        const file = new File([blob], 'live-frame.jpg', { type: 'image/jpeg' });
        await analyzeLiveFrame(file);
    }, 'image/jpeg', 0.9);
}

async function analyzeLiveFrame(file) {
    const statusEl = document.getElementById('liveStatus');
    if (state.live.isAnalyzing) return;

    const formData = new FormData();
    formData.append('image', file);

    state.live.isAnalyzing = true;
    if (statusEl) statusEl.textContent = 'Analyzing live frame…';

    try {
        const endpoint = state.debugInternalScores ? '/api/diagnose?debug=1' : '/api/diagnose';
        const resp = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        });
        const rawData = await resp.json();
        const data = normalizeDiagnosisPayload(rawData);

        if (data.error) {
            if (statusEl) statusEl.textContent = data.error;
            state.live.isAnalyzing = false;
            return;
        }

        state.scanCount++;
        state.lastDiagnosis = data;

        if (isSearchingResult(data)) {
            showDiagnosisResult(data, 'rejected');
            const reportActions = document.getElementById('diagnoseReportActions');
            if (reportActions) reportActions.style.display = 'none';
            if (statusEl) statusEl.textContent = data.message || 'Frame analyzed: leaf not detected yet.';
        } else {
            if (data.diagnosis === 'Healthy') {
                state.healthyCount++;
            } else {
                state.diseasesFound++;
            }
            showDiagnosisResult(data, data.diagnosis === 'Healthy' ? 'healthy' : 'disease');
            const reportActions = document.getElementById('diagnoseReportActions');
            if (reportActions) reportActions.style.display = 'flex';
            fetchMarketOffer(data.diagnosis);
            if (statusEl) statusEl.textContent = 'Frame analyzed: maize leaf detected.';
        }

        updateDashboardStats();
    } catch (err) {
        console.error('Live analysis failed:', err);
        if (statusEl) statusEl.textContent = 'Live analysis failed. Please check your connection.';
    } finally {
        state.live.isAnalyzing = false;
    }
}
