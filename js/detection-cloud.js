// PupilCheck - Cloud ML Detection (Optional Tier)
// Sends eye images to Cloud Run for server-side U-Net inference
// Used as fallback when MediaPipe can't detect face (extreme close-ups)

const CloudDetection = (() => {
    // Set this after deploying Cloud Run service
    const CLOUD_DETECT_URL = '';  // e.g., 'https://pupil-detection-xxxxx-uc.a.run.app'
    const CLOUD_TIMEOUT_MS = 5000;

    let cloudAvailable = false;
    let checking = false;

    function isConfigured() {
        return CLOUD_DETECT_URL.length > 0;
    }

    function isAvailable() {
        return cloudAvailable;
    }

    async function checkHealth() {
        if (!isConfigured()) { cloudAvailable = false; return false; }
        if (checking) return cloudAvailable;
        checking = true;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const resp = await fetch(`${CLOUD_DETECT_URL}/health`, { signal: controller.signal });
            clearTimeout(timeout);
            const data = await resp.json();
            cloudAvailable = data.status === 'healthy' && data.model_loaded;
        } catch (e) {
            cloudAvailable = false;
        }
        checking = false;
        return cloudAvailable;
    }

    async function detect(imageData, width, height) {
        if (!isConfigured() || !cloudAvailable) {
            throw new Error('Cloud detection not available');
        }

        // Convert ImageData to base64 JPEG
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').putImageData(imageData, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);

        try {
            const resp = await fetch(`${CLOUD_DETECT_URL}/detect/base64`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: dataUrl }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!resp.ok) throw new Error(`Cloud returned ${resp.status}`);

            const data = await resp.json();

            if (!data.pupil || !data.iris) throw new Error('Cloud detection returned no results');
            if (data.confidence.pupil < 0.3) throw new Error('Cloud detection low confidence');

            return {
                pupil: { x: Math.round(data.pupil.x), y: Math.round(data.pupil.y), r: Math.round(data.pupil.radius) },
                iris: { x: Math.round(data.iris.x), y: Math.round(data.iris.y), r: Math.round(data.iris.radius) },
                confidence: data.confidence,
                method: 'cloud'
            };
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        }
    }

    return {
        isConfigured,
        isAvailable,
        checkHealth,
        detect
    };
})();
