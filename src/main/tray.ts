import { Menu, Notification, Tray, app, nativeImage } from "electron";
import { join } from "node:path";

import { createCiState, newFailures, type CiState } from "../core/ci.ts";
import type { WorkflowRun } from "../core/actions.ts";
import { listWorkflowRuns } from "./actions.ts";
import { loadSettings } from "./settings.ts";

/**
 * Icona nella barra di sistema e notifiche dei workflow.
 *
 * Il polling guarda solo il repository attivo e solo GitHub (le esecuzioni vivono lì). Il primo giro
 * è una fotografia e non avvisa: dal secondo si notificano le esecuzioni che diventano un errore,
 * una volta sola. Un repository senza remoto o senza account non è un problema da segnalare ogni due
 * minuti: l'errore va su stderr una volta, poi si tace finché non cambia.
 */

const POLL_MS = 120_000;

export interface CiNotifierOptions {
	/** repository attivo, quello che la finestra sta guardando */
	getRoot: () => string | null;
	/** riporta la finestra davanti (o la ricrea) */
	showWindow: () => void;
	/** true durante gli screenshot: niente icona e niente notifiche */
	disabled?: boolean;
}

export interface CiNotifier {
	stop(): void;
	/** lettura immediata, per la voce «Controlla adesso» */
	checkNow: () => Promise<void>;
}

interface Copy {
	tooltip: string;
	show: string;
	check: string;
	notifications: string;
	quit: string;
	title: (name: string) => string;
	body: (run: WorkflowRun) => string;
}

function copy(locale: "it" | "en"): Copy {
	const italian: Copy = {
		tooltip: "GitHandler — controlli dei workflow",
		show: "Mostra GitHandler",
		check: "Controlla adesso",
		notifications: "Notifiche CI",
		quit: "Esci",
		title: (name) => `CI: ${name}`,
		body: (run) =>
			`${run.branch} · ${conclusionText(run.conclusion, "it")} · ${
				run.event
			}`,
	};
	if (locale === "it") return italian;
	return {
		tooltip: "GitHandler — workflow checks",
		show: "Show GitHandler",
		check: "Check now",
		notifications: "CI notifications",
		quit: "Quit",
		title: (name) => `CI: ${name}`,
		body: (run) =>
			`${run.branch} · ${conclusionText(run.conclusion, "en")} · ${
				run.event
			}`,
	};
}

function conclusionText(
	conclusion: string | null,
	locale: "it" | "en"
): string {
	const italian: Record<string, string> = {
		failure: "fallita",
		timed_out: "scaduta",
		startup_failure: "non avviata",
		action_required: "richiede un intervento",
	};
	if (locale === "it") return italian[conclusion ?? ""] ?? "errore";
	const english: Record<string, string> = {
		failure: "failed",
		timed_out: "timed out",
		startup_failure: "did not start",
		action_required: "needs action",
	};
	return english[conclusion ?? ""] ?? "error";
}

/** La lingua della finestra vale anche per icona e notifiche; `auto` segue il sistema. */
async function currentLocale(): Promise<"it" | "en"> {
	try {
		const settings = await loadSettings();
		if (settings.locale === "it" || settings.locale === "en")
			return settings.locale;
	} catch (error) {
		process.stderr.write(
			`notifiche CI: impostazioni non leggibili (${
				(error as Error).message
			})\n`
		);
	}
	return app.getLocale().toLowerCase().startsWith("it") ? "it" : "en";
}

export async function startCiNotifier(
	options: CiNotifierOptions
): Promise<CiNotifier> {
	const strings = copy(await currentLocale());
	let state: CiState = createCiState();
	let lastRoot: string | null = null;
	let enabled = true;
	let checking = false;
	let lastError = "";
	let tray: Tray | null = null;
	let timer: NodeJS.Timeout | null = null;

	const checkNow = async (): Promise<void> => {
		if (!enabled || checking) return;
		const root = options.getRoot();
		if (!root) return;
		// cambiare repository azzera la fotografia: le esecuzioni dell'altro non contano
		if (root !== lastRoot) {
			lastRoot = root;
			state = createCiState();
		}
		checking = true;
		try {
			const runs = await listWorkflowRuns(root);
			const failures = newFailures(state, runs);
			lastError = "";
			if (failures.length === 0 || !Notification.isSupported()) return;
			for (const run of failures) {
				const notification = new Notification({
					title: strings.title(run.name),
					body: strings.body(run),
				});
				notification.on("click", () => options.showWindow());
				notification.show();
			}
		} catch (error) {
			// un repository senza remoto o senza account non deve parlare ogni due minuti
			const message = (error as Error).message;
			if (message !== lastError) {
				lastError = message;
				process.stderr.write(`notifiche CI: ${message}\n`);
			}
		} finally {
			checking = false;
		}
	};

	if (!options.disabled) {
		try {
			const icon = nativeImage.createFromPath(
				join(__dirname, "..", "tray.png")
			);
			tray = new Tray(icon);
			tray.setToolTip(strings.tooltip);
			tray.setContextMenu(
				Menu.buildFromTemplate([
					{ label: strings.show, click: () => options.showWindow() },
					{ label: strings.check, click: () => void checkNow() },
					{ type: "separator" },
					{
						label: strings.notifications,
						type: "checkbox",
						checked: enabled,
						click: (item) => {
							enabled = item.checked;
						},
					},
					{ type: "separator" },
					{ label: strings.quit, click: () => app.quit() },
				])
			);
			tray.on("click", () => options.showWindow());
		} catch (error) {
			// senza barra di sistema l'app funziona lo stesso: si perde solo l'icona
			process.stderr.write(
				`icona di sistema non disponibile: ${
					(error as Error).message
				}\n`
			);
		}
		timer = setInterval(() => void checkNow(), POLL_MS);
		timer.unref();
		// il primo giro è una fotografia: farlo subito evita di avvisare del passato più tardi
		void checkNow();
	}

	return {
		stop: () => {
			if (timer) clearInterval(timer);
			timer = null;
			tray?.destroy();
			tray = null;
		},
		checkNow,
	};
}
