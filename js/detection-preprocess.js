// PupilCheck - Image Preprocessing for Robust Pupil Detection
// CLAHE, red channel extraction, adaptive gamma correction
// Research-backed: CLAHE + red channel improves pupil-iris contrast dramatically
// (melanin absorbs blue/green but reflects red, making iris brighter in red channel)

const ImagePreprocess = (() => {
    'use strict';

    // Extract red channel — best pupil-iris contrast in visible light
    function extractRedChannel(imageData) {
        const d = imageData.data;
        const len = d.length / 4;
        const gray = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            gray[i] = d[i * 4]; // Red channel only
        }
        return gray;
    }

    // Standard luminance grayscale
    function toGrayscale(imageData) {
        const d = imageData.data;
        const len = d.length / 4;
        const gray = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const idx = i * 4;
            gray[i] = Math.round(0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]);
        }
        return gray;
    }

    // Compute mean of a Uint8Array
    function meanValue(arr) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        return sum / arr.length;
    }

    // CLAHE (Contrast Limited Adaptive Histogram Equalization)
    // Dramatically improves local contrast in dim/uneven lighting
    function clahe(gray, w, h, tileSizeParam, clipLimit) {
        if (typeof tileSizeParam === 'undefined') tileSizeParam = 8;
        if (typeof clipLimit === 'undefined') clipLimit = 3.0;

        // Use larger tiles relative to image size for efficiency
        var tileW = Math.max(tileSizeParam, Math.floor(w / 8));
        var tileH = Math.max(tileSizeParam, Math.floor(h / 8));
        var tilesX = Math.ceil(w / tileW);
        var tilesY = Math.ceil(h / tileH);

        // Build per-tile CDFs
        var tileCDFs = [];
        for (var ty = 0; ty < tilesY; ty++) {
            tileCDFs[ty] = [];
            for (var tx = 0; tx < tilesX; tx++) {
                var x0 = tx * tileW, y0 = ty * tileH;
                var x1 = Math.min(x0 + tileW, w);
                var y1 = Math.min(y0 + tileH, h);
                var tilePixels = (x1 - x0) * (y1 - y0);

                // Build histogram
                var hist = new Uint32Array(256);
                for (var y = y0; y < y1; y++) {
                    for (var x = x0; x < x1; x++) {
                        hist[gray[y * w + x]]++;
                    }
                }

                // Clip histogram
                var limit = Math.max(1, Math.round(clipLimit * tilePixels / 256));
                var excess = 0;
                for (var i = 0; i < 256; i++) {
                    if (hist[i] > limit) {
                        excess += hist[i] - limit;
                        hist[i] = limit;
                    }
                }
                var perBin = Math.floor(excess / 256);
                for (var i = 0; i < 256; i++) hist[i] += perBin;

                // Build CDF
                var cdf = new Float32Array(256);
                cdf[0] = hist[0];
                for (var i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];

                // Normalize CDF to [0, 255]
                var cdfMin = 0;
                for (var i = 0; i < 256; i++) {
                    if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
                }
                var denom = Math.max(1, tilePixels - cdfMin);
                for (var i = 0; i < 256; i++) {
                    cdf[i] = Math.round(Math.max(0, cdf[i] - cdfMin) / denom * 255);
                }

                tileCDFs[ty][tx] = cdf;
            }
        }

        // Bilinear interpolation between tile CDFs for smooth output
        var result = new Uint8Array(w * h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                // Find which tile center this pixel is near
                var txf = (x + 0.5) / tileW - 0.5;
                var tyf = (y + 0.5) / tileH - 0.5;
                var tx0 = Math.max(0, Math.floor(txf));
                var ty0 = Math.max(0, Math.floor(tyf));
                var tx1 = Math.min(tilesX - 1, tx0 + 1);
                var ty1 = Math.min(tilesY - 1, ty0 + 1);

                var fx = txf - tx0;
                var fy = tyf - ty0;
                fx = Math.max(0, Math.min(1, fx));
                fy = Math.max(0, Math.min(1, fy));

                var val = gray[y * w + x];

                // Bilinear interpolation of the four nearest tile CDFs
                var v00 = tileCDFs[ty0][tx0][val];
                var v10 = tileCDFs[ty0][tx1][val];
                var v01 = tileCDFs[ty1][tx0][val];
                var v11 = tileCDFs[ty1][tx1][val];

                var top = v00 * (1 - fx) + v10 * fx;
                var bot = v01 * (1 - fx) + v11 * fx;
                result[y * w + x] = Math.round(top * (1 - fy) + bot * fy);
            }
        }

        return result;
    }

    // Adaptive gamma correction based on image brightness
    function adaptiveGamma(gray, w, h) {
        var mean = meanValue(gray);

        var gamma;
        if (mean < 60) gamma = 0.4;         // Very dark: strong brightening
        else if (mean < 100) gamma = 0.6;    // Dim: moderate brightening
        else if (mean < 150) gamma = 0.8;    // Normal: mild brightening
        else gamma = 1.0;                     // Bright: no correction needed

        if (gamma >= 1.0) return gray; // No-op

        var lut = new Uint8Array(256);
        for (var i = 0; i < 256; i++) {
            lut[i] = Math.round(255 * Math.pow(i / 255, gamma));
        }

        var result = new Uint8Array(gray.length);
        for (var i = 0; i < gray.length; i++) {
            result[i] = lut[gray[i]];
        }
        return result;
    }

    // Full preprocessing pipeline: ImageData → enhanced grayscale Uint8Array
    // Returns { data: Uint8Array, width, height }
    function enhance(imageData) {
        var w = imageData.width, h = imageData.height;

        // 1. Extract red channel (best contrast for pupil-iris boundary)
        var gray = extractRedChannel(imageData);

        // 2. CLAHE for local contrast enhancement
        gray = clahe(gray, w, h);

        // 3. Adaptive gamma correction for dark images
        gray = adaptiveGamma(gray, w, h);

        return { data: gray, width: w, height: h };
    }

    // Convert enhanced grayscale back to ImageData (for ML model input or display)
    function enhanceToImageData(imageData) {
        var enhanced = enhance(imageData);
        var out = new ImageData(enhanced.width, enhanced.height);
        var d = out.data;
        var g = enhanced.data;
        for (var i = 0; i < g.length; i++) {
            var v = g[i];
            d[i * 4] = v;
            d[i * 4 + 1] = v;
            d[i * 4 + 2] = v;
            d[i * 4 + 3] = 255;
        }
        return out;
    }

    return {
        enhance: enhance,
        enhanceToImageData: enhanceToImageData,
        extractRedChannel: extractRedChannel,
        toGrayscale: toGrayscale,
        clahe: clahe,
        adaptiveGamma: adaptiveGamma,
        meanValue: meanValue
    };
})();
