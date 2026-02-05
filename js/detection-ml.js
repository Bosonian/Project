// PupilCheck - In-Browser ML Detection
// Stage 1: MediaPipe FaceLandmarker for iris detection
// Stage 2: Custom TFLite model for pupil segmentation within iris ROI
// Falls back to classical detection if ML fails

const MLDetection = (() => {
    let faceLandmarker = null;
    let pupilInterpreter = null;
    let mlReady = false;
    let mlStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
    const PUPIL_MODEL_SIZE = 128;

    // MediaPipe iris landmark indices (per eye)
    const LEFT_IRIS = [468, 469, 470, 471, 472];  // center, top, right, bottom, left
    const RIGHT_IRIS = [473, 474, 475, 476, 477];

    // Status callback
    let onStatusChange = null;

    function setStatusCallback(cb) { onStatusChange = cb; }
    function getStatus() { return mlStatus; }
    function isReady() { return mlReady; }

    function updateStatus(status) {
        mlStatus = status;
        if (onStatusChange) onStatusChange(status);
    }

    async function init() {
        updateStatus('loading');
        try {
            await loadMediaPipe();
            await loadPupilModel();
            mlReady = true;
            updateStatus('ready');
            return true;
        } catch (e) {
            console.warn('ML init failed, will use classical detection:', e);
            mlReady = false;
            updateStatus('failed');
            return false;
        }
    }

    async function loadMediaPipe() {
        const { FaceLandmarker, FilesetResolver } = await import(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm'
        );

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
        );

        // Prefer local model (cached by SW), fallback to CDN
        const localModelPath = 'models/face_landmarker.task';
        const cdnModelPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

        let modelPath = cdnModelPath;
        try {
            const probe = await fetch(localModelPath, { method: 'HEAD' });
            if (probe.ok) modelPath = localModelPath;
        } catch (_) { /* local not available, use CDN */ }

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: modelPath,
                delegate: 'GPU'
            },
            runningMode: 'IMAGE',
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false
        });
        console.log('FaceLandmarker loaded from:', modelPath);

        console.log('MediaPipe FaceLandmarker loaded');
    }

    async function loadPupilModel() {
        // Try to load custom TFLite pupil model
        // If not available (not yet trained), we skip this stage
        try {
            const tflite = await import(
                'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.10/+esm'
            );
            await tflite.setWasmPath(
                'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.10/wasm/'
            );
            pupilInterpreter = await tflite.loadTFLiteModel('models/pupil_segnet.tflite');
            console.log('Pupil TFLite model loaded');
        } catch (e) {
            console.warn('Pupil TFLite model not available, using threshold-based pupil detection within iris ROI:', e.message);
            pupilInterpreter = null;
        }
    }

    // Fit circle to a set of 2D points
    function fitCircleToPoints(points) {
        if (points.length < 3) return null;
        let cx = 0, cy = 0;
        for (const p of points) { cx += p.x; cy += p.y; }
        cx /= points.length;
        cy /= points.length;
        let totalDist = 0;
        for (const p of points) {
            totalDist += Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
        }
        const r = totalDist / points.length;
        return { x: cx, y: cy, r };
    }

    // Extract iris circle from MediaPipe landmarks
    function extractIrisCircle(landmarks, irisIndices, imgW, imgH) {
        const center = landmarks[irisIndices[0]];
        const boundary = irisIndices.slice(1).map(i => landmarks[i]);

        const centerPx = { x: center.x * imgW, y: center.y * imgH };
        const boundaryPx = boundary.map(p => ({ x: p.x * imgW, y: p.y * imgH }));

        // Average distance from center to boundary points = iris radius
        let totalR = 0;
        for (const p of boundaryPx) {
            totalR += Math.sqrt((p.x - centerPx.x) ** 2 + (p.y - centerPx.y) ** 2);
        }
        const r = totalR / boundaryPx.length;

        return { x: Math.round(centerPx.x), y: Math.round(centerPx.y), r: Math.round(r) };
    }

    // Detect pupil within iris ROI using threshold (fallback when TFLite not available)
    function detectPupilInROI(imageData, irisCircle, fullW, fullH) {
        const cx = irisCircle.x, cy = irisCircle.y, ir = irisCircle.r;
        const roiSize = Math.round(ir * 2.2);
        const roiX = Math.max(0, cx - roiSize / 2);
        const roiY = Math.max(0, cy - roiSize / 2);
        const roiW = Math.min(roiSize, fullW - roiX);
        const roiH = Math.min(roiSize, fullH - roiY);

        // Extract grayscale ROI
        const data = imageData.data;
        let darkSum = 0, darkCount = 0;
        let totalSum = 0, totalCount = 0;

        for (let y = 0; y < roiH; y++) {
            for (let x = 0; x < roiW; x++) {
                const px = Math.round(roiX + x);
                const py = Math.round(roiY + y);
                if (px >= fullW || py >= fullH) continue;
                const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                if (dist > ir) continue;

                const idx = (py * fullW + px) * 4;
                const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                totalSum += gray;
                totalCount++;

                if (dist < ir * 0.5) {
                    darkSum += gray;
                    darkCount++;
                }
            }
        }

        const centerAvg = darkCount > 0 ? darkSum / darkCount : 50;
        const overallAvg = totalCount > 0 ? totalSum / totalCount : 128;
        const threshold = centerAvg + (overallAvg - centerAvg) * 0.35;

        // Flood fill from iris center
        const pixels = [];
        const visited = new Set();
        const queue = [`${cx},${cy}`];

        while (queue.length > 0) {
            const key = queue.pop();
            if (visited.has(key)) continue;
            visited.add(key);

            const [px, py] = key.split(',').map(Number);
            if (px < 0 || px >= fullW || py < 0 || py >= fullH) continue;

            const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
            if (dist > ir * 0.8) continue;

            const idx = (py * fullW + px) * 4;
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            if (gray > threshold) continue;

            pixels.push({ x: px, y: py });
            if (pixels.length > ir * ir * 0.8) break;

            for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nk = `${px+dx},${py+dy}`;
                if (!visited.has(nk)) queue.push(nk);
            }
        }

        if (pixels.length < 10) {
            return { x: cx, y: cy, r: Math.round(ir * 0.35) };
        }

        // Fit circle
        let pcx = 0, pcy = 0;
        for (const p of pixels) { pcx += p.x; pcy += p.y; }
        pcx /= pixels.length;
        pcy /= pixels.length;
        let totalDist = 0;
        for (const p of pixels) {
            totalDist += Math.sqrt((p.x - pcx) ** 2 + (p.y - pcy) ** 2);
        }
        const pr = (totalDist / pixels.length) * 1.5;

        return { x: Math.round(pcx), y: Math.round(pcy), r: Math.round(Math.max(pr, 5)) };
    }

    // Detect pupil within iris ROI using TFLite model
    async function detectPupilWithModel(imageData, irisCircle, fullW, fullH) {
        if (!pupilInterpreter) {
            return detectPupilInROI(imageData, irisCircle, fullW, fullH);
        }

        const cx = irisCircle.x, cy = irisCircle.y, ir = irisCircle.r;
        const pad = ir * 1.3;
        const sx = Math.max(0, Math.round(cx - pad));
        const sy = Math.max(0, Math.round(cy - pad));
        const sw = Math.min(Math.round(pad * 2), fullW - sx);
        const sh = Math.min(Math.round(pad * 2), fullH - sy);

        // Crop and resize to model input size
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = PUPIL_MODEL_SIZE;
        cropCanvas.height = PUPIL_MODEL_SIZE;
        const cropCtx = cropCanvas.getContext('2d');

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = fullW;
        srcCanvas.height = fullH;
        srcCanvas.getContext('2d').putImageData(imageData, 0, 0);

        cropCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, PUPIL_MODEL_SIZE, PUPIL_MODEL_SIZE);
        const cropData = cropCtx.getImageData(0, 0, PUPIL_MODEL_SIZE, PUPIL_MODEL_SIZE);

        // Normalize to [0, 1] float32 tensor
        const input = new Float32Array(PUPIL_MODEL_SIZE * PUPIL_MODEL_SIZE * 3);
        for (let i = 0; i < PUPIL_MODEL_SIZE * PUPIL_MODEL_SIZE; i++) {
            input[i * 3] = cropData.data[i * 4] / 255.0;
            input[i * 3 + 1] = cropData.data[i * 4 + 1] / 255.0;
            input[i * 3 + 2] = cropData.data[i * 4 + 2] / 255.0;
        }

        // Run inference
        const outputTensor = pupilInterpreter.predict(
            tf.tensor4d(input, [1, PUPIL_MODEL_SIZE, PUPIL_MODEL_SIZE, 3])
        );
        const output = await outputTensor.data();
        outputTensor.dispose();

        // Binary mask -> find pupil pixels
        const pixels = [];
        for (let y = 0; y < PUPIL_MODEL_SIZE; y++) {
            for (let x = 0; x < PUPIL_MODEL_SIZE; x++) {
                const val = output[y * PUPIL_MODEL_SIZE + x];
                if (val > 0.5) {
                    pixels.push({
                        x: sx + (x / PUPIL_MODEL_SIZE) * sw,
                        y: sy + (y / PUPIL_MODEL_SIZE) * sh
                    });
                }
            }
        }

        if (pixels.length < 10) {
            return detectPupilInROI(imageData, irisCircle, fullW, fullH);
        }

        let pcx = 0, pcy = 0;
        for (const p of pixels) { pcx += p.x; pcy += p.y; }
        pcx /= pixels.length;
        pcy /= pixels.length;
        const area = pixels.length * (sw / PUPIL_MODEL_SIZE) * (sh / PUPIL_MODEL_SIZE);
        const pr = Math.sqrt(area / Math.PI);

        return { x: Math.round(pcx), y: Math.round(pcy), r: Math.round(Math.max(pr, 5)) };
    }

    // Determine which eye we're looking at based on position in image
    function pickEyeLandmarks(landmarks, imgW) {
        // For a close-up single eye photo, use whichever iris is more central
        const leftCenter = landmarks[LEFT_IRIS[0]];
        const rightCenter = landmarks[RIGHT_IRIS[0]];

        if (!leftCenter || !rightCenter) return LEFT_IRIS;

        const leftDist = Math.abs(leftCenter.x * imgW - imgW / 2);
        const rightDist = Math.abs(rightCenter.x * imgW - imgW / 2);

        return leftDist < rightDist ? LEFT_IRIS : RIGHT_IRIS;
    }

    // Main detection entry point
    async function detect(imageData, width, height) {
        if (!faceLandmarker) {
            throw new Error('MediaPipe not loaded');
        }

        // Create canvas for MediaPipe input
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        // Run MediaPipe
        const results = faceLandmarker.detect(canvas);

        if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
            throw new Error('No face detected');
        }

        const landmarks = results.faceLandmarks[0];

        // Pick the more centered eye
        const irisIndices = pickEyeLandmarks(landmarks, width);
        const iris = extractIrisCircle(landmarks, irisIndices, width, height);

        // Detect pupil within iris ROI
        const pupil = await detectPupilWithModel(imageData, iris, width, height);

        // Sanity checks
        if (pupil.r >= iris.r * 0.95) pupil.r = Math.round(iris.r * 0.4);
        if (pupil.r < 3) pupil.r = Math.round(iris.r * 0.3);

        // Confidence based on iris detection quality
        const irisConf = iris.r > 10 ? 0.85 : 0.5;
        const pupilConf = pupilInterpreter ? 0.8 : 0.6;

        return {
            pupil,
            iris,
            confidence: { pupil: pupilConf, iris: irisConf },
            method: pupilInterpreter ? 'ml-full' : 'ml-mediapipe'
        };
    }

    return {
        init,
        detect,
        isReady,
        getStatus,
        setStatusCallback
    };
})();
