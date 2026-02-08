# PupilCheck v2.1

**Clinical Pupil Assessment Tool** - A progressive web app for measuring pupil size, detecting anisocoria, and screening for relative afferent pupillary defect (RAPD).

**Live Demo**: [bosonian.github.io/Project](https://bosonian.github.io/Project)

## Features

### Pupil Measurement
- **Dual-eye capture**: Single landscape photo captures both eyes simultaneously
- **Single-eye mode**: Sequential close-up photos for detailed measurement
- **AI-powered detection**: MediaPipe face landmarks + TFLite pupil segmentation
- **Classical CV fallback**: Works without ML models using adaptive thresholding
- **Manual adjustment**: Touch-drag circles to fine-tune detection

### Image Preprocessing (v2.1)
- **CLAHE**: Contrast Limited Adaptive Histogram Equalization for uneven lighting
- **Red channel extraction**: Best pupil-iris contrast (melanin absorbs blue/green, reflects red)
- **Adaptive gamma**: Automatic brightness correction for dim images
- **Result**: Reliable detection in ambient lighting without requiring torch

### Reactivity Testing
- **Dark/light phase capture**: Measure pupil constriction response
- **Exposure control**: Automatic camera exposure adjustment when torch is on
- **RAPD screening**: Detect relative afferent pupillary defect
- **Clinical guidance**: Step-by-step light stimulus instructions

### Patient Management
- **Local storage**: Patient records stored in browser (no server required)
- **Trend charts**: Track pupil measurements over time
- **Export/import**: JSON backup and restore
- **Report generation**: Printable clinical reports

## Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla HTML/CSS/JS (no build system) |
| Detection | MediaPipe FaceLandmarker + TFLite (optional) |
| Preprocessing | CLAHE, red channel, adaptive gamma |
| Storage | localStorage + IndexedDB |
| Hosting | GitHub Pages (static PWA) |
| ML Training | TensorFlow/Keras (Python notebook) |

## Architecture

```
index.html          Hub page - mode selection, settings
measure.html        Measurement flow - camera, detection, adjustment
history.html        Patient history - records, trends, export

js/
├── app.js                  App initialization, settings, ML status
├── measurement.js          Camera, capture, detection flow, dual-eye mode
├── history.js              Patient list, trends, import/export
├── detection-preprocess.js CLAHE + red channel + gamma preprocessing
├── detection-ml.js         MediaPipe + TFLite detection
├── detection-classical.js  Threshold-based fallback detection
├── detection-cloud.js      Cloud Run API (optional)
├── patient-store.js        localStorage CRUD
├── i18n.js                 Internationalization (EN/DE)
└── report.js               PDF report generation

css/
├── variables.css           CSS custom properties (theme)
├── components.css          Shared UI components
├── measure.css             Measurement page styles
└── history.css             History page styles

ml/
└── train_pupil_segmentation.ipynb   Model training notebook
```

## Detection Pipeline

```
Image → Preprocess → Detect → Adjust → Results
         │              │
         ├─ CLAHE       ├─ ML (MediaPipe + TFLite)
         ├─ Red channel ├─ Cloud (optional)
         └─ Gamma       ├─ Classical CV
                        └─ Manual fallback
```

### Preprocessing (detection-preprocess.js)
1. **Red channel extraction** - Pupil-iris contrast is highest in red wavelengths
2. **CLAHE** - Local contrast enhancement with bilinear interpolation
3. **Adaptive gamma** - Brightness correction based on image mean

### ML Detection (detection-ml.js)
1. **MediaPipe FaceLandmarker** - Extracts iris landmarks (468-477)
2. **TFLite pupil model** - Segments pupil within iris ROI (optional)
3. **Circle fitting** - Converts segmentation mask to center + radius

### Classical Detection (detection-classical.js)
1. **Darkest region search** - Find pupil center candidate
2. **Adaptive thresholding** - Based on local contrast ratio
3. **Flood fill** - Expand pupil region
4. **Circle fitting** - Least-squares fit to boundary pixels

## Clinical Thresholds

| Difference | Assessment | Clinical Action |
|------------|------------|-----------------|
| < 0.5 mm | Normal | Routine |
| 0.5 - 1.0 mm | Physiological anisocoria | Monitor, ~20% of population |
| 1.0 - 2.0 mm | Pathological anisocoria | Neurological evaluation |
| > 2.0 mm | Significant anisocoria | Urgent assessment |

## L/R Eye Convention

When using the rear camera:
- **MediaPipe LEFT_IRIS** (468-472) = Patient's left eye (OS) = Right side of image
- **MediaPipe RIGHT_IRIS** (473-477) = Patient's right eye (OD) = Left side of image

Front camera images are un-mirrored during capture.

## ML Model Training

The training notebook (`ml/train_pupil_segmentation.ipynb`) produces two models:

| Model | Input | Output | Format | Target |
|-------|-------|--------|--------|--------|
| Pupil ROI | 128×128 RGB | 128×128×1 sigmoid | TFLite (<2MB) | Browser (TF.js) |
| Full Image | 256×256 RGB | 256×256×3 softmax | SavedModel | Cloud Run |

### Datasets
- **MOBIUS** (3,559 images) - Phone camera eye images with masks
- **iBUG** (~2K images) - Eye segmentation dataset
- **Roboflow pupilX** (804 images) - CC BY 4.0
- **Synthetic** (15K images) - Generated with realistic features

### Training
```bash
cd ml
pip install tensorflow opencv-python-headless albumentations
jupyter notebook train_pupil_segmentation.ipynb
```

Set `QUICK_MODE=true` for fast validation (~5 min), or run full training (~45-90 min on GPU).

## Deployment

### GitHub Pages (default)
Push to main branch - GitHub Actions deploys automatically.

### Cloud Run (optional)
```bash
cd cloud
gcloud run deploy pupilcheck-api --source .
```

Set `CLOUD_API_URL` in app settings to enable cloud detection.

## Browser Support

| Feature | Chrome | Safari | Firefox |
|---------|--------|--------|---------|
| Camera | ✅ | ✅ | ✅ |
| Torch | ✅ Android | ✅ iOS 17.5+ | ❌ |
| Exposure control | ✅ Android 101+ | ❌ | ❌ |
| MediaPipe | ✅ | ✅ | ✅ |
| TFLite | ✅ | ✅ | ✅ |

## Privacy

- **No data leaves device** - All processing is local (unless Cloud API enabled)
- **No analytics** - No tracking or telemetry
- **localStorage only** - Patient data stored in browser, never uploaded

## Disclaimer

PupilCheck is a clinical decision-support tool for screening purposes only. It is not a certified medical device. Accuracy depends on image quality, lighting, and correct circle placement. Always correlate findings with full clinical assessment.

## License

MIT License - See LICENSE file for details.

## Version History

- **v2.1** - CLAHE preprocessing, dual-eye capture, exposure control, reactivity guide
- **v2.0** - Multi-page PWA, AI detection, patient history, reports
- **v1.0** - Single-page prototype

---

Built with Claude Code
