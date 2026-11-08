export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Elemento mancante: #${id}`);
	return node as T;
}

export function clear(node: Element): void {
	while (node.firstChild) node.removeChild(node.firstChild);
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tempo relativo in italiano, compatto: "ora", "12 min", "3 h", "5 g". */
export function relativeTime(timestampMs: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - timestampMs) / 1000));
	if (seconds < 60) return "ora";
	if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min`;
	if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h`;
	if (seconds < 30 * DAY) return `${Math.floor(seconds / DAY)} g`;
	if (seconds < 365 * DAY) return `${Math.floor(seconds / (30 * DAY))} mesi`;
	return `${Math.floor(seconds / (365 * DAY))} anni`;
}

export function fullDate(timestampMs: number): string {
	return new Date(timestampMs).toLocaleString("it-IT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
