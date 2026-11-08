import type { GraphRow } from "./types.ts";

export interface GraphInput {
	sha: string;
	parents: string[];
}

function trimRight(lanes: (string | null)[]): (string | null)[] {
	let end = lanes.length;
	while (end > 0 && lanes[end - 1] === null) end--;
	return lanes.slice(0, end);
}

/**
 * Assegna a ogni commit una corsia, come fanno i visualizzatori di storia.
 *
 * `lanes[i]` contiene lo SHA che quella colonna sta ancora aspettando: scorrendo la storia dal
 * più recente, ogni commit "consuma" la corsia che lo aspettava e ne eredita una per il primo
 * parent. I parent successivi aprono nuove corsie (o riusano quella che già li attende, quando un
 * merge confluisce in una linea già presente).
 *
 * L'output è deterministico e non dipende dal rendering: si può testare senza UI.
 */
export function layoutGraph(commits: GraphInput[]): GraphRow[] {
	const rows: GraphRow[] = [];
	const lanes: (string | null)[] = [];

	const freeSlot = (): number => {
		for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
		lanes.push(null);
		return lanes.length - 1;
	};

	for (const commit of commits) {
		const before = lanes.slice();

		const incoming: number[] = [];
		for (let i = 0; i < before.length; i++)
			if (before[i] === commit.sha) incoming.push(i);

		let lane: number;
		if (incoming.length > 0) {
			lane = incoming[0]!;
		} else {
			// commit non raggiunto da nessuna corsia attiva: testa di una linea nuova
			lane = freeSlot();
			lanes[lane] = commit.sha;
			incoming.push(lane);
		}

		for (const i of incoming) if (i !== lane) lanes[i] = null;

		const [first, ...rest] = commit.parents;
		lanes[lane] = first ?? null;

		const outgoing: number[] = [];
		for (const parent of rest) {
			const existing = lanes.indexOf(parent);
			if (existing !== -1) {
				outgoing.push(existing);
				continue;
			}
			const slot = freeSlot();
			lanes[slot] = parent;
			outgoing.push(slot);
		}

		while (lanes.length > 0 && lanes[lanes.length - 1] === null)
			lanes.pop();

		rows.push({
			sha: commit.sha,
			lane,
			before: trimRight(before),
			after: lanes.slice(),
			incoming,
			outgoing,
		});
	}

	return rows;
}

/** Numero massimo di colonne da disegnare. */
export function graphWidth(rows: GraphRow[]): number {
	let width = 1;
	for (const row of rows) {
		width = Math.max(
			width,
			row.lane + 1,
			row.before.length,
			row.after.length
		);
	}
	return width;
}
