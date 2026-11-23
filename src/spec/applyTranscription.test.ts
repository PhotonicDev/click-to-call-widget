import { describe, it, expect } from "vitest";
import { applyTranscription } from "../helpers";
import type { TranscriptMessage } from "../components/TranscriptDisplay";

const T0 = 1_000_000;

describe("applyTranscription", () => {
	describe("streamed lines (with id)", () => {
		it("appends a new bubble for an unseen id", () => {
			const next = applyTranscription([], { originator: "bot", messages: [{ text: "Hel", id: "t1" }] }, T0);

			expect(next).toEqual([
				{ id: "bot:t1", sourceId: "t1", text: "Hel", originator: "bot", timestamp: T0, final: false },
			]);
		});

		it("replaces the text of the bubble with the same id in place and marks it final", () => {
			let msgs = applyTranscription([], { originator: "bot", messages: [{ text: "Hel", id: "t1" }] }, T0);
			msgs = applyTranscription(msgs, { originator: "user", messages: [{ text: "Hi" }] }, T0 + 10);
			msgs = applyTranscription(msgs, { originator: "bot", messages: [{ text: "Hello", id: "t1" }] }, T0 + 20);
			msgs = applyTranscription(
				msgs,
				{ originator: "bot", messages: [{ text: "Hello there", id: "t1", final: true }] },
				T0 + 30,
			);

			expect(msgs.map((m) => [m.originator, m.text, m.final])).toEqual([
				["bot", "Hello there", true],
				["user", "Hi", undefined],
			]);
			// Same bubble identity and position: no reorder, no duplicate, original timestamp.
			expect(msgs[0].id).toBe("bot:t1");
			expect(msgs[0].timestamp).toBe(T0);
		});

		it("keeps a line final once it was marked final", () => {
			let msgs = applyTranscription([], { originator: "bot", messages: [{ text: "Done", id: "t1", final: true }] }, T0);
			msgs = applyTranscription(msgs, { originator: "bot", messages: [{ text: "Done.", id: "t1" }] }, T0 + 5);

			expect(msgs).toHaveLength(1);
			expect(msgs[0]).toMatchObject({ text: "Done.", final: true });
		});

		it("does not merge the same id across originators", () => {
			let msgs = applyTranscription([], { originator: "user", messages: [{ text: "Hi", id: "1" }] }, T0);
			msgs = applyTranscription(msgs, { originator: "bot", messages: [{ text: "Hello", id: "1" }] }, T0);

			expect(msgs.map((m) => [m.id, m.text])).toEqual([
				["user:1", "Hi"],
				["bot:1", "Hello"],
			]);
		});

		it("skips the 1s same-text dedupe for id'd lines", () => {
			let msgs = applyTranscription([], { originator: "bot", messages: [{ text: "Okay" }] }, T0);
			msgs = applyTranscription(msgs, { originator: "bot", messages: [{ text: "Okay", id: "t2" }] }, T0 + 100);

			expect(msgs.map((m) => m.text)).toEqual(["Okay", "Okay"]);
		});

		it("does not create a bubble for an empty first chunk", () => {
			const prev: TranscriptMessage[] = [];

			expect(applyTranscription(prev, { originator: "bot", messages: [{ text: "", id: "t1" }] }, T0)).toBe(prev);
		});

		it("returns the same array when an update changes nothing", () => {
			const prev = applyTranscription([], { originator: "bot", messages: [{ text: "Hi", id: "t1" }] }, T0);

			expect(applyTranscription(prev, { originator: "bot", messages: [{ text: "Hi", id: "t1" }] }, T0 + 1)).toBe(prev);
		});

		it("applies several updates to the same id within one payload", () => {
			const msgs = applyTranscription(
				[],
				{ originator: "bot", messages: [{ text: "A", id: "t1" }, { text: "AB", id: "t1", final: true }] },
				T0,
			);

			expect(msgs).toHaveLength(1);
			expect(msgs[0]).toMatchObject({ text: "AB", final: true });
		});

		it("does not mutate the previous array", () => {
			const prev = applyTranscription([], { originator: "bot", messages: [{ text: "Hi", id: "t1" }] }, T0);
			const snapshot = structuredClone(prev);

			applyTranscription(prev, { originator: "bot", messages: [{ text: "Hi there", id: "t1" }] }, T0 + 1);

			expect(prev).toEqual(snapshot);
		});
	});

	describe("complete lines (no id) — unchanged behaviour", () => {
		it("appends each message as a new bubble", () => {
			const msgs = applyTranscription([], { originator: "user", messages: [{ text: "a" }, { text: "b" }] }, T0);

			expect(msgs.map((m) => [m.originator, m.text, m.timestamp])).toEqual([
				["user", "a", T0],
				["user", "b", T0],
			]);
			expect(new Set(msgs.map((m) => m.id)).size).toBe(2);
			expect(msgs[0].sourceId).toBeUndefined();
		});

		it("drops the same text from the same side within 1s", () => {
			const prev = applyTranscription([], { originator: "bot", messages: [{ text: "Hi" }] }, T0);

			expect(applyTranscription(prev, { originator: "bot", messages: [{ text: "Hi" }] }, T0 + 999)).toBe(prev);
		});

		it("keeps the same text after 1s or from the other side", () => {
			let msgs = applyTranscription([], { originator: "bot", messages: [{ text: "Hi" }] }, T0);
			msgs = applyTranscription(msgs, { originator: "user", messages: [{ text: "Hi" }] }, T0 + 1);
			msgs = applyTranscription(msgs, { originator: "bot", messages: [{ text: "Hi" }] }, T0 + 1000);

			expect(msgs).toHaveLength(3);
		});

		it("returns the same array for an empty or malformed payload", () => {
			const prev: TranscriptMessage[] = [];

			expect(applyTranscription(prev, { originator: "bot", messages: [] }, T0)).toBe(prev);
			expect(applyTranscription(prev, { originator: "bot" } as never, T0)).toBe(prev);
			expect(applyTranscription(prev, undefined as never, T0)).toBe(prev);
		});
	});
});
