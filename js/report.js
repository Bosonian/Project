// PupilCheck Report Generator
// Creates print-optimized reports for medical records

class ReportGenerator {
    // Generate and open a printable report for a measurement
    static generate(measurement, patientLabel) {
        const win = window.open('', '_blank');
        if (!win) {
            alert('Please allow popups to generate reports.');
            return;
        }

        const html = ReportGenerator.buildHTML(measurement, patientLabel);
        win.document.write(html);
        win.document.close();

        // Auto-trigger print after load
        win.onload = () => {
            setTimeout(() => win.print(), 300);
        };
    }

    static buildHTML(m, patientLabel) {
        const date = new Date(m.timestamp).toLocaleString();
        const mode = m.mode === 'reactivity' ? 'Size + Reactivity' : 'Size Comparison';

        // Assessment styling
        const assessClass = m.assessment?.class || 'normal';
        const assessColors = { normal: '#2ed573', mild: '#ffa502', significant: '#ff4757' };
        const assessColor = assessColors[assessClass] || '#2ed573';

        let reactivitySection = '';
        if (m.mode === 'reactivity' && m.reactivity) {
            reactivitySection = `
            <div class="section">
                <h3>Pupil Reactivity</h3>
                <table>
                    <tr><th></th><th>Left (OS)</th><th>Right (OD)</th></tr>
                    <tr><td>Constriction</td><td>${m.reactivity.leftPct?.toFixed(1) || '-'}%</td><td>${m.reactivity.rightPct?.toFixed(1) || '-'}%</td></tr>
                    <tr><td>Classification</td><td>${m.reactivity.leftLabel || '-'}</td><td>${m.reactivity.rightLabel || '-'}</td></tr>
                </table>
                ${m.reactivity.rapdFlag ? '<div class="alert">RAPD Screening: Asymmetric reactivity detected. Formal swinging flashlight test recommended.</div>' : '<p>RAPD Screening: No significant asymmetry detected.</p>'}
            </div>`;
        }

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>PupilCheck Report - ${patientLabel} - ${date}</title>
<style>
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333; line-height: 1.6; }
    .header { text-align: center; border-bottom: 2px solid #e94560; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 20px; margin: 0; color: #e94560; }
    .header .date { font-size: 13px; color: #666; margin-top: 4px; }
    .header .patient { font-size: 16px; font-weight: 600; margin-top: 4px; }
    .thumbnails { display: flex; gap: 16px; justify-content: center; margin: 16px 0; }
    .thumb { text-align: center; }
    .thumb img { width: 150px; height: 150px; border-radius: 8px; border: 1px solid #ddd; }
    .thumb label { display: block; font-size: 12px; font-weight: 600; color: #666; margin-top: 4px; }
    .assessment { text-align: center; padding: 12px; border-radius: 8px; background: ${assessColor}15; border: 1px solid ${assessColor}40; margin: 16px 0; }
    .assessment h2 { font-size: 18px; color: ${assessColor}; margin: 0 0 4px; }
    .assessment p { font-size: 13px; color: #666; margin: 0; }
    .section { margin: 16px 0; }
    .section h3 { font-size: 14px; color: #e94560; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 6px 10px; border: 1px solid #ddd; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    .alert { background: #fff3cd; border: 1px solid #ffc107; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin-top: 8px; }
    .disclaimer { margin-top: 20px; padding: 10px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; font-size: 11px; color: #666; }
    .footer { text-align: center; font-size: 11px; color: #999; margin-top: 20px; padding-top: 10px; border-top: 1px solid #eee; }
    .notes { background: #f8f9fa; padding: 10px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
    @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
    <div class="header">
        <h1>PupilCheck Assessment Report</h1>
        <div class="patient">${patientLabel || 'Unassigned'}</div>
        <div class="date">${date} | Mode: ${mode} | Detection: ${m.detectionMethod || 'Classical CV'}</div>
    </div>

    ${m.thumbnails ? `
    <div class="thumbnails">
        ${m.thumbnails.left ? `<div class="thumb"><img src="${m.thumbnails.left}" alt="Left eye"><label>Left Eye (OS)</label></div>` : ''}
        ${m.thumbnails.right ? `<div class="thumb"><img src="${m.thumbnails.right}" alt="Right eye"><label>Right Eye (OD)</label></div>` : ''}
    </div>` : ''}

    <div class="assessment">
        <h2>${m.assessment?.title || 'Assessment'}</h2>
        <p>${m.assessment?.detail || ''}</p>
    </div>

    <div class="section">
        <h3>Measurements</h3>
        <table>
            <tr><th></th><th>Left Eye (OS)</th><th>Right Eye (OD)</th></tr>
            <tr><td>P/I Ratio</td><td>${m.left?.ratio?.toFixed(3) || '-'}</td><td>${m.right?.ratio?.toFixed(3) || '-'}</td></tr>
            <tr><td>Est. Pupil (mm)</td><td>~${m.left?.pupilMm?.toFixed(1) || '-'}</td><td>~${m.right?.pupilMm?.toFixed(1) || '-'}</td></tr>
            <tr><td>Difference</td><td colspan="2">${m.assessment?.ratioDiff?.toFixed(3) || '-'} ratio (~${m.assessment?.diffMm?.toFixed(1) || '-'} mm est.)</td></tr>
        </table>
    </div>

    ${reactivitySection}

    ${m.notes ? `
    <div class="section">
        <h3>Clinical Notes</h3>
        <div class="notes">${m.notes}</div>
    </div>` : ''}

    <div class="disclaimer">
        <strong>Disclaimer:</strong> This report is generated by PupilCheck, an AI-assisted pupil measurement tool for clinical screening purposes only. It is not a certified medical device. Accuracy depends on image quality, lighting, and correct circle placement. Always correlate with full clinical assessment. The pupil-to-iris ratio comparison is distance-independent. Approximate mm values use 11.7 mm average iris diameter (individual range ~10.2-13.0 mm).
    </div>

    <div class="footer">
        Generated by PupilCheck v2.0 | AI-Powered Anisocoria Assessment | ${new Date().toLocaleDateString()}
    </div>
</body>
</html>`;
    }
}
