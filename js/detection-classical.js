// PupilCheck - Classical Computer Vision Detection
// Fallback pupil/iris detection using enhanced preprocessing + thresholding + flood fill + circle fitting
// No ML dependencies - runs entirely on CPU with canvas ImageData
// Uses ImagePreprocess (CLAHE + red channel + gamma) for robust ambient-light detection

const ClassicalDetection = (() => {

    function gaussianBlur(gray, w, h, radius) {
        const sigma = radius / 2;
        const kernelSize = radius * 2 + 1;
        const kernel = new Float32Array(kernelSize);
        let sum = 0;
        for (let i = 0; i < kernelSize; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }
        for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

        const temp = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sx = Math.min(Math.max(x + k - radius, 0), w - 1);
                    val += gray[y * w + sx] * kernel[k];
                }
                temp[y * w + x] = val;
            }
        }

        const result = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let val = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sy = Math.min(Math.max(y + k - radius, 0), h - 1);
                    val += temp[sy * w + x] * kernel[k];
                }
                result[y * w + x] = Math.round(val);
            }
        }
        return result;
    }

    function downsample(gray, w, h, factor) {
        const nw = Math.floor(w / factor);
        const nh = Math.floor(h / factor);
        const out = new Uint8Array(nw * nh);
        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
                let sum = 0;
                for (let dy = 0; dy < factor; dy++) {
                    for (let dx = 0; dx < factor; dx++) {
                        sum += gray[(y * factor + dy) * w + (x * factor + dx)];
                    }
                }
                out[y * nw + x] = Math.round(sum / (factor * factor));
            }
        }
        return { data: out, width: nw, height: nh };
    }

    function detectPupil(gray, w, h) {
        const blurred = gaussianBlur(gray, w, h, 5);

        const winSize = Math.max(20, Math.round(Math.min(w, h) * 0.06));
        let minAvg = 255;
        let bestX = w / 2, bestY = h / 2;

        const margin = 0.15;
        const x0 = Math.floor(w * margin);
        const x1 = Math.floor(w * (1 - margin));
        const y0 = Math.floor(h * margin);
        const y1 = Math.floor(h * (1 - margin));
        const step = Math.max(2, Math.floor(winSize / 4));

        for (let y = y0; y < y1 - winSize; y += step) {
            for (let x = x0; x < x1 - winSize; x += step) {
                let sum = 0;
                for (let dy = 0; dy < winSize; dy += 2) {
                    for (let dx = 0; dx < winSize; dx += 2) {
                        sum += blurred[(y + dy) * w + (x + dx)];
                    }
                }
                const count = Math.ceil(winSize / 2) * Math.ceil(winSize / 2);
                const avg = sum / count;
                if (avg < minAvg) {
                    minAvg = avg;
                    bestX = x + winSize / 2;
                    bestY = y + winSize / 2;
                }
            }
        }

        const sampleR = winSize;
        let darkSum = 0, darkCount = 0;
        let surroundSum = 0, surroundCount = 0;

        for (let dy = -sampleR * 2; dy <= sampleR * 2; dy++) {
            for (let dx = -sampleR * 2; dx <= sampleR * 2; dx++) {
                const px = Math.round(bestX + dx);
                const py = Math.round(bestY + dy);
                if (px < 0 || px >= w || py < 0 || py >= h) continue;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const val = blurred[py * w + px];
                if (dist <= sampleR) { darkSum += val; darkCount++; }
                else if (dist <= sampleR * 2) { surroundSum += val; surroundCount++; }
            }
        }

        const darkAvg = darkCount > 0 ? darkSum / darkCount : 0;
        const surroundAvg = surroundCount > 0 ? surroundSum / surroundCount : 128;

        // Adaptive threshold factor based on contrast ratio
        const contrastRatio = surroundAvg > 0 ? (surroundAvg - darkAvg) / surroundAvg : 0;
        let thresholdFactor;
        if (contrastRatio < 0.15) {
            // Very low contrast (dim image even after preprocessing): tight threshold
            thresholdFactor = 0.20;
        } else if (contrastRatio < 0.30) {
            // Low contrast: moderate threshold
            thresholdFactor = 0.30;
        } else {
            // Good contrast: standard threshold
            thresholdFactor = 0.35;
        }
        const threshold = darkAvg + (surroundAvg - darkAvg) * thresholdFactor;

        const visited = new Uint8Array(w * h);
        const queue = [Math.round(bestX) + Math.round(bestY) * w];
        visited[queue[0]] = 1;
        const pixels = [];

        while (queue.length > 0) {
            const idx = queue.pop();
            const px = idx % w;
            const py = Math.floor(idx / w);
            if (blurred[idx] > threshold) continue;
            pixels.push({ x: px, y: py });
            const neighbors = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (visited[nIdx]) continue;
                visited[nIdx] = 1;
                if (blurred[nIdx] <= threshold) queue.push(nIdx);
            }
            if (pixels.length > w * h * 0.15) break;
        }

        if (pixels.length < 20) {
            return { x: Math.round(bestX), y: Math.round(bestY), r: Math.round(Math.min(w, h) * 0.06) };
        }
        return fitCircleToPixels(pixels);
    }

    function fitCircleToPixels(pixels) {
        let cx = 0, cy = 0;
        for (const p of pixels) { cx += p.x; cy += p.y; }
        cx /= pixels.length;
        cy /= pixels.length;

        let totalDist = 0;
        for (const p of pixels) {
            totalDist += Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
        }
        const avgDist = totalDist / pixels.length;
        const radius = avgDist * 1.5;

        return { x: Math.round(cx), y: Math.round(cy), r: Math.round(Math.max(radius, 5)) };
    }

    function detectIris(gray, w, h, pupil) {
        const blurred = gaussianBlur(gray, w, h, 3);
        const cx = pupil.x, cy = pupil.y;
        const startR = pupil.r + 5;
        const maxR = Math.min(cx, cy, w - cx, h - cy, Math.round(Math.min(w, h) * 0.45));

        const numAngles = 72;
        const radiusCandidates = [];

        for (let ai = 0; ai < numAngles; ai++) {
            const angle = (ai / numAngles) * 2 * Math.PI;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            let maxGrad = 0, bestR = 0, prevVal = 0;

            for (let r = startR; r < maxR; r += 1) {
                const sx = Math.round(cx + r * cosA);
                const sy = Math.round(cy + r * sinA);
                if (sx < 0 || sx >= w || sy < 0 || sy >= h) break;
                const val = blurred[sy * w + sx];
                const grad = val - prevVal;
                prevVal = val;
                if (r > startR + 5 && grad > maxGrad) { maxGrad = grad; bestR = r; }
            }
            if (bestR > startR && maxGrad > 3) radiusCandidates.push(bestR);
        }

        if (radiusCandidates.length < 10) {
            return { x: cx, y: cy, r: Math.round(pupil.r * 3.0) };
        }

        radiusCandidates.sort((a, b) => a - b);
        const medianR = radiusCandidates[Math.floor(radiusCandidates.length / 2)];
        const filtered = radiusCandidates.filter(r => r > medianR * 0.75 && r < medianR * 1.25);
        const finalR = filtered.length > 0
            ? filtered.reduce((a, b) => a + b, 0) / filtered.length
            : medianR;

        return { x: cx, y: cy, r: Math.round(Math.max(finalR, pupil.r + 10)) };
    }

    // Crop a sub-region from ImageData
    function cropImageData(imageData, sx, sy, sw, sh) {
        var src = imageData.data;
        var w = imageData.width;
        var out = new ImageData(sw, sh);
        var dst = out.data;
        for (var y = 0; y < sh; y++) {
            for (var x = 0; x < sw; x++) {
                var si = ((sy + y) * w + (sx + x)) * 4;
                var di = (y * sw + x) * 4;
                dst[di] = src[si];
                dst[di + 1] = src[si + 1];
                dst[di + 2] = src[si + 2];
                dst[di + 3] = src[si + 3];
            }
        }
        return out;
    }

    // Main single-eye detection entry point (now with preprocessing)
    function detect(imageData, width, height) {
        // Use preprocessing if available, else fall back to raw grayscale
        var gray;
        if (typeof ImagePreprocess !== 'undefined') {
            var enhanced = ImagePreprocess.enhance(imageData);
            gray = enhanced.data;
        } else {
            var d = imageData.data;
            gray = new Uint8Array(d.length / 4);
            for (var i = 0; i < gray.length; i++) {
                var idx = i * 4;
                gray[i] = Math.round(0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2]);
            }
        }

        const scale = width > 640 ? Math.floor(width / 640) : 1;
        let workGray, workW, workH;
        if (scale > 1) {
            const ds = downsample(gray, width, height, scale);
            workGray = ds.data; workW = ds.width; workH = ds.height;
        } else {
            workGray = gray; workW = width; workH = height;
        }

        let pupil = detectPupil(workGray, workW, workH);
        pupil.x = Math.round(pupil.x * scale);
        pupil.y = Math.round(pupil.y * scale);
        pupil.r = Math.round(pupil.r * scale);

        let iris = detectIris(gray, width, height, pupil);

        // Sanity checks
        if (pupil.r >= iris.r * 0.95) pupil.r = Math.round(iris.r * 0.4);
        if (iris.r > Math.min(width, height) * 0.45) iris.r = Math.round(Math.min(width, height) * 0.35);
        if (pupil.r < 5) pupil.r = Math.round(Math.min(width, height) * 0.04);

        return {
            pupil,
            iris,
            confidence: { pupil: 0.5, iris: 0.4 },
            method: 'classical'
        };
    }

    // Dual-eye detection: split landscape image and detect each half
    function detectBoth(imageData, width, height) {
        var midX = Math.round(width / 2);

        // Left half of image = patient's right eye (OD)
        var rightHalf = cropImageData(imageData, 0, 0, midX, height);
        var rightResult = detect(rightHalf, midX, height);
        // Coordinates already relative to left edge (0,0)

        // Right half = patient's left eye (OS)
        var leftHalf = cropImageData(imageData, midX, 0, width - midX, height);
        var leftResult = detect(leftHalf, width - midX, height);
        // Offset x coordinates back to full image space
        leftResult.pupil.x += midX;
        leftResult.iris.x += midX;

        return { left: leftResult, right: rightResult };
    }

    return {
        detect: detect,
        detectBoth: detectBoth,
        cropImageData: cropImageData
    };
})();
