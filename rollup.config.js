import terser from "@rollup/plugin-terser";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
    input: "src/main.js",
    output: {
        file: "dist/dashboard.js",
        format: "iife",
        name: "GardenLinuxDashboard",
        sourcemap: true,
    },
    plugins: [
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs(),
        // Minify in production
        process.env.NODE_ENV === "production" &&
            terser({
                compress: {
                    drop_console: true,
                },
            }),
    ].filter(Boolean),
};
