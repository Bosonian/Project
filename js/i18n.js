// Simple i18n system for PupilCheck
// Uses data-i18n attributes on HTML elements and i18n.t() for JS strings

class I18n {
    constructor() {
        this.locale = localStorage.getItem('pupilcheck_lang') || navigator.language?.split('-')[0] || 'en';
        this.strings = {};
        this.fallback = {}; // English fallback
    }

    async init() {
        // Always load English as fallback
        try {
            const enResp = await fetch('lang/en.json');
            this.fallback = await enResp.json();
        } catch(e) { console.warn('Failed to load English strings'); }

        if (this.locale !== 'en') {
            try {
                const resp = await fetch(`lang/${this.locale}.json`);
                this.strings = await resp.json();
            } catch(e) {
                console.warn(`Failed to load ${this.locale} strings, using English`);
                this.locale = 'en';
            }
        }
        this.strings = { ...this.fallback, ...this.strings };
        this.apply();
    }

    async setLocale(locale) {
        this.locale = locale;
        localStorage.setItem('pupilcheck_lang', locale);
        // reload strings
        if (locale === 'en') {
            this.strings = { ...this.fallback };
        } else {
            try {
                const resp = await fetch(`lang/${locale}.json`);
                const localeStrings = await resp.json();
                this.strings = { ...this.fallback, ...localeStrings };
            } catch(e) {
                this.strings = { ...this.fallback };
            }
        }
        this.apply();
    }

    t(key, params = {}) {
        let str = this.strings[key] || this.fallback[key] || key;
        for (const [k, v] of Object.entries(params)) {
            str = str.replace(`{${k}}`, v);
        }
        return str;
    }

    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (el.tagName === 'INPUT' && el.type !== 'checkbox') {
                el.placeholder = text;
            } else {
                el.textContent = text;
            }
        });
        document.documentElement.lang = this.locale;
    }
}

const i18n = new I18n();
