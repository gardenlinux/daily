import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                window: "readonly",
                document: "readonly",
                console: "readonly",
                fetch: "readonly",
                URL: "readonly",
                URLSearchParams: "readonly",
                Date: "readonly",
                localStorage: "readonly",
                location: "readonly",
                alert: "readonly",
                confirm: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                goToGL: "writable",
            },
        },
        rules: {
            // Best practices
            "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "no-console": "warn",
            "prefer-const": "error",
            "no-var": "error",

            // Code style - let Prettier handle formatting
            indent: "off",
            quotes: "off",
            semi: "off",
            "comma-dangle": "off",
            "eol-last": "off",

            // Modern JavaScript
            "prefer-arrow-callback": "error",
            "prefer-template": "error",
            "object-shorthand": "error",

            // Error prevention
            "no-undef": "error",
            "no-unreachable": "error",
            "no-duplicate-imports": "error",
        },
    },
    {
        files: ["rollup.config.js", "eslint.config.js"],
        languageOptions: {
            globals: {
                process: "readonly",
            },
        },
    },
];
