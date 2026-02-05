// ==========================================================================
//   PupilCheck v2.0 - Patient History Module
//   history.js
// ==========================================================================

const History = (() => {
    'use strict';

    // -----------------------------------------------------------------------
    //  State
    // -----------------------------------------------------------------------
    let currentPatientId = null;
    let currentSort = 'newest';
    let pendingConfirmAction = null;
    let pendingNotesPatientId = null;
    let pendingNotesMeasurementId = null;

    // -----------------------------------------------------------------------
    //  Initialization
    // -----------------------------------------------------------------------
    function init() {
        if (typeof i18n !== 'undefined' && i18n.init) {
            i18n.init();
        }
        render();
        renderStats();
        checkStorageWarning();
        bindGlobalEvents();
    }

    // -----------------------------------------------------------------------
    //  Global Event Bindings
    // -----------------------------------------------------------------------
    function bindGlobalEvents() {
        // Close modals on Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (document.getElementById('notesModal').style.display !== 'none') {
                    closeNotesEditor();
                } else if (document.getElementById('confirmModal').style.display !== 'none') {
                    closeConfirm();
                } else if (document.getElementById('importModal').style.display !== 'none') {
                    closeImportDialog();
                } else if (document.getElementById('patientModal').style.display !== 'none') {
                    closePatientModal();
                }
            }
        });

        // Close modals on backdrop click
        var overlays = document.querySelectorAll('.modal-overlay');
        for (var i = 0; i < overlays.length; i++) {
            overlays[i].addEventListener('click', function(e) {
                if (e.target === this) {
                    this.style.display = 'none';
                    // Reset state if patient modal
                    if (this.id === 'patientModal') {
                        currentPatientId = null;
                    }
                    if (this.id === 'confirmModal') {
                        pendingConfirmAction = null;
                    }
                }
            });
        }
    }

    // -----------------------------------------------------------------------
    //  Render Patient List
    // -----------------------------------------------------------------------
    function render() {
        var patients = patientStore.getAll();
        var searchTerm = (document.getElementById('searchInput').value || '').trim().toLowerCase();
        var clearBtn = document.getElementById('searchClear');

        // Show/hide clear button
        if (clearBtn) {
            clearBtn.style.display = searchTerm.length > 0 ? 'flex' : 'none';
        }

        // Filter
        var filtered = patients;
        if (searchTerm) {
            filtered = patients.filter(function(p) {
                return p.label.toLowerCase().indexOf(searchTerm) !== -1;
            });
        }

        // Sort
        filtered = sortPatients(filtered, currentSort);

        var listEl = document.getElementById('patientList');
        var emptyEl = document.getElementById('emptyState');
        var noResultsEl = document.getElementById('noResultsState');

        // No patients at all
        if (patients.length === 0) {
            listEl.innerHTML = '';
            emptyEl.style.display = 'block';
            noResultsEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';

        // Search returned nothing
        if (filtered.length === 0) {
            listEl.innerHTML = '';
            noResultsEl.style.display = 'block';
            return;
        }

        noResultsEl.style.display = 'none';
        listEl.innerHTML = filtered.map(function(p) {
            return renderPatientCard(p);
        }).join('');
    }

    function sortPatients(patients, sortKey) {
        var sorted = patients.slice(); // shallow copy
        switch (sortKey) {
            case 'oldest':
                sorted.sort(function(a, b) {
                    return new Date(a.createdAt) - new Date(b.createdAt);
                });
                break;
            case 'name':
                sorted.sort(function(a, b) {
                    return a.label.localeCompare(b.label);
                });
                break;
            case 'most':
                sorted.sort(function(a, b) {
                    return b.measurements.length - a.measurements.length;
                });
                break;
            case 'newest':
            default:
                sorted.sort(function(a, b) {
                    return new Date(b.createdAt) - new Date(a.createdAt);
                });
                break;
        }
        return sorted;
    }

    // -----------------------------------------------------------------------
    //  Render Summary Stats
    // -----------------------------------------------------------------------
    function renderStats() {
        var el = document.getElementById('historyStats');
        if (!el) return;

        var pCount = patientStore.getPatientCount();
        var mCount = patientStore.getMeasurementCount();

        if (pCount === 0) {
            el.style.display = 'none';
            return;
        }

        el.style.display = 'flex';
        el.innerHTML =
            '<div class="stat-chip">' +
                '<span class="stat-chip-value">' + pCount + '</span>' +
                '<span class="stat-chip-label" data-i18n="history.patients">Patients</span>' +
            '</div>' +
            '<div class="stat-chip">' +
                '<span class="stat-chip-value">' + mCount + '</span>' +
                '<span class="stat-chip-label" data-i18n="history.measurements">Measurements</span>' +
            '</div>';
    }

    // -----------------------------------------------------------------------
    //  Patient Card
    // -----------------------------------------------------------------------
    function renderPatientCard(patient) {
        var lastM = patient.measurements.length > 0 ? patient.measurements[0] : null; // newest first
        var mCount = patient.measurements.length;
        var assessClass = lastM ? App.assessmentClass(lastM.assessment && lastM.assessment.diffMm ? lastM.assessment.diffMm : 0) : '';
        var createdStr = App.formatDate(patient.createdAt);

        var detailHtml = '';
        if (lastM) {
            var leftRatio = lastM.left && lastM.left.ratio != null ? lastM.left.ratio.toFixed(3) : '-';
            var rightRatio = lastM.right && lastM.right.ratio != null ? lastM.right.ratio.toFixed(3) : '-';
            var assessTitle = lastM.assessment && lastM.assessment.title ? lastM.assessment.title : '';
            var lastDate = App.formatDate(lastM.timestamp);

            detailHtml =
                '<div class="patient-card-detail">' +
                    '<span>Last: ' + escapeHtml(lastDate) + '</span>' +
                    (assessTitle ? '<span class="badge badge-' + assessClass + '" style="font-size:10px">' + escapeHtml(assessTitle) + '</span>' : '') +
                '</div>' +
                '<div class="patient-card-ratios">' +
                    '<span class="ratio-label ratio-left">L</span> ' + leftRatio +
                    '<span class="ratio-divider">|</span>' +
                    '<span class="ratio-label ratio-right">R</span> ' + rightRatio +
                '</div>';
        } else {
            detailHtml =
                '<div class="patient-card-detail">' +
                    '<span style="color:var(--text-muted)" data-i18n="history.noMeasurements">No measurements</span>' +
                '</div>';
        }

        return '' +
            '<div class="patient-card" role="listitem" tabindex="0" ' +
                'onclick="History.openPatient(\'' + patient.id + '\')" ' +
                'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();History.openPatient(\'' + patient.id + '\')}"' +
                'aria-label="' + escapeHtml(patient.label) + ', ' + mCount + ' measurements">' +
                '<div class="patient-card-header">' +
                    '<div class="patient-card-name">' + escapeHtml(patient.label) + '</div>' +
                    '<div class="patient-card-meta">' +
                        '<span class="badge badge-muted" title="' + mCount + ' measurements">' + mCount + '</span>' +
                    '</div>' +
                '</div>' +
                detailHtml +
                '<div class="patient-card-footer">' +
                    '<span class="patient-card-created">' + escapeHtml(createdStr) + '</span>' +
                '</div>' +
            '</div>';
    }

    // -----------------------------------------------------------------------
    //  Open Patient Detail Modal
    // -----------------------------------------------------------------------
    function openPatient(patientId) {
        currentPatientId = patientId;
        var patient = patientStore.getPatient(patientId);
        if (!patient) return;

        document.getElementById('patientModalTitle').textContent = patient.label;
        var body = document.getElementById('patientModalBody');
        var html = '';

        // Patient actions toolbar
        html += '<div class="patient-actions">';
        html +=   '<button class="btn btn-sm btn-secondary" onclick="History.renamePatient(\'' + patientId + '\')" aria-label="Rename patient">';
        html +=     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:4px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        html +=     'Rename';
        html +=   '</button>';
        html +=   '<button class="btn btn-sm btn-secondary" onclick="History.exportPatient(\'' + patientId + '\')" aria-label="Export patient data">';
        html +=     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
        html +=     'Export';
        html +=   '</button>';
        html +=   '<button class="btn btn-sm btn-secondary" onclick="History.newMeasurement(\'' + patientId + '\')" aria-label="New measurement" style="border-color:rgba(233,69,96,0.4);color:var(--primary-light)">';
        html +=     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        html +=     'Measure';
        html +=   '</button>';
        html +=   '<button class="btn btn-sm btn-danger-outline" onclick="History.confirmDeletePatient(\'' + patientId + '\')" aria-label="Delete patient">';
        html +=     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        html +=     'Delete';
        html +=   '</button>';
        html += '</div>';

        // Trend chart (if 2+ measurements with ratio data)
        var chartMeasurements = patient.measurements.filter(function(m) {
            return m.left && m.left.ratio != null && m.right && m.right.ratio != null;
        });
        if (chartMeasurements.length >= 2) {
            html += '<div class="trend-chart-container">';
            html +=   '<h4 class="trend-chart-title">';
            html +=     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
            html +=     '<span data-i18n="history.trendChart">Pupil Ratio Trend</span>';
            html +=   '</h4>';
            html +=   '<div class="trend-chart-legend">';
            html +=     '<span class="trend-legend-item trend-legend-left"><span class="trend-legend-dot" style="background:#70a1ff"></span> Left (OS)</span>';
            html +=     '<span class="trend-legend-item trend-legend-right"><span class="trend-legend-dot" style="background:#ffa502"></span> Right (OD)</span>';
            html +=   '</div>';
            html +=   '<canvas id="trendCanvas" width="520" height="220" style="width:100%;height:auto" role="img" aria-label="Pupil ratio trend chart showing left and right eye measurements over time"></canvas>';
            html += '</div>';
        }

        // Timeline header
        html += '<div class="timeline-header">';
        html +=   '<h4 class="timeline-title">';
        html +=     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        html +=     '<span data-i18n="history.timeline">Timeline</span>';
        html +=   '</h4>';
        html +=   '<span class="timeline-count">' + patient.measurements.length + ' measurements</span>';
        html += '</div>';

        // Measurements list
        html += '<div class="measurements-list">';
        if (patient.measurements.length === 0) {
            html += '<div class="measurements-empty">';
            html +=   '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
            html +=   '<div style="margin-top:8px" data-i18n="history.noMeasurementsYet">No measurements recorded yet.</div>';
            html +=   '<button class="btn btn-sm btn-primary" onclick="History.newMeasurement(\'' + patientId + '\')" style="margin-top:12px">Take First Measurement</button>';
            html += '</div>';
        } else {
            for (var i = 0; i < patient.measurements.length; i++) {
                html += renderMeasurementItem(patient.id, patient.measurements[i], i);
            }
        }
        html += '</div>';

        body.innerHTML = html;
        document.getElementById('patientModal').style.display = 'flex';

        // Focus the close button for accessibility
        var closeBtn = document.getElementById('patientModal').querySelector('.modal-close');
        if (closeBtn) closeBtn.focus();

        // Draw trend chart after DOM update
        if (chartMeasurements.length >= 2) {
            requestAnimationFrame(function() {
                drawTrendChart(chartMeasurements);
            });
        }
    }

    // -----------------------------------------------------------------------
    //  Measurement Item
    // -----------------------------------------------------------------------
    function renderMeasurementItem(patientId, m, index) {
        var assessClass = App.assessmentClass(m.assessment && m.assessment.diffMm ? m.assessment.diffMm : 0);
        var hasReactivity = m.mode === 'reactivity' && m.reactivity;
        var leftRatio = m.left && m.left.ratio != null ? m.left.ratio.toFixed(3) : '-';
        var rightRatio = m.right && m.right.ratio != null ? m.right.ratio.toFixed(3) : '-';
        var leftMm = m.left && m.left.pupilMm != null ? m.left.pupilMm.toFixed(1) : '-';
        var rightMm = m.right && m.right.pupilMm != null ? m.right.pupilMm.toFixed(1) : '-';
        var ratioDiff = m.assessment && m.assessment.ratioDiff != null ? m.assessment.ratioDiff.toFixed(3) : '-';
        var diffMm = m.assessment && m.assessment.diffMm != null ? m.assessment.diffMm.toFixed(1) : '-';
        var assessTitle = m.assessment && m.assessment.title ? m.assessment.title : '-';
        var modeLabel = m.mode === 'reactivity' ? 'Size + Reactivity' : 'Size Only';
        var detectionLabel = m.detectionMethod || 'Classical';

        var html = '';
        html += '<div class="measurement-item" aria-label="Measurement from ' + App.formatDateTime(m.timestamp) + '">';

        // Timeline dot connector
        html +=   '<div class="measurement-timeline-dot"><span class="timeline-dot timeline-dot-' + assessClass + '"></span></div>';

        html +=   '<div class="measurement-item-content">';

        // Header row
        html +=     '<div class="measurement-item-header">';
        html +=       '<div>';
        html +=         '<div class="measurement-date">' + App.formatDateTime(m.timestamp) + '</div>';
        html +=         '<div class="measurement-mode">' + escapeHtml(modeLabel) + ' | ' + escapeHtml(detectionLabel) + '</div>';
        html +=       '</div>';
        html +=       '<span class="badge badge-' + assessClass + '">' + escapeHtml(assessTitle) + '</span>';
        html +=     '</div>';

        // Eye data
        html +=     '<div class="measurement-item-data">';

        // Left eye
        html +=       '<div class="measurement-eye">';
        if (m.thumbnails && m.thumbnails.left) {
            html +=     '<img src="' + m.thumbnails.left + '" alt="Left eye thumbnail" class="measurement-thumb" loading="lazy">';
        }
        html +=         '<div class="measurement-eye-values">';
        html +=           '<div class="measurement-eye-label" style="color:var(--info)">Left (OS)</div>';
        html +=           '<div class="measurement-eye-ratio">' + leftRatio + '</div>';
        html +=           '<div class="measurement-eye-mm">~' + leftMm + ' mm</div>';
        html +=         '</div>';
        html +=       '</div>';

        // Right eye
        html +=       '<div class="measurement-eye">';
        if (m.thumbnails && m.thumbnails.right) {
            html +=     '<img src="' + m.thumbnails.right + '" alt="Right eye thumbnail" class="measurement-thumb" loading="lazy">';
        }
        html +=         '<div class="measurement-eye-values">';
        html +=           '<div class="measurement-eye-label" style="color:var(--warning)">Right (OD)</div>';
        html +=           '<div class="measurement-eye-ratio">' + rightRatio + '</div>';
        html +=           '<div class="measurement-eye-mm">~' + rightMm + ' mm</div>';
        html +=         '</div>';
        html +=       '</div>';

        html +=     '</div>'; // .measurement-item-data

        // Diff line
        html +=     '<div class="measurement-diff">';
        html +=       'Diff: ' + ratioDiff + ' (~' + diffMm + ' mm)';
        if (hasReactivity) {
            var leftPct = m.reactivity.leftPct != null ? m.reactivity.leftPct.toFixed(0) : '-';
            var rightPct = m.reactivity.rightPct != null ? m.reactivity.rightPct.toFixed(0) : '-';
            html +=   ' | L: ' + leftPct + '% R: ' + rightPct + '%';
            if (m.reactivity.rapdFlag) {
                html += ' <span class="rapd-flag" title="RAPD screening positive">RAPD</span>';
            }
        }
        html +=     '</div>';

        // Notes
        if (m.notes) {
            html +=   '<div class="measurement-notes">' + escapeHtml(m.notes) + '</div>';
        }

        // Action buttons
        html +=     '<div class="measurement-actions">';
        html +=       '<button class="btn btn-sm btn-secondary measurement-action-btn" onclick="event.stopPropagation();History.generateReport(\'' + patientId + '\',\'' + m.id + '\')" aria-label="Generate report">';
        html +=         '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
        html +=         ' Report';
        html +=       '</button>';
        html +=       '<button class="btn btn-sm btn-secondary measurement-action-btn" onclick="event.stopPropagation();History.editNotes(\'' + patientId + '\',\'' + m.id + '\')" aria-label="Edit notes">';
        html +=         '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        html +=         ' Notes';
        html +=       '</button>';
        html +=       '<button class="btn btn-sm btn-danger-outline measurement-action-btn" onclick="event.stopPropagation();History.confirmDeleteMeasurement(\'' + patientId + '\',\'' + m.id + '\')" aria-label="Delete measurement">';
        html +=         '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        html +=         ' Delete';
        html +=       '</button>';
        html +=     '</div>';

        html +=   '</div>'; // .measurement-item-content
        html += '</div>'; // .measurement-item

        return html;
    }

    // -----------------------------------------------------------------------
    //  Trend Chart - Canvas 2D (no external library)
    // -----------------------------------------------------------------------
    function drawTrendChart(measurements) {
        var canvas = document.getElementById('trendCanvas');
        if (!canvas) return;

        // Chronological order (oldest first) for plotting
        var data = measurements.slice().reverse().filter(function(m) {
            return m.left && m.left.ratio != null && m.right && m.right.ratio != null;
        });
        if (data.length < 2) return;

        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var cssW = canvas.clientWidth;
        var cssH = canvas.clientHeight || 200;

        // High-DPI canvas
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        ctx.scale(dpr, dpr);

        var W = cssW;
        var H = cssH;
        var pad = { top: 24, right: 16, bottom: 32, left: 48 };
        var plotW = W - pad.left - pad.right;
        var plotH = H - pad.top - pad.bottom;

        // Find Y range from all ratios
        var minY = Infinity;
        var maxY = -Infinity;
        for (var i = 0; i < data.length; i++) {
            var lr = data[i].left.ratio;
            var rr = data[i].right.ratio;
            if (lr < minY) minY = lr;
            if (rr < minY) minY = rr;
            if (lr > maxY) maxY = lr;
            if (rr > maxY) maxY = rr;
        }
        var rangeY = maxY - minY;
        if (rangeY < 0.01) rangeY = 0.1; // prevent zero range
        minY -= rangeY * 0.12;
        maxY += rangeY * 0.12;
        var totalRangeY = maxY - minY;

        // Clear
        ctx.clearRect(0, 0, W, H);

        // Background fill for chart area
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        roundRect(ctx, pad.left, pad.top, plotW, plotH, 4);
        ctx.fill();

        // Grid lines (horizontal)
        var gridLines = 5;
        ctx.lineWidth = 1;
        for (var g = 0; g <= gridLines; g++) {
            var gy = pad.top + (plotH / gridLines) * g;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.beginPath();
            ctx.moveTo(pad.left, gy);
            ctx.lineTo(W - pad.right, gy);
            ctx.stroke();

            // Y label
            var yVal = maxY - totalRangeY * (g / gridLines);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(yVal.toFixed(2), pad.left - 8, gy);
        }

        // X labels (dates)
        var xStep = data.length > 1 ? plotW / (data.length - 1) : 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (var xi = 0; xi < data.length; xi++) {
            var x = pad.left + xi * xStep;

            // Vertical grid line (subtle)
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, pad.top + plotH);
            ctx.stroke();

            // Only show labels for first, last, and up to 3 intermediate points
            var showLabel = (xi === 0 || xi === data.length - 1);
            if (!showLabel && data.length <= 7) showLabel = true;
            if (!showLabel && data.length > 7) {
                var interval = Math.ceil(data.length / 5);
                showLabel = (xi % interval === 0);
            }

            if (showLabel) {
                var d = new Date(data[xi].timestamp);
                var labelStr = (d.getMonth() + 1) + '/' + d.getDate();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.fillText(labelStr, x, pad.top + plotH + 8);
            }
        }

        // Helper to map data value to canvas Y
        function toY(ratio) {
            return pad.top + plotH * (1 - (ratio - minY) / totalRangeY);
        }

        // Helper to map index to canvas X
        function toX(idx) {
            return pad.left + idx * xStep;
        }

        // Draw gradient fill under each line
        function drawFill(getData, color) {
            ctx.beginPath();
            ctx.moveTo(toX(0), toY(getData(data[0])));
            for (var fi = 1; fi < data.length; fi++) {
                ctx.lineTo(toX(fi), toY(getData(data[fi])));
            }
            ctx.lineTo(toX(data.length - 1), pad.top + plotH);
            ctx.lineTo(toX(0), pad.top + plotH);
            ctx.closePath();

            var grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
            grad.addColorStop(0, color.replace(')', ', 0.15)').replace('rgb', 'rgba'));
            grad.addColorStop(1, color.replace(')', ', 0.01)').replace('rgb', 'rgba'));
            ctx.fillStyle = grad;
            ctx.fill();
        }

        // Draw line with dots
        function drawLine(getData, color) {
            // Line
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            for (var li = 0; li < data.length; li++) {
                var lx = toX(li);
                var ly = toY(getData(data[li]));
                if (li === 0) ctx.moveTo(lx, ly);
                else ctx.lineTo(lx, ly);
            }
            ctx.stroke();

            // Dots
            for (var di = 0; di < data.length; di++) {
                var dx = toX(di);
                var dy = toY(getData(data[di]));

                // Outer glow
                ctx.beginPath();
                ctx.arc(dx, dy, 5, 0, Math.PI * 2);
                ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
                ctx.fill();

                // Inner dot
                ctx.beginPath();
                ctx.arc(dx, dy, 3, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                // White center
                ctx.beginPath();
                ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fill();
            }
        }

        var leftColor = 'rgb(112, 161, 255)';   // --info / blue
        var rightColor = 'rgb(255, 165, 2)';     // --warning / orange

        // Draw fills first (underneath)
        drawFill(function(m) { return m.left.ratio; }, leftColor);
        drawFill(function(m) { return m.right.ratio; }, rightColor);

        // Then lines on top
        drawLine(function(m) { return m.left.ratio; }, leftColor);
        drawLine(function(m) { return m.right.ratio; }, rightColor);
    }

    // Canvas rounded rectangle helper
    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // -----------------------------------------------------------------------
    //  CRUD Operations
    // -----------------------------------------------------------------------
    function createPatient() {
        var name = prompt('Patient name or identifier:');
        if (!name || !name.trim()) return;
        patientStore.createPatient(name.trim());
        render();
        renderStats();
        App.showToast('Patient created', 'success');
    }

    function renamePatient(id) {
        var patient = patientStore.getPatient(id);
        if (!patient) return;
        var name = prompt('New name:', patient.label);
        if (!name || !name.trim()) return;
        patientStore.updatePatient(id, { label: name.trim() });
        document.getElementById('patientModalTitle').textContent = name.trim();
        render();
        App.showToast('Patient renamed', 'success');
    }

    function confirmDeletePatient(id) {
        pendingConfirmAction = function() {
            patientStore.deletePatient(id);
            closeConfirm();
            closePatientModal();
            render();
            renderStats();
            App.showToast('Patient deleted', 'info');
        };
        document.getElementById('confirmTitle').textContent = 'Delete Patient';
        document.getElementById('confirmMessage').textContent = 'Delete this patient and all their measurements? This action cannot be undone.';
        document.getElementById('confirmAction').textContent = 'Delete';
        document.getElementById('confirmModal').style.display = 'flex';
        document.getElementById('confirmAction').focus();
    }

    function confirmDeleteMeasurement(patientId, measurementId) {
        pendingConfirmAction = function() {
            patientStore.deleteMeasurement(patientId, measurementId);
            closeConfirm();
            openPatient(patientId); // Refresh modal
            render();
            renderStats();
            App.showToast('Measurement deleted', 'info');
        };
        document.getElementById('confirmTitle').textContent = 'Delete Measurement';
        document.getElementById('confirmMessage').textContent = 'Delete this measurement? This action cannot be undone.';
        document.getElementById('confirmAction').textContent = 'Delete';
        document.getElementById('confirmModal').style.display = 'flex';
        document.getElementById('confirmAction').focus();
    }

    function executeConfirm() {
        if (typeof pendingConfirmAction === 'function') {
            pendingConfirmAction();
        }
        pendingConfirmAction = null;
    }

    function closeConfirm() {
        document.getElementById('confirmModal').style.display = 'none';
        pendingConfirmAction = null;
    }

    // -----------------------------------------------------------------------
    //  Notes Editor
    // -----------------------------------------------------------------------
    function editNotes(patientId, measurementId) {
        var patient = patientStore.getPatient(patientId);
        if (!patient) return;
        var m = null;
        for (var i = 0; i < patient.measurements.length; i++) {
            if (patient.measurements[i].id === measurementId) {
                m = patient.measurements[i];
                break;
            }
        }
        if (!m) return;

        pendingNotesPatientId = patientId;
        pendingNotesMeasurementId = measurementId;

        var textarea = document.getElementById('notesTextarea');
        textarea.value = m.notes || '';
        document.getElementById('notesModal').style.display = 'flex';
        textarea.focus();
    }

    function saveNotes() {
        if (!pendingNotesPatientId || !pendingNotesMeasurementId) return;
        var notes = document.getElementById('notesTextarea').value.trim();
        patientStore.updateMeasurementNotes(pendingNotesPatientId, pendingNotesMeasurementId, notes);
        closeNotesEditor();
        openPatient(pendingNotesPatientId); // Refresh
        App.showToast('Notes saved', 'success');
    }

    function closeNotesEditor() {
        document.getElementById('notesModal').style.display = 'none';
        pendingNotesPatientId = null;
        pendingNotesMeasurementId = null;
    }

    // -----------------------------------------------------------------------
    //  Report Generation
    // -----------------------------------------------------------------------
    function generateReport(patientId, measurementId) {
        var patient = patientStore.getPatient(patientId);
        if (!patient) return;
        var m = null;
        for (var i = 0; i < patient.measurements.length; i++) {
            if (patient.measurements[i].id === measurementId) {
                m = patient.measurements[i];
                break;
            }
        }
        if (!m) return;
        ReportGenerator.generate(m, patient.label);
    }

    // -----------------------------------------------------------------------
    //  Navigation
    // -----------------------------------------------------------------------
    function newMeasurement(patientId) {
        sessionStorage.setItem('pupilcheck_patientId', patientId);
        window.location.href = 'measure.html';
    }

    // -----------------------------------------------------------------------
    //  Export / Import
    // -----------------------------------------------------------------------
    function exportPatient(id) {
        var json = patientStore.exportPatient(id);
        if (!json) return;
        var patient = patientStore.getPatient(id);
        var filename = 'pupilcheck-' + sanitizeFilename(patient ? patient.label : id) + '.json';
        downloadJson(json, filename);
        App.showToast('Patient data exported', 'success');
    }

    function exportAll() {
        var count = patientStore.getPatientCount();
        if (count === 0) {
            App.showToast('No data to export', 'warning');
            return;
        }
        var json = patientStore.exportAll();
        var date = new Date().toISOString().slice(0, 10);
        downloadJson(json, 'pupilcheck-export-' + date + '.json');
        App.showToast('All data exported (' + count + ' patients)', 'success');
    }

    function downloadJson(json, filename) {
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function sanitizeFilename(str) {
        return str.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40).toLowerCase();
    }

    function showImportDialog() {
        document.getElementById('importTextarea').value = '';
        document.getElementById('importModal').style.display = 'flex';
        document.getElementById('importTextarea').focus();
    }

    function closeImportDialog() {
        document.getElementById('importModal').style.display = 'none';
    }

    function onFileSelected(event) {
        var file = event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('importTextarea').value = e.target.result;
        };
        reader.readAsText(file);
        // Reset file input so same file can be re-selected
        event.target.value = '';
    }

    function doImport() {
        var text = document.getElementById('importTextarea').value.trim();
        if (!text) {
            App.showToast('No data to import', 'warning');
            return;
        }

        // Basic JSON validation before passing to store
        try {
            JSON.parse(text);
        } catch (e) {
            App.showToast('Invalid JSON format', 'error');
            return;
        }

        var ok = patientStore.importPatient(text);
        if (ok) {
            closeImportDialog();
            render();
            renderStats();
            checkStorageWarning();
            App.showToast('Data imported successfully', 'success');
        } else {
            App.showToast('Import failed - please check the data format', 'error');
        }
    }

    // -----------------------------------------------------------------------
    //  Modal Management
    // -----------------------------------------------------------------------
    function closePatientModal() {
        document.getElementById('patientModal').style.display = 'none';
        currentPatientId = null;
    }

    // -----------------------------------------------------------------------
    //  Search & Sort
    // -----------------------------------------------------------------------
    function onSearch() {
        render();
    }

    function clearSearch() {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').style.display = 'none';
        render();
        document.getElementById('searchInput').focus();
    }

    function setSort(sortKey) {
        currentSort = sortKey;
        // Update button states
        var buttons = document.querySelectorAll('.sort-btn');
        for (var i = 0; i < buttons.length; i++) {
            var isActive = buttons[i].getAttribute('data-sort') === sortKey;
            buttons[i].classList.toggle('active', isActive);
            buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
        render();
    }

    // -----------------------------------------------------------------------
    //  Storage Warning
    // -----------------------------------------------------------------------
    function checkStorageWarning() {
        var warning = patientStore.getStorageWarning();
        var el = document.getElementById('storageWarning');
        if (!el) return;

        if (warning) {
            el.style.display = 'block';
            var isCritical = warning.level === 'critical';
            el.className = 'tip-box' + (isCritical ? ' tip-box-danger' : '');
            el.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:6px;color:' + (isCritical ? 'var(--danger)' : 'var(--warning)') + '"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                '<strong>Storage (' + warning.pct + '%):</strong> ' + escapeHtml(warning.message);
        } else {
            el.style.display = 'none';
        }
    }

    // -----------------------------------------------------------------------
    //  Utility
    // -----------------------------------------------------------------------
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // -----------------------------------------------------------------------
    //  Init on DOM ready
    // -----------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', init);

    // -----------------------------------------------------------------------
    //  Public API
    // -----------------------------------------------------------------------
    return {
        render: render,
        createPatient: createPatient,
        openPatient: openPatient,
        closePatientModal: closePatientModal,
        renamePatient: renamePatient,
        confirmDeletePatient: confirmDeletePatient,
        confirmDeleteMeasurement: confirmDeleteMeasurement,
        executeConfirm: executeConfirm,
        closeConfirm: closeConfirm,
        editNotes: editNotes,
        saveNotes: saveNotes,
        closeNotesEditor: closeNotesEditor,
        generateReport: generateReport,
        newMeasurement: newMeasurement,
        exportPatient: exportPatient,
        exportAll: exportAll,
        showImportDialog: showImportDialog,
        closeImportDialog: closeImportDialog,
        onFileSelected: onFileSelected,
        doImport: doImport,
        onSearch: onSearch,
        clearSearch: clearSearch,
        setSort: setSort
    };
})();
