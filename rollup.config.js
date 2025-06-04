import terser from "@rollup/plugin-terser";

export default {
    input: "src/main.js",
    output: {
        file: "dist/dashboard.js",
        format: "iife",
        name: "GardenLinuxDashboard",
        sourcemap: true,
    },
    plugins: [
        // Minify in production
        process.env.NODE_ENV === "production" &&
            terser({
                compress: {
                    drop_console: true,
                },
            }),
    ].filter(Boolean),
};
