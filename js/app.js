// PupilCheck - Shared Application Utilities
// Toast notifications, ML status management, settings, navigation helpers

const App = (() => {
    // Toast notification system
    let toastContainer = null;

    function showToast(message, type = 'info', duration = 3000) {
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toastContainer';
            toastContainer.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;
            pointer-events:auto;opacity:0;transform:translateX(20px);
            transition:all 0.3s ease;max-width:300px;
            box-shadow:0 4px 12px rgba(0,0,0,0.3);
        `;

        const colors = {
            info: 'background:var(--surface2,#0f3460);color:var(--info,#70a1ff);border:1px solid rgba(112,161,255,0.3)',
            success: 'background:rgba(46,213,115,0.15);color:var(--success,#2ed573);border:1px solid rgba(46,213,115,0.3)',
            warning: 'background:rgba(255,165,2,0.15);color:var(--warning,#ffa502);border:1px solid rgba(255,165,2,0.3)',
            error: 'background:rgba(255,71,87,0.15);color:var(--danger,#ff4757);border:1px solid rgba(255,71,87,0.3)'
        };
        toast.style.cssText += ';' + (colors[type] || colors.info);

        toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ML Status management
    let mlStatusEl = null;

    function updateMLStatus() {
        if (!mlStatusEl) mlStatusEl = document.getElementById('mlStatus');
        if (!mlStatusEl) return;

        const mlReady = typeof MLDetection !== 'undefined' && MLDetection.isReady();
        const cloudAvail = typeof CloudDetection !== 'undefined' && CloudDetection.isAvailable();
        const cloudConfigured = typeof CloudDetection !== 'undefined' && CloudDetection.isConfigured();

        let dotColor, text;

        if (mlReady) {
            dotColor = 'var(--success)';
            text = typeof i18n !== 'undefined' ? i18n.t('status.mlReady') : 'ML model ready';
        } else if (cloudAvail) {
            dotColor = 'var(--success)';
            text = typeof i18n !== 'undefined' ? i18n.t('status.cloudConnected') : 'Cloud analysis connected';
        } else if (cloudConfigured) {
            dotColor = 'var(--warning)';
            text = typeof i18n !== 'undefined' ? i18n.t('status.cloudOffline') : 'Cloud analysis offline';
        } else {
            dotColor = 'var(--text-muted)';
            text = typeof i18n !== 'undefined' ? i18n.t('status.classicalMode') : 'Classical detection mode';
        }

        mlStatusEl.innerHTML = `<span class="status-dot" style="background:${dotColor}"></span> ${text}`;
        mlStatusEl.style.display = 'block';
    }

    // Initialize ML models (async, non-blocking)
    async function initML() {
        // Try loading MediaPipe + TFLite
        if (typeof MLDetection !== 'undefined') {
            MLDetection.setStatusCallback((status) => {
                if (status === 'loading') {
                    showToast(typeof i18n !== 'undefined' ? i18n.t('status.mlLoading') : 'Loading ML model...', 'info', 5000);
                } else if (status === 'ready') {
                    showToast(typeof i18n !== 'undefined' ? i18n.t('status.mlReady') : 'ML model ready', 'success');
                } else if (status === 'failed') {
                    showToast(typeof i18n !== 'undefined' ? i18n.t('status.mlFailed') : 'ML unavailable, using classical detection', 'warning');
                }
                updateMLStatus();
            });
            await MLDetection.init();
        }

        // Check cloud availability
        if (typeof CloudDetection !== 'undefined' && CloudDetection.isConfigured()) {
            await CloudDetection.checkHealth();
        }

        updateMLStatus();
    }

    // Settings helpers
    function getIrisRefMm() {
        if (typeof patientStore !== 'undefined') {
            return patientStore.getSetting('irisRefMm', 11.7);
        }
        return 11.7;
    }

    function setIrisRefMm(val) {
        if (typeof patientStore !== 'undefined') {
            patientStore.saveSetting('irisRefMm', val);
        }
    }

    function isHighContrast() {
        if (typeof patientStore !== 'undefined') {
            return patientStore.getSetting('highContrast', false);
        }
        return false;
    }

    function setHighContrast(on) {
        if (typeof patientStore !== 'undefined') {
            patientStore.saveSetting('highContrast', on);
        }
        document.documentElement.classList.toggle('high-contrast', on);
    }

    // Check camera support
    function hasCameraSupport() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    // Navigation between pages
    function navigateTo(page) {
        window.location.href = page;
    }

    // Format date for display
    function formatDate(isoStr) {
        const d = new Date(isoStr);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatDateTime(isoStr) {
        const d = new Date(isoStr);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // Assessment color class
    function assessmentClass(diffMm) {
        if (diffMm < 0.5) return 'normal';
        if (diffMm < 1.0) return 'normal';
        if (diffMm < 2.0) return 'mild';
        return 'significant';
    }

    // Clinical urgency level
    function urgencyLevel(diffMm, reactivityData) {
        let score = 0;
        if (diffMm >= 0.5) score += 1;
        if (diffMm >= 1.0) score += 1;
        if (diffMm >= 2.0) score += 2;

        if (reactivityData) {
            if (reactivityData.rapdFlag) score += 1;
            if (reactivityData.leftLabel?.startsWith('Fixed') || reactivityData.rightLabel?.startsWith('Fixed')) score += 2;
        }

        if (score >= 4) return 'urgent';
        if (score >= 2) return 'attention';
        return 'routine';
    }

    return {
        showToast,
        updateMLStatus,
        initML,
        getIrisRefMm,
        setIrisRefMm,
        isHighContrast,
        setHighContrast,
        hasCameraSupport,
        navigateTo,
        formatDate,
        formatDateTime,
        assessmentClass,
        urgencyLevel
    };
})();
