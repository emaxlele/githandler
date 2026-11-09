/**
 * Evidenziazione della sintassi per il diff, senza DOM e senza Electron.
 *
 * Si usano i parser di CodeMirror 6: le modalità "legacy" (MIT) sono tokenizzatori a flusso, quindi
 * leggono il testo riga per riga e non hanno bisogno dell'editor. Il risultato sono intervalli di
 * caratteri con un nome di classe, che il renderer trasforma in `<span>`: qui non si produce HTML,
 * così l'escape resta in un solo punto.
 *
 * Il testo da evidenziare è un hunk, non il file intero. Va bene lo stesso: le modalità a flusso
 * tengono lo stato fra una riga e l'altra e un blocco di commento o una stringa su più righe
 * vengono letti correttamente. Le righe di contesto, aggiunte e rimosse convivono nello stesso
 * flusso; in un punto di sutura il colore può essere meno preciso, ma nessun carattere cambia.
 */

import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage, type Language } from "@codemirror/language";
import {
	c,
	cpp,
	csharp,
	dart,
	java,
	kotlin,
	objectiveC,
	scala,
} from "@codemirror/legacy-modes/mode/clike";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { css, less, sCSS } from "@codemirror/legacy-modes/mode/css";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import {
	javascript,
	json,
	typescript,
} from "@codemirror/legacy-modes/mode/javascript";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { python } from "@codemirror/legacy-modes/mode/python";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { sql } from "@codemirror/legacy-modes/mode/sql";
import { stylus } from "@codemirror/legacy-modes/mode/stylus";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { classHighlighter, highlightTree } from "@lezer/highlight";

/** Un pezzo di riga colorato: indici relativi alla riga, non al file. */
export interface SyntaxSpan {
	from: number;
	to: number;
	/** classi CSS separate da spazio (`tok-keyword`, `tok-variableName tok-definition`…) */
	className: string;
}

/** Oltre questa dimensione si rinuncia: un hunk enorme non deve bloccare il disegno. */
export const MAX_SYNTAX_CHARS = 400_000;

/** Solo classi prodotte dal tema di CodeMirror: niente testo arbitrario finisce nell'HTML. */
const CLASS_PATTERN = /^tok-[a-z0-9-]{1,40}$/i;

type Loader = () => Language;

const LANGUAGES: Record<string, Loader> = {
	javascript: () => StreamLanguage.define(javascript),
	typescript: () => StreamLanguage.define(typescript),
	json: () => StreamLanguage.define(json),
	css: () => StreamLanguage.define(css),
	scss: () => StreamLanguage.define(sCSS),
	sass: () => StreamLanguage.define(sass),
	less: () => StreamLanguage.define(less),
	stylus: () => StreamLanguage.define(stylus),
	html: () => StreamLanguage.define(xml),
	xml: () => StreamLanguage.define(xml),
	markdown: () => markdown({ codeLanguages: [] }).language,
	python: () => StreamLanguage.define(python),
	ruby: () => StreamLanguage.define(ruby),
	go: () => StreamLanguage.define(go),
	rust: () => StreamLanguage.define(rust),
	java: () => StreamLanguage.define(java),
	kotlin: () => StreamLanguage.define(kotlin),
	scala: () => StreamLanguage.define(scala),
	csharp: () => StreamLanguage.define(csharp),
	c: () => StreamLanguage.define(c),
	cpp: () => StreamLanguage.define(cpp),
	objectivec: () => StreamLanguage.define(objectiveC),
	swift: () => StreamLanguage.define(swift),
	dart: () => StreamLanguage.define(dart),
	groovy: () => StreamLanguage.define(groovy),
	shell: () => StreamLanguage.define(shell),
	powershell: () => StreamLanguage.define(powerShell),
	sql: () => StreamLanguage.define(sql({})),
	yaml: () => StreamLanguage.define(yaml),
	toml: () => StreamLanguage.define(toml),
	protobuf: () => StreamLanguage.define(protobuf),
	cmake: () => StreamLanguage.define(cmake),
	dockerfile: () => StreamLanguage.define(dockerFile),
	properties: () => StreamLanguage.define(properties),
	diff: () => StreamLanguage.define(diff),
	lua: () => StreamLanguage.define(lua),
	perl: () => StreamLanguage.define(perl),
};

const EXTENSIONS: Record<string, string> = {
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescript",
	json: "json",
	jsonc: "json",
	json5: "json",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	styl: "stylus",
	stylus: "stylus",
	html: "html",
	htm: "html",
	xhtml: "html",
	vue: "html",
	svelte: "html",
	xml: "xml",
	svg: "xml",
	xsl: "xml",
	xslt: "xml",
	plist: "xml",
	xaml: "xml",
	md: "markdown",
	markdown: "markdown",
	mdx: "markdown",
	py: "python",
	pyw: "python",
	pyi: "python",
	rb: "ruby",
	rake: "ruby",
	gemspec: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	kts: "kotlin",
	scala: "scala",
	sc: "scala",
	cs: "csharp",
	c: "c",
	h: "c",
	cc: "cpp",
	cpp: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hxx: "cpp",
	hh: "cpp",
	m: "objectivec",
	mm: "objectivec",
	swift: "swift",
	dart: "dart",
	groovy: "groovy",
	gvy: "groovy",
	gradle: "groovy",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	ksh: "shell",
	ps1: "powershell",
	psm1: "powershell",
	psd1: "powershell",
	sql: "sql",
	yml: "yaml",
	yaml: "yaml",
	toml: "toml",
	proto: "protobuf",
	cmake: "cmake",
	dockerfile: "dockerfile",
	properties: "properties",
	ini: "properties",
	cfg: "properties",
	conf: "properties",
	env: "properties",
	patch: "diff",
	diff: "diff",
	lua: "lua",
	pl: "perl",
	pm: "perl",
};

/** Nomi di file senza estensione che hanno comunque una sintassi riconoscibile. */
const BASENAMES: Record<string, string> = {
	dockerfile: "dockerfile",
	containerfile: "dockerfile",
	gemfile: "ruby",
	rakefile: "ruby",
	vagrantfile: "ruby",
	"cmakelists.txt": "cmake",
};

/** Lingua dedotta dal percorso, oppure `null` quando non c'è una sintassi da mostrare. */
export function languageForPath(path: string): string | null {
	const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
	const byName = BASENAMES[name];
	if (byName) return byName;
	if (name.startsWith("dockerfile.")) return "dockerfile";
	if (name.startsWith("containerfile.")) return "dockerfile";

	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return null;
	return EXTENSIONS[name.slice(dot + 1)] ?? null;
}

const languageCache = new Map<string, Language | null>();

function languageFor(id: string): Language | null {
	const cached = languageCache.get(id);
	if (cached !== undefined) return cached;
	const loader = LANGUAGES[id];
	let language: Language | null = null;
	if (loader) {
		try {
			language = loader();
		} catch {
			// un parser che non si carica spegne il colore, non il diff
			language = null;
		}
	}
	languageCache.set(id, language);
	return language;
}

function safeClassName(value: string): string {
	const kept: string[] = [];
	for (const part of value.split(" ")) {
		if (CLASS_PATTERN.test(part)) kept.push(part);
	}
	return kept.join(" ");
}

/**
 * Intervalli colorati per ogni riga. Le righe sono unite per far vedere al parser il testo
 * continuo; gli intervalli vengono poi riportati agli indici della singola riga.
 */
export function highlightLines(
	languageId: string | null,
	lines: readonly string[]
): SyntaxSpan[][] {
	const empty = lines.map(() => [] as SyntaxSpan[]);
	if (!languageId || lines.length === 0) return empty;
	if (
		lines.reduce((total, line) => total + line.length + 1, 0) >
		MAX_SYNTAX_CHARS
	)
		return empty;

	const language = languageFor(languageId);
	if (!language) return empty;

	let tree;
	try {
		tree = language.parser.parse(lines.join("\n"));
	} catch {
		return empty;
	}

	let line = 0;
	let lineStart = 0;
	highlightTree(tree, classHighlighter, (from, to, className) => {
		const safe = safeClassName(className);
		if (!safe || to <= from) return;

		let start = Math.max(from, lineStart);
		while (start < to && line < lines.length) {
			const lineEnd = lineStart + lines[line]!.length;
			const end = Math.min(to, lineEnd);
			if (end > start) {
				empty[line]!.push({
					from: start - lineStart,
					to: end - lineStart,
					className: safe,
				});
			}
			if (end >= to) break;
			// la parte successiva del token riparte dopo il newline
			line++;
			lineStart = lineEnd + 1;
			start = Math.max(start, lineStart);
		}
	});
	return empty;
}
