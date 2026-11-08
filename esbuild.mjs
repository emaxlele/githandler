/**
 * Build: quattro bundle separati.
 *
 *   main      -> Node/Electron, CommonJS, `electron` esterno
 *   preload   -> Node/Electron, CommonJS, contesto isolato
 *   renderer  -> browser, IIFE, nessuna API Node
 *   mcp       -> Node, CommonJS, server MCP su stdio (nessuna dipendenza da Electron)
 *
 * Il renderer non ha dipendenze runtime: solo DOM e il core puro importato.
 */

import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const target = "node22";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });

const bundles = [
	{
		entryPoints: ["src/main/index.ts"],
		platform: "node",
		format: "cjs",
		outfile: "dist/main/index.js",
		external: ["electron"],
	},
	{
		entryPoints: ["src/preload/index.ts"],
		platform: "node",
		format: "cjs",
		outfile: "dist/preload/index.js",
		external: ["electron"],
	},
	{
		entryPoints: ["src/renderer/app.ts"],
		platform: "browser",
		format: "iife",
		outfile: "dist/renderer/app.js",
		target: "chrome130",
	},
	{
		entryPoints: ["src/mcp/index.ts"],
		platform: "node",
		format: "cjs",
		outfile: "dist/mcp/index.js",
	},
];

const options = bundles.map((b) => ({
	bundle: true,
	target,
	sourcemap: true,
	logLevel: "warning",
	...b,
}));

if (watch) {
	const contexts = await Promise.all(options.map((o) => context(o)));
	await Promise.all(contexts.map((c) => c.watch()));
	process.stdout.write("watch attivo (HTML/CSS: ricaricare con un rebuild)\n");
} else {
	await Promise.all(options.map((o) => build(o)));
	process.stdout.write("build completata\n");
}

await cp("src/renderer/index.html", "dist/renderer/index.html");
await cp("src/renderer/styles.css", "dist/renderer/styles.css");
