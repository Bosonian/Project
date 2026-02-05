/* ==========================================================================
   PupilCheck v2.0 - Measurement Flow
   measurement.js

   Core measurement logic: camera capture, pupil detection (ML -> Cloud ->
   Classical -> fallback), circle adjustment, results display, save, report.

   Dependencies (loaded before this file):
     i18n, patientStore, MLDetection, CloudDetection, ClassicalDetection,
     App, ReportGenerator
   ========================================================================== */

const Measurement = (() => {
    'use strict';

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    const EMPTY_EYE = () => ({
        image: null,        // ImageData
        imageWidth: 0,
        imageHeight: 0,
        pupil: null,        // { x, y, r }
        iris: null,         // { x, y, r }
        pupilMm: null,
        ratio: null,
        focusDistance: null, // metres, from camera API
        torchOn: false,
        detectionMethod: null
    });

    const state = {
        currentEye: 'left',          // 'left' | 'right'
        facingMode: 'environment',
        stream: null,
        torchOn: false,
        torchSupported: false,
        mode: 'size',                // 'size' | 'reactivity'
        reactivityPhase: 'dark',     // 'dark' | 'light'
        selectedCircle: 'pupil',     // 'pupil' | 'iris'
        capturedImage: null,         // ImageData
        capturedWidth: 0,
        capturedHeight: 0,
        _currentStoreKey: null,
        captureMode: 'both',         // 'both' | 'single'
        selectedDualEye: 'right',    // which eye is selected in dual view
        left: EMPTY_EYE(),
        right: EMPTY_EYE(),
        leftLight: EMPTY_EYE(),
        rightLight: EMPTY_EYE()
    };

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------
    function currentKey() {
        return state._currentStoreKey || state.currentEye;
    }

    function getIrisRefMm() {
        return App.getIrisRefMm();
    }

    function $(id) {
        return document.getElementById(id);
    }

    // ------------------------------------------------------------------
    // NAVIGATION
    // ------------------------------------------------------------------
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(function (s) {
            s.classList.remove('active');
        });
        $(id).classList.add('active');
    }

    function setMode(mode) {
        state.mode = mode;
        localStorage.setItem('pupilcheck_mode', mode);
        updateModeUI();
    }

    function updateModeUI() {
        var modeSize = $('modeSize');
        var modeReact = $('modeReactivity');
        if (modeSize) {
            modeSize.classList.toggle('active', state.mode === 'size');
            modeSize.setAttribute('aria-pressed', state.mode === 'size' ? 'true' : 'false');
        }
        if (modeReact) {
            modeReact.classList.toggle('active', state.mode === 'reactivity');
            modeReact.setAttribute('aria-pressed', state.mode === 'reactivity' ? 'true' : 'false');
        }
    }

    function setCaptureMode(mode) {
        state.captureMode = mode;
        localStorage.setItem('pupilcheck_captureMode', mode);
        updateCaptureModeUI();
    }

    function updateCaptureModeUI() {
        var btnBoth = $('captureBoth');
        var btnSingle = $('captureSingle');
        if (btnBoth) {
            btnBoth.classList.toggle('active', state.captureMode === 'both');
            btnBoth.setAttribute('aria-pressed', state.captureMode === 'both' ? 'true' : 'false');
        }
        if (btnSingle) {
            btnSingle.classList.toggle('active', state.captureMode === 'single');
            btnSingle.setAttribute('aria-pressed', state.captureMode === 'single' ? 'true' : 'false');
        }
    }

    function startMeasurement() {
        state.reactivityPhase = 'dark';
        state.left = EMPTY_EYE();
        state.right = EMPTY_EYE();
        state.leftLight = EMPTY_EYE();
        state.rightLight = EMPTY_EYE();
        state.torchOn = false;

        if (state.captureMode === 'both') {
            state.currentEye = 'both';
            openCamera();
        } else {
            state.currentEye = 'left';
            openCamera();
        }
    }

    function goBack() {
        stopCamera();
        showScreen('screenWelcome');
    }

    function startOver() {
        state.left = EMPTY_EYE();
        state.right = EMPTY_EYE();
        state.leftLight = EMPTY_EYE();
        state.rightLight = EMPTY_EYE();
        state.torchOn = false;
        showScreen('screenWelcome');
    }

    function remeasureEye(eye) {
        state.currentEye = eye;
        state[eye] = EMPTY_EYE();
        if (state.mode === 'reactivity') {
            state[eye + 'Light'] = EMPTY_EYE();
            state.reactivityPhase = 'dark';
        }
        openCamera();
    }

    // ------------------------------------------------------------------
    // CAMERA
    // ------------------------------------------------------------------
    async function openCamera() {
        var label;
        if (state.captureMode === 'both') {
            label = 'Both Eyes';
        } else {
            label = state.currentEye === 'left' ? 'Left Eye (OS)' : 'Right Eye (OD)';
        }
        var eyeLabelEl = $('cameraEyeLabel');
        eyeLabelEl.textContent = label;
        eyeLabelEl.className = 'eye-label ' + (state.captureMode === 'both' ? '' : state.currentEye);
        showScreen('screenCamera');

        try {
            if (state.stream) {
                state.stream.getTracks().forEach(function (t) { t.stop(); });
            }
            state.torchOn = false;

            var constraints = {
                video: {
                    facingMode: state.facingMode,
                    width: { ideal: state.captureMode === 'both' ? 1920 : 1280 },
                    height: { ideal: state.captureMode === 'both' ? 1080 : 960 }
                }
            };
            state.stream = await navigator.mediaDevices.getUserMedia(constraints);

            var video = $('cameraVideo');
            video.srcObject = state.stream;
            // Apply mirror for front camera
            video.classList.toggle('mirrored', state.facingMode === 'user');
            await video.play();

            // Check torch support
            state.torchSupported = false;
            try {
                var track = state.stream.getVideoTracks()[0];
                if (track) {
                    var caps = track.getCapabilities();
                    state.torchSupported = caps.torch === true;
                }
            } catch (_e) { /* torch check not supported */ }

            updateTorchUI();
            initZoomControl();
            updateCaptureInstruction();

            // In reactivity light phase, auto-enable torch
            if (state.mode === 'reactivity' && state.reactivityPhase === 'light' && state.torchSupported) {
                await setTorch(true);
            }

        } catch (err) {
            App.showToast('Camera access denied or unavailable. Please allow camera permissions.', 'error', 5000);
            showScreen('screenWelcome');
        }
    }

    function stopCamera() {
        if (state.stream) {
            state.stream.getTracks().forEach(function (t) { t.stop(); });
            state.stream = null;
        }
        var video = $('cameraVideo');
        if (video) video.srcObject = null;
    }

    async function switchCamera() {
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        await openCamera();
    }

    function captureImage() {
        var video = $('cameraVideo');
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        var ctx = canvas.getContext('2d');

        // If front camera, mirror the image for natural orientation
        if (state.facingMode === 'user') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0);

        state.capturedWidth = canvas.width;
        state.capturedHeight = canvas.height;
        state.capturedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Read focus distance (progressive enhancement)
        var focusDist = null;
        try {
            if (state.stream) {
                var track = state.stream.getVideoTracks()[0];
                if (track) {
                    var settings = track.getSettings();
                    if (settings.focusDistance !== undefined && settings.focusDistance > 0) {
                        focusDist = settings.focusDistance; // metres
                    }
                }
            }
        } catch (_e) { /* focus distance not available */ }

        // Determine storage key based on reactivity mode
        var storeKey = (state.mode === 'reactivity' && state.reactivityPhase === 'light')
            ? state.currentEye + 'Light'
            : state.currentEye;

        state[storeKey].focusDistance = focusDist;
        state[storeKey].torchOn = state.torchOn;

        stopCamera();
        if (state.captureMode === 'both') {
            var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'light' : 'dark';
            processAndShowDualMeasurement(phase);
        } else {
            processAndShowMeasurement(storeKey);
        }
    }

    // ------------------------------------------------------------------
    // TORCH
    // ------------------------------------------------------------------
    async function setTorch(on) {
        if (!state.stream) return;
        try {
            var track = state.stream.getVideoTracks()[0];
            if (track) {
                await track.applyConstraints({ advanced: [{ torch: on }] });
                state.torchOn = on;
                updateTorchUI();
                // Adjust exposure for torch
                if (on) {
                    await optimizeExposureForTorch();
                } else {
                    await resetExposure();
                }
            }
        } catch (_e) {
            state.torchSupported = false;
            updateTorchUI();
        }
    }

    async function toggleTorch() {
        await setTorch(!state.torchOn);
    }

    async function optimizeExposureForTorch() {
        if (!state.stream) return;
        try {
            var track = state.stream.getVideoTracks()[0];
            if (!track) return;
            var caps = track.getCapabilities();

            // Android Chrome 101+: manual exposure mode
            if (caps.exposureMode && caps.exposureMode.indexOf('manual') !== -1) {
                await track.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
                if (caps.exposureTime) {
                    var targetExp = Math.max(caps.exposureTime.min || 1, 30);
                    await track.applyConstraints({ advanced: [{ exposureTime: targetExp }] });
                }
            }
            if (caps.iso) {
                await track.applyConstraints({ advanced: [{ iso: caps.iso.min }] });
            }
        } catch (_e) { /* exposure control not supported */ }
    }

    async function resetExposure() {
        if (!state.stream) return;
        try {
            var track = state.stream.getVideoTracks()[0];
            if (!track) return;
            var caps = track.getCapabilities();
            if (caps.exposureMode && caps.exposureMode.indexOf('continuous') !== -1) {
                await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] });
            }
        } catch (_e) { /* exposure reset not supported */ }
    }

    function updateTorchUI() {
        var control = $('torchControl');
        if (!control) return;

        if (!state.torchSupported) {
            control.innerHTML = '<div class="torch-unavailable">Torch not available (use rear camera or a supported browser)</div>';
            return;
        }

        // Restore button if replaced with unavailable note
        if (!$('torchBtn')) {
            control.innerHTML =
                '<button class="torch-btn" id="torchBtn" type="button" onclick="Measurement.toggleTorch()" aria-label="Toggle flashlight">' +
                '<span class="torch-icon" id="torchIcon" aria-hidden="true">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
                '</span>' +
                '<span id="torchLabel">Torch OFF</span></button>';
        }

        var btnEl = $('torchBtn');
        var labelEl = $('torchLabel');
        if (btnEl) btnEl.classList.toggle('on', state.torchOn);
        if (labelEl) labelEl.textContent = state.torchOn ? 'Torch ON' : 'Torch OFF';
    }

    function updateCaptureInstruction() {
        var el = $('captureInstruction');
        if (!el) return;
        if (state.mode === 'reactivity') {
            if (state.reactivityPhase === 'dark') {
                el.innerHTML = '<strong>Step 1:</strong> Capture in ambient light (torch off)';
            } else {
                el.innerHTML = '<strong>Step 2:</strong> Capture with torch light (observe constriction)';
            }
        } else {
            el.textContent = '';
        }
    }

    // ------------------------------------------------------------------
    // ZOOM
    // ------------------------------------------------------------------
    function initZoomControl() {
        var zoomControl = $('zoomControl');
        var zoomPresets = $('zoomPresets');
        if (!state.stream) {
            zoomControl.style.display = 'none';
            zoomPresets.style.display = 'none';
            return;
        }

        try {
            var track = state.stream.getVideoTracks()[0];
            if (!track) return;
            var caps = track.getCapabilities();

            if (caps.zoom) {
                var minZoom = caps.zoom.min || 1;
                var maxZoom = Math.min(caps.zoom.max || 1, 10);
                var slider = $('zoomSlider');
                slider.min = minZoom;
                slider.max = maxZoom;
                slider.step = (maxZoom - minZoom) > 5 ? 0.5 : 0.1;
                slider.value = track.getSettings().zoom || 1;
                $('zoomValue').textContent = parseFloat(slider.value).toFixed(1) + 'x';

                zoomControl.style.display = 'flex';
                zoomPresets.style.display = 'flex';
                zoomPresets.querySelectorAll('button').forEach(function (btn) {
                    var z = parseFloat(btn.dataset.zoom);
                    btn.style.display = z <= maxZoom ? '' : 'none';
                    btn.classList.toggle('active', Math.abs(z - parseFloat(slider.value)) < 0.15);
                });
            } else {
                zoomControl.style.display = 'none';
                zoomPresets.style.display = 'none';
            }
        } catch (_e) {
            zoomControl.style.display = 'none';
            zoomPresets.style.display = 'none';
        }
    }

    async function onZoomChange() {
        var val = parseFloat($('zoomSlider').value);
        $('zoomValue').textContent = val.toFixed(1) + 'x';
        await applyZoom(val);
        updateZoomPresets(val);
    }

    async function setZoom(level) {
        $('zoomSlider').value = level;
        $('zoomValue').textContent = level.toFixed(1) + 'x';
        await applyZoom(level);
        updateZoomPresets(level);
    }

    function updateZoomPresets(val) {
        var presets = $('zoomPresets');
        if (!presets) return;
        presets.querySelectorAll('button').forEach(function (btn) {
            btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.zoom) - val) < 0.15);
        });
    }

    async function applyZoom(level) {
        if (!state.stream) return;
        try {
            var track = state.stream.getVideoTracks()[0];
            if (track) {
                await track.applyConstraints({ advanced: [{ zoom: level }] });
            }
        } catch (_e) { /* zoom control failed */ }
    }

    // ------------------------------------------------------------------
    // PROCESSING OVERLAY
    // ------------------------------------------------------------------
    function showProcessing(show) {
        var overlay = $('processingOverlay');
        if (overlay) overlay.classList.toggle('active', show);
    }

    function updateProcessingText(text) {
        var el = $('processingText');
        if (el) el.textContent = text;
    }

    // ------------------------------------------------------------------
    // DETECTION - THE FALLBACK CHAIN: ML -> Cloud -> Classical -> Manual
    // ------------------------------------------------------------------
    async function processAndShowMeasurement(storeKey) {
        state._currentStoreKey = storeKey;
        showProcessing(true);

        var imageData = state.capturedImage;
        var w = state.capturedWidth;
        var h = state.capturedHeight;
        var result = null;

        // 1. Try ML first (MediaPipe + optional TFLite)
        if (typeof MLDetection !== 'undefined' && MLDetection.isReady()) {
            updateProcessingText('Analyzing with ML model...');
            try {
                result = await MLDetection.detect(imageData, w, h);
                if (result) {
                    result.method = result.method || 'ml';
                }
            } catch (e) {
                console.warn('ML detection failed:', e.message);
                result = null;
            }
        }

        // 2. Try Cloud
        if (!result && typeof CloudDetection !== 'undefined' && CloudDetection.isAvailable()) {
            updateProcessingText('Analyzing with cloud ML...');
            try {
                result = await CloudDetection.detect(imageData, w, h);
                if (result) {
                    result.method = result.method || 'cloud';
                }
            } catch (e) {
                console.warn('Cloud detection failed:', e.message);
                result = null;
            }
        }

        // 3. Classical CV fallback
        if (!result) {
            updateProcessingText('Detecting pupil...');
            try {
                result = ClassicalDetection.detect(imageData, w, h);
            } catch (e) {
                console.error('All detection methods failed:', e);
                // 4. Ultimate fallback: centred circles for manual adjustment
                result = {
                    pupil: {
                        x: Math.round(w / 2),
                        y: Math.round(h / 2),
                        r: Math.round(Math.min(w, h) * 0.06)
                    },
                    iris: {
                        x: Math.round(w / 2),
                        y: Math.round(h / 2),
                        r: Math.round(Math.min(w, h) * 0.2)
                    },
                    confidence: { pupil: 0, iris: 0 },
                    method: 'fallback'
                };
            }
        }

        // Apply results to state
        var eyeData = state[storeKey];
        eyeData.pupil = result.pupil;
        eyeData.iris = result.iris;
        eyeData.image = state.capturedImage;
        eyeData.imageWidth = w;
        eyeData.imageHeight = h;
        eyeData.detectionMethod = result.method;

        showProcessing(false);
        showMeasurementScreen();
    }

    // ------------------------------------------------------------------
    // MEASUREMENT SCREEN
    // ------------------------------------------------------------------
    function showMeasurementScreen() {
        var label = state.currentEye === 'left' ? 'Left Eye (OS)' : 'Right Eye (OD)';
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? ' (with light)' : '';
        var eyeEl = $('measureEyeLabel');
        eyeEl.textContent = label + phase;
        eyeEl.className = 'eye-label ' + state.currentEye;

        showScreen('screenMeasure');
        selectCircle('pupil');
        drawMeasurement();
        updateSliders();
        updateLiveStats();
    }

    function selectCircle(which) {
        state.selectedCircle = which;
        var pupilBtn = $('togglePupil');
        var irisBtn = $('toggleIris');
        pupilBtn.classList.toggle('active', which === 'pupil');
        irisBtn.classList.toggle('active', which === 'iris');
        pupilBtn.setAttribute('aria-pressed', which === 'pupil' ? 'true' : 'false');
        irisBtn.setAttribute('aria-pressed', which === 'iris' ? 'true' : 'false');
        updateSliders();
    }

    function updateSliders() {
        var eyeData = state[currentKey()];
        var circle = state.selectedCircle === 'pupil' ? eyeData.pupil : eyeData.iris;
        if (!circle) return;

        var sliderX = $('sliderX');
        var sliderY = $('sliderY');
        var sliderR = $('sliderR');

        sliderX.max = state.capturedWidth;
        sliderY.max = state.capturedHeight;
        sliderR.max = Math.round(Math.min(state.capturedWidth, state.capturedHeight) / 2);

        sliderX.value = circle.x;
        sliderY.value = circle.y;
        sliderR.value = circle.r;

        $('sliderXValue').textContent = circle.x + ' px';
        $('sliderYValue').textContent = circle.y + ' px';
        $('sliderRValue').textContent = circle.r + ' px';
    }

    function onSliderChange() {
        var eyeData = state[currentKey()];
        var circle = state.selectedCircle === 'pupil' ? eyeData.pupil : eyeData.iris;
        if (!circle) return;

        circle.x = parseInt($('sliderX').value, 10);
        circle.y = parseInt($('sliderY').value, 10);
        circle.r = parseInt($('sliderR').value, 10);

        $('sliderXValue').textContent = circle.x + ' px';
        $('sliderYValue').textContent = circle.y + ' px';
        $('sliderRValue').textContent = circle.r + ' px';

        drawMeasurement();
        updateLiveStats();
    }

    function drawMeasurement() {
        var canvas = $('measureCanvas');
        var eyeData = state[currentKey()];
        if (!eyeData.image) return;

        var w = state.capturedWidth;
        var h = state.capturedHeight;
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');

        // Draw captured image
        var tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        tempCanvas.getContext('2d').putImageData(eyeData.image, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);

        // Draw iris circle (outer)
        if (eyeData.iris) {
            ctx.beginPath();
            ctx.arc(eyeData.iris.x, eyeData.iris.y, eyeData.iris.r, 0, Math.PI * 2);
            ctx.strokeStyle = state.selectedCircle === 'iris' ? '#ffa502' : 'rgba(255, 165, 2, 0.5)';
            ctx.lineWidth = state.selectedCircle === 'iris' ? 3 : 2;
            ctx.setLineDash(state.selectedCircle === 'iris' ? [] : [8, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair on selected
            if (state.selectedCircle === 'iris') {
                drawCrosshair(ctx, eyeData.iris.x, eyeData.iris.y, '#ffa502');
            }
        }

        // Draw pupil circle (inner)
        if (eyeData.pupil) {
            ctx.beginPath();
            ctx.arc(eyeData.pupil.x, eyeData.pupil.y, eyeData.pupil.r, 0, Math.PI * 2);
            ctx.strokeStyle = state.selectedCircle === 'pupil' ? '#e94560' : 'rgba(233, 69, 96, 0.5)';
            ctx.lineWidth = state.selectedCircle === 'pupil' ? 3 : 2;
            ctx.setLineDash(state.selectedCircle === 'pupil' ? [] : [8, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Semi-transparent fill
            ctx.beginPath();
            ctx.arc(eyeData.pupil.x, eyeData.pupil.y, eyeData.pupil.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(233, 69, 96, 0.1)';
            ctx.fill();

            // Crosshair on selected
            if (state.selectedCircle === 'pupil') {
                drawCrosshair(ctx, eyeData.pupil.x, eyeData.pupil.y, '#e94560');
            }
        }
    }

    function drawCrosshair(ctx, x, y, color) {
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.lineTo(x + 10, y);
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x, y + 10);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function updateLiveStats() {
        var eyeData = state[currentKey()];
        if (!eyeData.pupil || !eyeData.iris) return;

        var pupilDiaPx = eyeData.pupil.r * 2;
        var irisDiaPx = eyeData.iris.r * 2;
        var ratio = irisDiaPx > 0 ? pupilDiaPx / irisDiaPx : 0;
        var irisRef = getIrisRefMm();
        var estMm = ratio * irisRef;

        $('livePupilPx').textContent = pupilDiaPx + ' px';
        $('liveIrisPx').textContent = irisDiaPx + ' px';
        $('liveRatio').textContent = ratio.toFixed(3);
        $('liveEstMm').textContent = estMm.toFixed(1) + ' mm';

        // Focus distance
        var focusRow = $('liveFocusRow');
        if (eyeData.focusDistance !== null && eyeData.focusDistance > 0) {
            focusRow.style.display = '';
            var cm = (eyeData.focusDistance * 100).toFixed(1);
            $('liveFocusDist').textContent = cm + ' cm';
        } else {
            focusRow.style.display = 'none';
        }
    }

    // ------------------------------------------------------------------
    // DUAL-EYE MEASUREMENT (Both Eyes mode)
    // ------------------------------------------------------------------
    async function processAndShowDualMeasurement(phase) {
        showProcessing(true);
        var imageData = state.capturedImage;
        var w = state.capturedWidth;
        var h = state.capturedHeight;
        var result = null;

        // 1. Try ML (both eyes from single image)
        if (typeof MLDetection !== 'undefined' && MLDetection.isReady()) {
            updateProcessingText('Analyzing both eyes with ML...');
            try {
                result = await MLDetection.detectBothEyes(imageData, w, h);
            } catch (e) {
                console.warn('ML dual detection failed:', e.message);
                result = null;
            }
        }

        // 2. Try classical (split image in half)
        if (!result) {
            updateProcessingText('Detecting pupils...');
            try {
                result = ClassicalDetection.detectBoth(imageData, w, h);
            } catch (e) {
                console.warn('Classical dual detection failed:', e.message);
                result = null;
            }
        }

        // 3. Manual fallback — centered circles for both halves
        if (!result) {
            result = {
                left: {
                    pupil: { x: Math.round(w * 0.75), y: Math.round(h / 2), r: Math.round(Math.min(w, h) * 0.04) },
                    iris: { x: Math.round(w * 0.75), y: Math.round(h / 2), r: Math.round(Math.min(w, h) * 0.12) },
                    confidence: { pupil: 0, iris: 0 },
                    method: 'fallback'
                },
                right: {
                    pupil: { x: Math.round(w * 0.25), y: Math.round(h / 2), r: Math.round(Math.min(w, h) * 0.04) },
                    iris: { x: Math.round(w * 0.25), y: Math.round(h / 2), r: Math.round(Math.min(w, h) * 0.12) },
                    confidence: { pupil: 0, iris: 0 },
                    method: 'fallback'
                }
            };
        }

        // Store to appropriate state keys
        var leftKey = (phase === 'light') ? 'leftLight' : 'left';
        var rightKey = (phase === 'light') ? 'rightLight' : 'right';

        var leftEye = state[leftKey];
        leftEye.pupil = result.left.pupil;
        leftEye.iris = result.left.iris;
        leftEye.image = imageData;
        leftEye.imageWidth = w;
        leftEye.imageHeight = h;
        leftEye.detectionMethod = result.left.method || 'unknown';

        var rightEye = state[rightKey];
        rightEye.pupil = result.right.pupil;
        rightEye.iris = result.right.iris;
        rightEye.image = imageData;
        rightEye.imageWidth = w;
        rightEye.imageHeight = h;
        rightEye.detectionMethod = result.right.method || 'unknown';

        showProcessing(false);
        showDualMeasurementScreen(phase);
    }

    function showDualMeasurementScreen(phase) {
        var phaseLabel = (phase === 'light') ? 'Both Eyes (with light)' : 'Both Eyes';
        var el = $('dualPhaseLabel');
        if (el) el.textContent = phaseLabel;

        state.selectedDualEye = 'right';
        state.selectedCircle = 'pupil';

        showScreen('screenMeasureDual');
        selectDualEye('right');
        drawDualCanvases();
        updateDualStats();
    }

    function selectDualEye(eye) {
        state.selectedDualEye = eye;
        var panelLeft = $('dualPanelLeft');
        var panelRight = $('dualPanelRight');
        if (panelLeft) panelLeft.classList.toggle('selected', eye === 'left');
        if (panelRight) panelRight.classList.toggle('selected', eye === 'right');

        var label = $('dualSelectedLabel');
        if (label) label.textContent = (eye === 'right' ? 'Right (OD)' : 'Left (OS)') + ' selected';

        updateDualSliders();
    }

    function selectCircleDual(which) {
        state.selectedCircle = which;
        var pupilBtn = $('dualTogglePupil');
        var irisBtn = $('dualToggleIris');
        if (pupilBtn) {
            pupilBtn.classList.toggle('active', which === 'pupil');
            pupilBtn.setAttribute('aria-pressed', which === 'pupil' ? 'true' : 'false');
        }
        if (irisBtn) {
            irisBtn.classList.toggle('active', which === 'iris');
            irisBtn.setAttribute('aria-pressed', which === 'iris' ? 'true' : 'false');
        }
        updateDualSliders();
    }

    function updateDualSliders() {
        var eyeKey = state.selectedDualEye;
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';
        var eyeData = state[eyeKey + phase] || state[eyeKey];
        var circle = state.selectedCircle === 'pupil' ? eyeData.pupil : eyeData.iris;
        if (!circle) return;

        var sliderX = $('dualSliderX');
        var sliderY = $('dualSliderY');
        var sliderR = $('dualSliderR');

        sliderX.max = state.capturedWidth;
        sliderY.max = state.capturedHeight;
        sliderR.max = Math.round(Math.min(state.capturedWidth, state.capturedHeight) / 2);

        sliderX.value = circle.x;
        sliderY.value = circle.y;
        sliderR.value = circle.r;

        $('dualSliderXValue').textContent = circle.x + ' px';
        $('dualSliderYValue').textContent = circle.y + ' px';
        $('dualSliderRValue').textContent = circle.r + ' px';
    }

    function onDualSliderChange() {
        var eyeKey = state.selectedDualEye;
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';
        var eyeData = state[eyeKey + phase] || state[eyeKey];
        var circle = state.selectedCircle === 'pupil' ? eyeData.pupil : eyeData.iris;
        if (!circle) return;

        circle.x = parseInt($('dualSliderX').value, 10);
        circle.y = parseInt($('dualSliderY').value, 10);
        circle.r = parseInt($('dualSliderR').value, 10);

        $('dualSliderXValue').textContent = circle.x + ' px';
        $('dualSliderYValue').textContent = circle.y + ' px';
        $('dualSliderRValue').textContent = circle.r + ' px';

        drawDualCanvases();
        updateDualStats();
    }

    function drawDualCanvases() {
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';
        drawDualEyeCanvas('dualCanvasRight', state['right' + phase] || state.right, 'right');
        drawDualEyeCanvas('dualCanvasLeft', state['left' + phase] || state.left, 'left');
    }

    function drawDualEyeCanvas(canvasId, eyeData, whichEye) {
        var canvas = $(canvasId);
        if (!canvas || !eyeData.image) return;
        var ctx = canvas.getContext('2d');

        var iris = eyeData.iris;
        if (!iris) return;

        // Crop region around iris with padding
        var pad = iris.r * 1.8;
        var sx = Math.max(0, Math.round(iris.x - pad));
        var sy = Math.max(0, Math.round(iris.y - pad));
        var sw = Math.min(Math.round(pad * 2), eyeData.imageWidth - sx);
        var sh = Math.min(Math.round(pad * 2), eyeData.imageHeight - sy);

        // Draw source image to temp canvas
        var temp = document.createElement('canvas');
        temp.width = eyeData.imageWidth;
        temp.height = eyeData.imageHeight;
        temp.getContext('2d').putImageData(eyeData.image, 0, 0);

        // Render cropped region
        var size = 300;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(temp, sx, sy, sw, sh, 0, 0, size, size);

        var scaleX = size / sw;
        var scaleY = size / sh;

        var isSelected = state.selectedDualEye === whichEye;

        // Draw iris circle
        if (iris) {
            var ix = (iris.x - sx) * scaleX;
            var iy = (iris.y - sy) * scaleY;
            var ir = iris.r * scaleX;
            ctx.beginPath();
            ctx.arc(ix, iy, ir, 0, Math.PI * 2);
            ctx.strokeStyle = (isSelected && state.selectedCircle === 'iris') ? '#ffa502' : 'rgba(255, 165, 2, 0.5)';
            ctx.lineWidth = (isSelected && state.selectedCircle === 'iris') ? 3 : 2;
            ctx.setLineDash((isSelected && state.selectedCircle === 'iris') ? [] : [6, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw pupil circle
        if (eyeData.pupil) {
            var px = (eyeData.pupil.x - sx) * scaleX;
            var py = (eyeData.pupil.y - sy) * scaleY;
            var pr = eyeData.pupil.r * scaleX;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.strokeStyle = (isSelected && state.selectedCircle === 'pupil') ? '#e94560' : 'rgba(233, 69, 96, 0.5)';
            ctx.lineWidth = (isSelected && state.selectedCircle === 'pupil') ? 3 : 2;
            ctx.setLineDash((isSelected && state.selectedCircle === 'pupil') ? [] : [6, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Semi-transparent fill
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(233, 69, 96, 0.1)';
            ctx.fill();
        }
    }

    function updateDualStats() {
        var irisRef = getIrisRefMm();
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';

        var leftData = state['left' + phase] || state.left;
        var rightData = state['right' + phase] || state.right;

        // Right eye
        if (rightData.pupil && rightData.iris) {
            var rPupilDia = rightData.pupil.r * 2;
            var rIrisDia = rightData.iris.r * 2;
            var rRatio = rIrisDia > 0 ? rPupilDia / rIrisDia : 0;
            var rMm = rRatio * irisRef;
            $('dualRightRatio').textContent = rRatio.toFixed(3);
            $('dualRightMm').textContent = '~' + rMm.toFixed(1) + ' mm';
        }

        // Left eye
        if (leftData.pupil && leftData.iris) {
            var lPupilDia = leftData.pupil.r * 2;
            var lIrisDia = leftData.iris.r * 2;
            var lRatio = lIrisDia > 0 ? lPupilDia / lIrisDia : 0;
            var lMm = lRatio * irisRef;
            $('dualLeftRatio').textContent = lRatio.toFixed(3);
            $('dualLeftMm').textContent = '~' + lMm.toFixed(1) + ' mm';
        }
    }

    function retakePhotoDual() {
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';
        state['left' + phase] = EMPTY_EYE();
        state['right' + phase] = EMPTY_EYE();
        openCamera();
    }

    function confirmDual() {
        var irisRef = getIrisRefMm();
        var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';

        // Compute and store ratios for both eyes
        var keys = ['left', 'right'];
        for (var i = 0; i < keys.length; i++) {
            var eyeData = state[keys[i] + phase] || state[keys[i]];
            if (eyeData.pupil && eyeData.iris) {
                var pupilDia = eyeData.pupil.r * 2;
                var irisDia = eyeData.iris.r * 2;
                eyeData.ratio = irisDia > 0 ? pupilDia / irisDia : 0;
                eyeData.pupilMm = eyeData.ratio * irisRef;
            }
        }

        // Determine next step
        if (state.mode === 'reactivity' && state.reactivityPhase === 'dark') {
            // Move to light phase — show guidance screen
            state.reactivityPhase = 'light';
            showScreen('screenReactivityGuide');

            // Show/hide torch option based on support
            var torchOption = $('guideTorchOption');
            if (torchOption) {
                torchOption.style.display = state.torchSupported ? '' : 'none';
            }
        } else {
            showResults();
        }
    }

    function openCameraReactivityLight() {
        // From reactivity guide → open camera for light-phase capture
        openCamera();
        // Auto-enable torch if supported
        if (state.torchSupported) {
            // Small delay to let camera initialize
            setTimeout(function() { setTorch(true); }, 500);
        }
    }

    // ------------------------------------------------------------------
    // CANVAS TOUCH / POINTER INTERACTION
    // ------------------------------------------------------------------
    function setupCanvasInteraction() {
        var dragging = false;
        var dragTarget = null; // 'pupil-move', 'pupil-resize', 'iris-move', 'iris-resize'
        var lastPos = null;

        function getCanvasCoords(e) {
            var canvas = $('measureCanvas');
            var rect = canvas.getBoundingClientRect();
            var scaleX = canvas.width / rect.width;
            var scaleY = canvas.height / rect.height;
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }

        function hitTest(pos) {
            var eyeData = state[currentKey()];
            if (!eyeData.pupil || !eyeData.iris) return null;

            var pDist = Math.sqrt(
                Math.pow(pos.x - eyeData.pupil.x, 2) + Math.pow(pos.y - eyeData.pupil.y, 2)
            );
            var tolerance = Math.max(15, eyeData.pupil.r * 0.15);

            // Pupil edge -> resize
            if (Math.abs(pDist - eyeData.pupil.r) < tolerance) return 'pupil-resize';

            var iDist = Math.sqrt(
                Math.pow(pos.x - eyeData.iris.x, 2) + Math.pow(pos.y - eyeData.iris.y, 2)
            );
            var iTolerance = Math.max(15, eyeData.iris.r * 0.15);

            // Iris edge -> resize
            if (Math.abs(iDist - eyeData.iris.r) < iTolerance) return 'iris-resize';

            // Pupil interior -> move
            if (pDist < eyeData.pupil.r) return 'pupil-move';

            // Iris interior -> move
            if (iDist < eyeData.iris.r) return 'iris-move';

            return null;
        }

        function onStart(e) {
            var pos = getCanvasCoords(e);
            dragTarget = hitTest(pos);
            if (dragTarget) {
                dragging = true;
                lastPos = pos;

                // Auto-select the circle being interacted with
                if (dragTarget.indexOf('pupil') === 0) {
                    selectCircle('pupil');
                } else {
                    selectCircle('iris');
                }
                e.preventDefault();
            }
        }

        function onMove(e) {
            if (!dragging || !lastPos) return;
            var pos = getCanvasCoords(e);
            var dx = pos.x - lastPos.x;
            var dy = pos.y - lastPos.y;
            lastPos = pos;

            var eyeData = state[currentKey()];

            if (dragTarget === 'pupil-move') {
                eyeData.pupil.x = Math.round(eyeData.pupil.x + dx);
                eyeData.pupil.y = Math.round(eyeData.pupil.y + dy);
            } else if (dragTarget === 'iris-move') {
                eyeData.iris.x = Math.round(eyeData.iris.x + dx);
                eyeData.iris.y = Math.round(eyeData.iris.y + dy);
            } else if (dragTarget === 'pupil-resize') {
                var distP = Math.sqrt(
                    Math.pow(pos.x - eyeData.pupil.x, 2) + Math.pow(pos.y - eyeData.pupil.y, 2)
                );
                eyeData.pupil.r = Math.max(5, Math.round(distP));
            } else if (dragTarget === 'iris-resize') {
                var distI = Math.sqrt(
                    Math.pow(pos.x - eyeData.iris.x, 2) + Math.pow(pos.y - eyeData.iris.y, 2)
                );
                eyeData.iris.r = Math.max(10, Math.round(distI));
            }

            updateSliders();
            drawMeasurement();
            updateLiveStats();
            e.preventDefault();
        }

        function onEnd() {
            dragging = false;
            dragTarget = null;
            lastPos = null;
        }

        var container = $('measurementContainer');
        if (!container) return;
        container.addEventListener('mousedown', onStart);
        container.addEventListener('mousemove', onMove);
        container.addEventListener('mouseup', onEnd);
        container.addEventListener('mouseleave', onEnd);
        container.addEventListener('touchstart', onStart, { passive: false });
        container.addEventListener('touchmove', onMove, { passive: false });
        container.addEventListener('touchend', onEnd);
        container.addEventListener('touchcancel', onEnd);
    }

    function setupDualCanvasInteraction() {
        var panels = ['dualPanelRight', 'dualPanelLeft'];

        for (var p = 0; p < panels.length; p++) {
            (function(panelId, eyeKey) {
                var panel = $(panelId);
                if (!panel) return;

                var dragging = false;
                var lastPos = null;
                var dragTarget = null;

                function getCanvasCoords(e, canvas) {
                    var rect = canvas.getBoundingClientRect();
                    var scaleX = canvas.width / rect.width;
                    var scaleY = canvas.height / rect.height;
                    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
                }

                function toImageCoords(canvasPos, eyeData) {
                    if (!eyeData.iris) return canvasPos;
                    var pad = eyeData.iris.r * 1.8;
                    var sx = Math.max(0, Math.round(eyeData.iris.x - pad));
                    var sy = Math.max(0, Math.round(eyeData.iris.y - pad));
                    var sw = Math.min(Math.round(pad * 2), eyeData.imageWidth - sx);
                    var sh = Math.min(Math.round(pad * 2), eyeData.imageHeight - sy);
                    return {
                        x: sx + canvasPos.x / 300 * sw,
                        y: sy + canvasPos.y / 300 * sh
                    };
                }

                var canvas = panel.querySelector('canvas');
                if (!canvas) return;

                canvas.addEventListener('pointerdown', function(e) {
                    selectDualEye(eyeKey);
                    var pos = getCanvasCoords(e, canvas);
                    var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';
                    var eyeData = state[eyeKey + phase] || state[eyeKey];
                    var imgPos = toImageCoords(pos, eyeData);

                    if (eyeData.pupil) {
                        var pDist = Math.sqrt(Math.pow(imgPos.x - eyeData.pupil.x, 2) + Math.pow(imgPos.y - eyeData.pupil.y, 2));
                        if (Math.abs(pDist - eyeData.pupil.r) < Math.max(15, eyeData.pupil.r * 0.2)) {
                            dragTarget = 'pupil-resize'; selectCircleDual('pupil');
                        } else if (pDist < eyeData.pupil.r) {
                            dragTarget = 'pupil-move'; selectCircleDual('pupil');
                        }
                    }
                    if (!dragTarget && eyeData.iris) {
                        var iDist = Math.sqrt(Math.pow(imgPos.x - eyeData.iris.x, 2) + Math.pow(imgPos.y - eyeData.iris.y, 2));
                        if (Math.abs(iDist - eyeData.iris.r) < Math.max(15, eyeData.iris.r * 0.15)) {
                            dragTarget = 'iris-resize'; selectCircleDual('iris');
                        } else if (iDist < eyeData.iris.r) {
                            dragTarget = 'iris-move'; selectCircleDual('iris');
                        }
                    }

                    if (dragTarget) {
                        dragging = true;
                        lastPos = imgPos;
                        e.preventDefault();
                    }
                });

                canvas.addEventListener('pointermove', function(e) {
                    if (!dragging || !lastPos) return;
                    var pos = getCanvasCoords(e, canvas);
                    var phase = (state.mode === 'reactivity' && state.reactivityPhase === 'light') ? 'Light' : '';
                    var eyeData = state[eyeKey + phase] || state[eyeKey];
                    var imgPos = toImageCoords(pos, eyeData);
                    var dx = imgPos.x - lastPos.x;
                    var dy = imgPos.y - lastPos.y;
                    lastPos = imgPos;

                    if (dragTarget === 'pupil-move') {
                        eyeData.pupil.x = Math.round(eyeData.pupil.x + dx);
                        eyeData.pupil.y = Math.round(eyeData.pupil.y + dy);
                    } else if (dragTarget === 'iris-move') {
                        eyeData.iris.x = Math.round(eyeData.iris.x + dx);
                        eyeData.iris.y = Math.round(eyeData.iris.y + dy);
                    } else if (dragTarget === 'pupil-resize') {
                        var distP = Math.sqrt(Math.pow(imgPos.x - eyeData.pupil.x, 2) + Math.pow(imgPos.y - eyeData.pupil.y, 2));
                        eyeData.pupil.r = Math.max(5, Math.round(distP));
                    } else if (dragTarget === 'iris-resize') {
                        var distI = Math.sqrt(Math.pow(imgPos.x - eyeData.iris.x, 2) + Math.pow(imgPos.y - eyeData.iris.y, 2));
                        eyeData.iris.r = Math.max(10, Math.round(distI));
                    }

                    updateDualSliders();
                    drawDualCanvases();
                    updateDualStats();
                    e.preventDefault();
                });

                canvas.addEventListener('pointerup', function() { dragging = false; dragTarget = null; lastPos = null; });
                canvas.addEventListener('pointercancel', function() { dragging = false; dragTarget = null; lastPos = null; });
            })(panels[p], p === 0 ? 'right' : 'left');
        }
    }

    // ------------------------------------------------------------------
    // RETAKE & CONFIRM
    // ------------------------------------------------------------------
    function retakePhoto() {
        state[currentKey()] = EMPTY_EYE();
        openCamera();
    }

    function confirmMeasurement() {
        var key = currentKey();
        var eyeData = state[key];
        var pupilDiaPx = eyeData.pupil.r * 2;
        var irisDiaPx = eyeData.iris.r * 2;
        var irisRef = getIrisRefMm();
        eyeData.ratio = irisDiaPx > 0 ? pupilDiaPx / irisDiaPx : 0;
        eyeData.pupilMm = eyeData.ratio * irisRef;

        // Keep a copy of captured image data
        eyeData.image = state.capturedImage;
        eyeData.imageWidth = state.capturedWidth;
        eyeData.imageHeight = state.capturedHeight;

        // Determine next step
        if (state.mode === 'reactivity' && state.reactivityPhase === 'dark') {
            // Capture same eye with light
            state.reactivityPhase = 'light';
            openCamera();
        } else if (state.mode === 'reactivity' && state.reactivityPhase === 'light') {
            // Done with this eye's reactivity
            if (state.currentEye === 'left') {
                state.currentEye = 'right';
                state.reactivityPhase = 'dark';
                openCamera();
            } else {
                showResults();
            }
        } else {
            // Size-only mode
            if (state.currentEye === 'left') {
                state.currentEye = 'right';
                openCamera();
            } else {
                showResults();
            }
        }
    }

    // ------------------------------------------------------------------
    // RESULTS
    // ------------------------------------------------------------------
    function showResults() {
        showScreen('screenResults');

        var left = state.left;
        var right = state.right;
        var irisRef = getIrisRefMm();

        // Draw result thumbnails
        drawResultThumbnail('resultCanvasLeft', left);
        drawResultThumbnail('resultCanvasRight', right);

        // Primary metric: ratio
        $('resultLeftRatio').innerHTML =
            left.ratio.toFixed(3) + ' <span class="unit">P/I ratio</span>';
        $('resultRightRatio').innerHTML =
            right.ratio.toFixed(3) + ' <span class="unit">P/I ratio</span>';

        // Secondary: est mm
        $('resultLeftMm').textContent = '~' + left.pupilMm.toFixed(1) + ' mm (est.)';
        $('resultRightMm').textContent = '~' + right.pupilMm.toFixed(1) + ' mm (est.)';

        // Calculate differences
        var ratioDiff = Math.abs(left.ratio - right.ratio);
        var estMmDiff = Math.abs(left.pupilMm - right.pupilMm);
        var maxRatio = Math.max(left.ratio, right.ratio);
        var pctDiff = maxRatio > 0 ? (ratioDiff / maxRatio) * 100 : 0;

        $('diffValue').innerHTML =
            ratioDiff.toFixed(3) + ' <span style="font-size:18px;font-weight:400">ratio</span>' +
            '<br><span style="font-size:18px;color:var(--text-muted)">' +
            pctDiff.toFixed(0) + '% difference (~' + estMmDiff.toFixed(1) + ' mm est.)</span>';
        $('diffLabel').textContent = 'Pupil/Iris ratio difference';

        // Colour the diff value
        var diffEl = $('diffValue');
        if (estMmDiff < 1.0) diffEl.style.color = 'var(--success)';
        else if (estMmDiff < 2.0) diffEl.style.color = 'var(--warning)';
        else diffEl.style.color = 'var(--danger)';

        // Clinical assessment
        var diff = estMmDiff;
        var assessBox = $('assessmentBox');
        var assessTitle = $('assessmentTitle');
        var assessDetail = $('assessmentDetail');

        if (diff < 0.5) {
            assessBox.className = 'assessment-box normal';
            assessTitle.textContent = 'Pupils Equal';
            assessDetail.textContent =
                'No clinically significant anisocoria detected. Ratio difference of ' +
                ratioDiff.toFixed(3) + ' (~' + diff.toFixed(1) + ' mm) is within normal physiological variation.';
        } else if (diff < 1.0) {
            assessBox.className = 'assessment-box normal';
            assessTitle.textContent = 'Physiological Anisocoria';
            assessDetail.textContent =
                'Ratio difference of ' + ratioDiff.toFixed(3) + ' (~' + diff.toFixed(1) + ' mm). ' +
                'Up to ~1.0 mm asymmetry is considered physiological anisocoria, present in ~20% of the population. ' +
                'Correlate with clinical history and exam.';
        } else if (diff < 2.0) {
            assessBox.className = 'assessment-box mild';
            assessTitle.textContent = 'Anisocoria Detected';
            assessDetail.textContent =
                'Ratio difference of ' + ratioDiff.toFixed(3) + ' (~' + diff.toFixed(1) + ' mm) exceeds ' +
                'physiological range. Consider: Horner syndrome, pharmacological mydriasis, previous eye surgery, ' +
                'third nerve palsy, or other neurological causes. Assess reactivity and urgency.';
        } else {
            assessBox.className = 'assessment-box significant';
            assessTitle.textContent = 'Significant Anisocoria';
            assessDetail.textContent =
                'Ratio difference of ' + ratioDiff.toFixed(3) + ' (~' + diff.toFixed(1) + ' mm) is clinically significant. ' +
                'URGENT: Rule out third nerve palsy, uncal herniation, or acute intracranial pathology. ' +
                'Check pupil reactivity. Consider emergent neuroimaging if new onset.';
        }

        // Clinical notes
        var isEqual = Math.abs(left.ratio - right.ratio) < 0.001;
        var larger = isEqual ? 'Equal' : (left.ratio > right.ratio ? 'Left (OS)' : 'Right (OD)');
        var smaller = isEqual ? 'Equal' : (left.ratio > right.ratio ? 'Right (OD)' : 'Left (OS)');
        var notes = [];

        notes.push('Larger pupil: <strong>' + larger + '</strong> (ratio ' +
            Math.max(left.ratio, right.ratio).toFixed(3) + ', ~' +
            Math.max(left.pupilMm, right.pupilMm).toFixed(1) + ' mm)');
        notes.push('Smaller pupil: <strong>' + smaller + '</strong> (ratio ' +
            Math.min(left.ratio, right.ratio).toFixed(3) + ', ~' +
            Math.min(left.pupilMm, right.pupilMm).toFixed(1) + ' mm)');
        notes.push('Relative difference: <strong>' + pctDiff.toFixed(1) + '%</strong> (the larger pupil is ' + pctDiff.toFixed(0) + '% bigger)');
        notes.push('Normal pupil size: 2-4 mm (bright light) to 4-8 mm (dark)');
        notes.push('Physiological anisocoria (up to ~1.0 mm) is present in ~20% of population');

        if (diff >= 1.0) {
            notes.push('<strong>Anisocoria workup:</strong> Check direct and consensual light reflexes');
            notes.push('Determine if the abnormal pupil is the larger or smaller one');
            notes.push('New-onset unilateral mydriasis + ptosis: rule out CN III palsy');
            notes.push('Unilateral miosis + ptosis: consider Horner syndrome');
        }
        if (Math.max(left.pupilMm, right.pupilMm) > 7) {
            notes.push('<strong>Note:</strong> Large pupil detected. Consider pharmacological cause, trauma, or CN III palsy');
        }
        if (Math.min(left.pupilMm, right.pupilMm) < 2) {
            notes.push('<strong>Note:</strong> Very small pupil detected. Consider opioid use, Horner syndrome, or pharmacological miosis');
        }

        // ------------------------------------------------------------------
        // Reactivity results (only in reactivity mode)
        // ------------------------------------------------------------------
        var reactivitySection = $('reactivitySection');
        var reactivityResult = null; // store for save/report

        if (state.mode === 'reactivity') {
            var ll = state.leftLight;
            var rl = state.rightLight;

            if (ll.ratio !== null && rl.ratio !== null) {
                reactivitySection.style.display = '';

                // Constriction = (darkRatio - lightRatio) / darkRatio * 100
                var leftConstriction = left.ratio - ll.ratio;
                var rightConstriction = right.ratio - rl.ratio;
                var leftConstrMm = leftConstriction * irisRef;
                var rightConstrMm = rightConstriction * irisRef;
                var leftPct = left.ratio > 0 ? (leftConstriction / left.ratio) * 100 : 0;
                var rightPct = right.ratio > 0 ? (rightConstriction / right.ratio) * 100 : 0;

                function reactivityLabel(constrPct) {
                    if (constrPct > 15) return { text: 'Brisk', color: 'var(--success)' };
                    if (constrPct > 5) return { text: 'Sluggish', color: 'var(--warning)' };
                    if (constrPct > 0) return { text: 'Minimal', color: 'var(--warning)' };
                    if (constrPct < -5) return { text: 'Paradoxical dilation', color: 'var(--danger)' };
                    return { text: 'Fixed', color: 'var(--danger)' };
                }

                var leftLbl = reactivityLabel(leftPct);
                var rightLbl = reactivityLabel(rightPct);

                var html = '';

                // Left eye
                html += '<div class="reactivity-eye-header"><strong style="color:var(--primary-light)">Left Eye (OS)</strong></div>';
                html += '<div class="reactivity-row"><span class="label">Dark ratio</span><span class="value">' + left.ratio.toFixed(3) + ' (~' + left.pupilMm.toFixed(1) + ' mm)</span></div>';
                html += '<div class="reactivity-row"><span class="label">Light ratio</span><span class="value">' + ll.ratio.toFixed(3) + ' (~' + ll.pupilMm.toFixed(1) + ' mm)</span></div>';
                html += '<div class="reactivity-row"><span class="label">Constriction</span><span class="value">' + leftPct.toFixed(0) + '% (~' + Math.abs(leftConstrMm).toFixed(1) + ' mm)</span></div>';
                html += '<div class="reactivity-row"><span class="label">Reactivity</span><span class="value" style="color:' + leftLbl.color + '">' + leftLbl.text + '</span></div>';

                // Right eye
                html += '<div class="reactivity-eye-header" style="margin-top:12px"><strong style="color:var(--primary-light)">Right Eye (OD)</strong></div>';
                html += '<div class="reactivity-row"><span class="label">Dark ratio</span><span class="value">' + right.ratio.toFixed(3) + ' (~' + right.pupilMm.toFixed(1) + ' mm)</span></div>';
                html += '<div class="reactivity-row"><span class="label">Light ratio</span><span class="value">' + rl.ratio.toFixed(3) + ' (~' + rl.pupilMm.toFixed(1) + ' mm)</span></div>';
                html += '<div class="reactivity-row"><span class="label">Constriction</span><span class="value">' + rightPct.toFixed(0) + '% (~' + Math.abs(rightConstrMm).toFixed(1) + ' mm)</span></div>';
                html += '<div class="reactivity-row"><span class="label">Reactivity</span><span class="value" style="color:' + rightLbl.color + '">' + rightLbl.text + '</span></div>';

                // RAPD screening
                var constrDiff = Math.abs(leftPct - rightPct);
                var rapdFlag = constrDiff > 10;

                if (rapdFlag) {
                    var lessReactive = leftPct < rightPct ? 'Left (OS)' : 'Right (OD)';
                    html += '<div class="rapd-alert">';
                    html += '<strong>Asymmetric Reactivity</strong><br>';
                    html += lessReactive + ' shows less constriction (' + constrDiff.toFixed(0) + '% difference). ';
                    html += 'Consider swinging flashlight test to evaluate for relative afferent pupillary defect (RAPD).';
                    html += '</div>';
                }

                $('reactivityData').innerHTML = html;

                // Add reactivity clinical notes
                notes.push('<strong>Reactivity test results:</strong>');
                notes.push('Left eye constriction: ' + leftPct.toFixed(0) + '% -- <strong style="color:' + leftLbl.color + '">' + leftLbl.text + '</strong>');
                notes.push('Right eye constriction: ' + rightPct.toFixed(0) + '% -- <strong style="color:' + rightLbl.color + '">' + rightLbl.text + '</strong>');

                if (leftLbl.text === 'Fixed / Non-reactive' || rightLbl.text === 'Fixed / Non-reactive') {
                    notes.push('<strong style="color:var(--danger)">ALERT:</strong> Fixed pupil detected. Consider CN III palsy, pharmacological mydriasis, or brainstem pathology.');
                }
                if (rapdFlag) {
                    var lessReact2 = leftPct < rightPct ? 'Left (OS)' : 'Right (OD)';
                    notes.push('<strong style="color:var(--warning)">RAPD screening:</strong> ' + lessReact2 + ' less reactive by ' + constrDiff.toFixed(0) + '%. Perform swinging flashlight test.');
                }

                // Store for save/report
                reactivityResult = {
                    leftPct: leftPct,
                    rightPct: rightPct,
                    leftLabel: leftLbl.text,
                    rightLabel: rightLbl.text,
                    rapdFlag: rapdFlag
                };
            } else {
                reactivitySection.style.display = 'none';
            }
        } else {
            reactivitySection.style.display = 'none';
        }

        // Focus distance consistency check
        if (left.focusDistance !== null && right.focusDistance !== null) {
            var leftCm = (left.focusDistance * 100).toFixed(1);
            var rightCm = (right.focusDistance * 100).toFixed(1);
            notes.push('Camera focus distance -- Left: ' + leftCm + ' cm, Right: ' + rightCm + ' cm');

            var distDiff = Math.abs(left.focusDistance - right.focusDistance);
            var avgDist = (left.focusDistance + right.focusDistance) / 2;
            if (avgDist > 0 && (distDiff / avgDist) > 0.20) {
                notes.push('<strong style="color:var(--warning)">Warning:</strong> Camera distance differed significantly between captures (' +
                    leftCm + ' vs ' + rightCm + ' cm). This does not affect the ratio-based comparison, but consider retaking for consistency.');
            } else {
                notes.push('Camera distances were consistent between captures (good)');
            }
        } else if (left.focusDistance !== null || right.focusDistance !== null) {
            var avail = left.focusDistance !== null ? 'Left' : 'Right';
            var fd = (left.focusDistance || right.focusDistance) * 100;
            notes.push('Camera focus distance (' + avail + ' only): ' + fd.toFixed(1) + ' cm');
        }

        $('clinicalNotes').innerHTML = notes.map(function (n) {
            return '<li>' + n + '</li>';
        }).join('');

        // Store transient data for save/report
        state._lastAssessment = {
            class: App.assessmentClass(diff),
            title: assessTitle.textContent,
            detail: assessDetail.textContent,
            ratioDiff: ratioDiff,
            diffMm: estMmDiff,
            pctDiff: pctDiff
        };
        state._lastReactivity = reactivityResult;
    }

    function drawResultThumbnail(canvasId, eyeData) {
        var canvas = $(canvasId);
        var ctx = canvas.getContext('2d');

        if (!eyeData.image) {
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#999';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('No image', canvas.width / 2, canvas.height / 2);
            return;
        }

        // Crop around iris for thumbnail
        var srcW = eyeData.imageWidth;
        var srcH = eyeData.imageHeight;
        var iris = eyeData.iris;
        var pad = iris.r * 1.3;

        var sx = Math.max(0, iris.x - pad);
        var sy = Math.max(0, iris.y - pad);
        var sw = Math.min(pad * 2, srcW - sx);
        var sh = Math.min(pad * 2, srcH - sy);

        // Draw source to temp canvas
        var temp = document.createElement('canvas');
        temp.width = srcW;
        temp.height = srcH;
        temp.getContext('2d').putImageData(eyeData.image, 0, 0);

        // Scale to fit
        canvas.width = 200;
        canvas.height = 200;
        ctx.drawImage(temp, sx, sy, sw, sh, 0, 0, 200, 200);

        // Draw circles on thumbnail
        var scaleX = 200 / sw;
        var scaleY = 200 / sh;
        var iOffX = (iris.x - sx) * scaleX;
        var iOffY = (iris.y - sy) * scaleY;
        var pOffX = (eyeData.pupil.x - sx) * scaleX;
        var pOffY = (eyeData.pupil.y - sy) * scaleY;

        // Iris
        ctx.beginPath();
        ctx.arc(iOffX, iOffY, iris.r * scaleX, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 165, 2, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Pupil
        ctx.beginPath();
        ctx.arc(pOffX, pOffY, eyeData.pupil.r * scaleX, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pOffX, pOffY, eyeData.pupil.r * scaleX, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(233, 69, 96, 0.15)';
        ctx.fill();
    }

    // ------------------------------------------------------------------
    // SAVE TO PATIENT
    // ------------------------------------------------------------------
    function saveToPatient() {
        var modal = $('saveModal');
        if (!modal) return;

        // Populate patient list
        var patients = patientStore.getAll();
        var listEl = $('savePatientList');
        listEl.innerHTML = '';

        patients.forEach(function (p) {
            var item = document.createElement('div');
            item.className = 'save-patient-item';
            item.tabIndex = 0;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-label', 'Save to ' + p.label);
            item.innerHTML =
                '<span class="patient-label">' + escapeHtml(p.label) + '</span>' +
                '<span class="patient-count">' + p.measurements.length + ' measurements</span>';
            item.addEventListener('click', function () {
                doSaveToPatient(p.id);
            });
            item.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    doSaveToPatient(p.id);
                }
            });
            listEl.appendChild(item);
        });

        // Clear new patient input
        $('saveNewPatientName').value = '';

        modal.classList.add('active');
    }

    function saveToNewPatient() {
        var nameInput = $('saveNewPatientName');
        var name = (nameInput.value || '').trim();
        if (!name) {
            App.showToast('Please enter a patient name or identifier.', 'warning');
            nameInput.focus();
            return;
        }
        var patient = patientStore.createPatient(name);
        doSaveToPatient(patient.id);
    }

    function doSaveToPatient(patientId) {
        var left = state.left;
        var right = state.right;

        // Generate thumbnail data URLs
        var thumbnails = {
            left: canvasToDataURL('resultCanvasLeft'),
            right: canvasToDataURL('resultCanvasRight')
        };

        var measurementData = {
            mode: state.mode,
            left: {
                ratio: left.ratio,
                pupilMm: left.pupilMm,
                focusDistance: left.focusDistance,
                detectionMethod: left.detectionMethod
            },
            right: {
                ratio: right.ratio,
                pupilMm: right.pupilMm,
                focusDistance: right.focusDistance,
                detectionMethod: right.detectionMethod
            },
            assessment: state._lastAssessment || null,
            reactivity: state._lastReactivity || null,
            thumbnails: thumbnails,
            detectionMethod: left.detectionMethod || right.detectionMethod || 'classical'
        };

        // Include light-phase data for reactivity
        if (state.mode === 'reactivity') {
            var ll = state.leftLight;
            var rl = state.rightLight;
            if (ll.ratio !== null) {
                measurementData.leftLight = {
                    ratio: ll.ratio,
                    pupilMm: ll.pupilMm,
                    focusDistance: ll.focusDistance
                };
            }
            if (rl.ratio !== null) {
                measurementData.rightLight = {
                    ratio: rl.ratio,
                    pupilMm: rl.pupilMm,
                    focusDistance: rl.focusDistance
                };
            }
        }

        var result = patientStore.addMeasurement(patientId, measurementData);
        closeSaveModal();

        if (result) {
            App.showToast('Measurement saved successfully.', 'success');
        } else {
            App.showToast('Failed to save measurement.', 'error');
        }
    }

    function closeSaveModal() {
        var modal = $('saveModal');
        if (modal) modal.classList.remove('active');
    }

    function canvasToDataURL(canvasId) {
        try {
            var c = $(canvasId);
            return c ? c.toDataURL('image/jpeg', 0.8) : null;
        } catch (_e) {
            return null;
        }
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ------------------------------------------------------------------
    // GENERATE REPORT
    // ------------------------------------------------------------------
    function generateReport() {
        var left = state.left;
        var right = state.right;

        var measurement = {
            timestamp: new Date().toISOString(),
            mode: state.mode,
            left: { ratio: left.ratio, pupilMm: left.pupilMm },
            right: { ratio: right.ratio, pupilMm: right.pupilMm },
            assessment: state._lastAssessment || null,
            reactivity: state._lastReactivity || null,
            detectionMethod: left.detectionMethod || right.detectionMethod || 'classical',
            thumbnails: {
                left: canvasToDataURL('resultCanvasLeft'),
                right: canvasToDataURL('resultCanvasRight')
            }
        };

        // Include light-phase data for reactivity report
        if (state.mode === 'reactivity') {
            var ll = state.leftLight;
            var rl = state.rightLight;
            if (ll.ratio !== null) {
                measurement.leftLight = { ratio: ll.ratio, pupilMm: ll.pupilMm };
            }
            if (rl.ratio !== null) {
                measurement.rightLight = { ratio: rl.ratio, pupilMm: rl.pupilMm };
            }
        }

        ReportGenerator.generate(measurement, 'Unassigned');
    }

    // ------------------------------------------------------------------
    // INITIALIZATION
    // ------------------------------------------------------------------
    function init() {
        // Restore mode
        state.mode = localStorage.getItem('pupilcheck_mode') || 'size';
        updateModeUI();

        // Setup canvas touch/pointer interaction
        setupCanvasInteraction();
        setupDualCanvasInteraction();

        // Restore capture mode
        state.captureMode = localStorage.getItem('pupilcheck_captureMode') || 'both';
        updateCaptureModeUI();

        // Init i18n (async, non-blocking)
        if (typeof i18n !== 'undefined') {
            i18n.init();
        }

        // Init ML detection (async, non-blocking)
        if (typeof App !== 'undefined' && App.initML) {
            App.initML();
        }

        // Camera support check
        if (!App.hasCameraSupport()) {
            var welcomeScreen = $('screenWelcome');
            if (welcomeScreen) {
                var warning = document.createElement('div');
                warning.className = 'tip-box';
                warning.innerHTML = '<strong>Warning:</strong> Camera access is not supported in this browser. ' +
                    'Please use a modern mobile browser (Chrome, Safari, Firefox) with HTTPS.';
                var firstBtn = welcomeScreen.querySelector('.btn');
                if (firstBtn) {
                    welcomeScreen.insertBefore(warning, firstBtn);
                }
            }
        }

        // Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(function () {});
        }

        // Stop camera on page navigation / tab switch
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stopCamera();
        });
        window.addEventListener('pagehide', function () {
            stopCamera();
        });
    }

    // Boot
    document.addEventListener('DOMContentLoaded', function () {
        init();
    });

    // ------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------
    return {
        init: init,
        setMode: setMode,
        setCaptureMode: setCaptureMode,
        startMeasurement: startMeasurement,
        goBack: goBack,
        startOver: startOver,
        remeasureEye: remeasureEye,
        openCamera: openCamera,
        switchCamera: switchCamera,
        captureImage: captureImage,
        toggleTorch: toggleTorch,
        onZoomChange: onZoomChange,
        setZoom: setZoom,
        selectCircle: selectCircle,
        onSliderChange: onSliderChange,
        retakePhoto: retakePhoto,
        confirmMeasurement: confirmMeasurement,
        selectDualEye: selectDualEye,
        selectCircleDual: selectCircleDual,
        onDualSliderChange: onDualSliderChange,
        retakePhotoDual: retakePhotoDual,
        confirmDual: confirmDual,
        openCameraReactivityLight: openCameraReactivityLight,
        saveToPatient: saveToPatient,
        saveToNewPatient: saveToNewPatient,
        closeSaveModal: closeSaveModal,
        generateReport: generateReport
    };
})();
