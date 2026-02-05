// PupilCheck Patient Store
// Manages patient sessions and measurements in localStorage

class PatientStore {
    constructor() {
        this.STORAGE_KEY = 'pupilcheck_patients';
        this.SETTINGS_KEY = 'pupilcheck_settings';
    }

    // Get all patients
    getAll() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
        } catch(e) { return []; }
    }

    // Save all patients
    _save(patients) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(patients));
    }

    // Get single patient by ID
    getPatient(id) {
        return this.getAll().find(p => p.id === id) || null;
    }

    // Create new patient
    createPatient(label) {
        const patients = this.getAll();
        const patient = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            label: label || `Patient ${patients.length + 1}`,
            measurements: []
        };
        patients.unshift(patient); // newest first
        this._save(patients);
        return patient;
    }

    // Add measurement to patient
    // measurementData: { mode, left, right, leftLight?, rightLight?, assessment, reactivity?, thumbnails, detectionMethod, notes }
    addMeasurement(patientId, measurementData) {
        const patients = this.getAll();
        const patient = patients.find(p => p.id === patientId);
        if (!patient) return null;

        const measurement = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...measurementData
        };
        patient.measurements.unshift(measurement); // newest first
        this._save(patients);
        return measurement;
    }

    // Update patient label
    updatePatient(patientId, updates) {
        const patients = this.getAll();
        const patient = patients.find(p => p.id === patientId);
        if (!patient) return null;
        if (updates.label !== undefined) patient.label = updates.label;
        this._save(patients);
        return patient;
    }

    // Add/update notes on a measurement
    updateMeasurementNotes(patientId, measurementId, notes) {
        const patients = this.getAll();
        const patient = patients.find(p => p.id === patientId);
        if (!patient) return null;
        const m = patient.measurements.find(m => m.id === measurementId);
        if (!m) return null;
        m.notes = notes;
        this._save(patients);
        return m;
    }

    // Delete a measurement
    deleteMeasurement(patientId, measurementId) {
        const patients = this.getAll();
        const patient = patients.find(p => p.id === patientId);
        if (!patient) return false;
        patient.measurements = patient.measurements.filter(m => m.id !== measurementId);
        this._save(patients);
        return true;
    }

    // Delete a patient and all their measurements
    deletePatient(patientId) {
        const patients = this.getAll().filter(p => p.id !== patientId);
        this._save(patients);
        return true;
    }

    // Export single patient as JSON
    exportPatient(patientId) {
        const patient = this.getPatient(patientId);
        if (!patient) return null;
        return JSON.stringify(patient, null, 2);
    }

    // Export all patients as JSON
    exportAll() {
        return JSON.stringify(this.getAll(), null, 2);
    }

    // Import patient from JSON
    importPatient(jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            const patients = this.getAll();
            // Assign new ID to avoid collisions
            if (data.id) {
                data.id = crypto.randomUUID();
            }
            if (Array.isArray(data)) {
                // Importing multiple patients
                data.forEach(p => { p.id = crypto.randomUUID(); patients.unshift(p); });
            } else {
                patients.unshift(data);
            }
            this._save(patients);
            return true;
        } catch(e) {
            console.error('Import failed:', e);
            return false;
        }
    }

    // Get total patient count
    getPatientCount() {
        return this.getAll().length;
    }

    // Get total measurement count
    getMeasurementCount() {
        return this.getAll().reduce((sum, p) => sum + p.measurements.length, 0);
    }

    // Get most recent measurement across all patients
    getLastMeasurement() {
        const patients = this.getAll();
        let latest = null;
        let latestTime = 0;
        for (const p of patients) {
            for (const m of p.measurements) {
                const t = new Date(m.timestamp).getTime();
                if (t > latestTime) {
                    latestTime = t;
                    latest = { ...m, patientLabel: p.label, patientId: p.id };
                }
            }
        }
        return latest;
    }

    // Get storage usage in bytes (approximate)
    getStorageUsage() {
        const data = localStorage.getItem(this.STORAGE_KEY) || '';
        return new Blob([data]).size;
    }

    // Get storage capacity warning
    getStorageWarning() {
        const usage = this.getStorageUsage();
        const estimatedMax = 5 * 1024 * 1024; // 5MB conservative estimate
        const pct = (usage / estimatedMax) * 100;
        if (pct > 90) return { level: 'critical', pct: Math.round(pct), message: 'Storage almost full. Export and delete old measurements.' };
        if (pct > 70) return { level: 'warning', pct: Math.round(pct), message: 'Storage usage high. Consider exporting data.' };
        return null;
    }

    // Settings management
    getSettings() {
        try {
            return JSON.parse(localStorage.getItem(this.SETTINGS_KEY)) || {};
        } catch(e) { return {}; }
    }

    saveSetting(key, value) {
        const settings = this.getSettings();
        settings[key] = value;
        localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
    }

    getSetting(key, defaultValue) {
        const settings = this.getSettings();
        return settings[key] !== undefined ? settings[key] : defaultValue;
    }
}

// Global instance
const patientStore = new PatientStore();
