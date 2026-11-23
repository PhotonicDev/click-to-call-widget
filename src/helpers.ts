import { CallActionType } from "./types";
import type { CallState, CallAction, TranscriptionPayload } from "./types";
import type { TranscriptMessage } from "./components/TranscriptDisplay";

export const getLocalStore = (key: string) => {
	const item = localStorage.getItem(key);
	return item ? JSON.parse(item) : null;
};

export const setLocalStore = (key: string, value: unknown) => {
	if(!value) return
	return localStorage.setItem(key, JSON.stringify(value));
};

export const webrtcConfig = {
	expiryTime: 1000 * 60 * 5, // 5 minutes
	setConfig: (config: Record<string, string>) => {
		const configWithTimestamp = {
			...config,
			timestamp: Date.now(),
		};
		window.localStorage.setItem(
			"__COGNIGY_WEBRTC_CONFIG",
			JSON.stringify(configWithTimestamp)
		);
	},
	getConfig: () => {
		const config = window.localStorage.getItem("__COGNIGY_WEBRTC_CONFIG");
		if (config) {
			const configObject = JSON.parse(config);
			if (Date.now() - configObject?.timestamp < webrtcConfig.expiryTime) {
				return configObject;
			}
		}
		return null;
	},
};

export function randomId(prefix?: string): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	for (let i = 0; i < 8; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	if (prefix) {
		return `${prefix}-${result}`;
	}
	return result;
}

/** Same text from the same side within this window is a resend, not a new line. */
const TRANSCRIPT_DEDUPE_WINDOW_MS = 1000;

/**
 * Folds one `_transcription` payload into the transcript.
 *
 * A message with an `id` is a streamed line: it replaces the text of the bubble
 * with that id and originator in place (keeping its position), or appends a new
 * bubble when there is none yet. A message without an `id` is a complete line and
 * is appended, unless the same text from the same side arrived within the last
 * second. Returns `prev` itself when nothing changed.
 */
export function applyTranscription(
	prev: TranscriptMessage[],
	transcription: TranscriptionPayload,
	now: number = Date.now(),
): TranscriptMessage[] {
	const { originator, messages } = transcription ?? {};
	if (!Array.isArray(messages) || messages.length === 0) return prev;

	// Copy on first write so an all-no-op payload keeps the same array.
	let next: TranscriptMessage[] | null = null;
	const current = () => next ?? prev;
	const writable = () => {
		next ??= prev.slice();
		return next;
	};

	messages.forEach((msg, index) => {
		if (msg?.id) {
			if (typeof msg.text !== "string") return;
			const at = current().findIndex((m) => m.sourceId === msg.id && m.originator === originator);
			if (at === -1) {
				// Nothing to show yet; the line appears with its first text.
				if (!msg.text) return;
				writable().push({
					id: `${originator}:${msg.id}`,
					sourceId: msg.id,
					text: msg.text,
					originator,
					timestamp: now,
					final: !!msg.final,
				});
				return;
			}
			const existing = current()[at];
			const final = !!existing.final || !!msg.final;
			if (existing.text === msg.text && existing.final === final) return;
			writable()[at] = { ...existing, text: msg.text, final };
			return;
		}

		const isDuplicate = prev.some(
			(existing) =>
				existing.text === msg.text &&
				existing.originator === originator &&
				Math.abs(existing.timestamp - now) < TRANSCRIPT_DEDUPE_WINDOW_MS,
		);
		if (isDuplicate) return;
		writable().push({
			id: `${now}-${Math.random().toString(36).slice(2, 8)}-${index}`,
			text: msg.text,
			originator,
			timestamp: now,
		});
	});

	return next ?? prev;
}

export const shouldEnableEndCall = (status: string) =>
	["ringing", "answered", "failed"].includes(status);

export const initialCallState: CallState = {
	isCalling: false,
	isCallAnswered: false,
	isMuted: false,
	sessionStatus: undefined,
	transcriptMessages: [],
	remoteStream: null,
	localStream: null,
};

export function callReducer(state: CallState, action: CallAction): CallState {
	switch (action.type) {
		case CallActionType.START_CALL:
			return { ...state, isCalling: true };
		case CallActionType.CALL_ANSWERED:
			return { ...state, isCallAnswered: true };
		case CallActionType.END_CALL:
			return initialCallState;
		case CallActionType.SET_MUTED:
			return state.isMuted === action.muted ? state : { ...state, isMuted: action.muted };
		case CallActionType.SET_SESSION_STATUS:
			return state.sessionStatus === action.status ? state : { ...state, sessionStatus: action.status };
		case CallActionType.SET_REMOTE_STREAM:
			return { ...state, remoteStream: action.stream };
		case CallActionType.SET_LOCAL_STREAM:
			return { ...state, localStream: action.stream };
		case CallActionType.SET_STREAMS:
			return { ...state, remoteStream: action.remote, localStream: action.local };
		case CallActionType.SET_TRANSCRIPT_MESSAGES:
			return { ...state, transcriptMessages: action.messages };
		case CallActionType.UPDATE_TRANSCRIPT_MESSAGES: {
			const updated = action.updater(state.transcriptMessages);
			return updated === state.transcriptMessages ? state : { ...state, transcriptMessages: updated };
		}
		case CallActionType.SYNC_SESSION: {
			if (state.sessionStatus === action.status && state.isMuted === action.muted) return state;
			return { ...state, sessionStatus: action.status, isMuted: action.muted };
		}
		default:
			return state;
	}
}

// Previously appended a <link> on every mount with no cleanup/dedup, stacking a duplicate
// onto the host page on each destroy/re-init cycle.
export const ensureWidgetFontLoaded = (href: string) => {
	if (typeof document === "undefined") return;
	if (document.querySelector(`link[href="${href}"]`)) return;

	const font = document.createElement("link");
	font.href = href;
	font.rel = "stylesheet";
	document.head.appendChild(font);
};
