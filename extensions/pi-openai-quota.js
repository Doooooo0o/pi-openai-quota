import { pathToFileURL } from "node:url";

const STATUS_KEY = "pi-openai-quota";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_MS = 60_000;
const MAX_RESPONSE_BYTES = 1_000_000;

function tokenClaims(token) {
	try {
		return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
}

function accountId(token) {
	const id = tokenClaims(token)?.["https://api.openai.com/auth"]?.chatgpt_account_id;
	return typeof id === "string" && /^[\w-]{1,128}$/.test(id) ? id : undefined;
}

function clientId(token) {
	const claims = tokenClaims(token);
	const scopes = typeof claims?.scope === "string" ? claims.scope.split(/\s+/) : [];
	return claims?.iss === "https://auth.openai.com"
		&& claims?.aud === "https://api.openai.com/v1"
		&& scopes.includes("chatgpt.tokens.use.direct")
		&& typeof claims?.client_id === "string"
		&& /^oaiapp_[\w-]+$/.test(claims.client_id)
		? claims.client_id
		: undefined;
}

async function tokenFor(ctx, provider) {
	const result = await ctx.modelRegistry.getProviderAuth(provider);
	if (result?.source !== "OAuth") return undefined;
	const auth = result.auth ?? {};
	if (typeof auth.apiKey === "string" && auth.apiKey) return auth.apiKey;

	const authorization = typeof auth.headers?.get === "function"
		? auth.headers.get("authorization")
		: Object.entries(auth.headers ?? {}).find(([name]) => name.toLowerCase() === "authorization")?.[1];
	return typeof authorization === "string" ? authorization.match(/^Bearer\s+(.+)$/i)?.[1] : undefined;
}

async function readJson(response) {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("OpenAI response is too large");
	if (!response.body) throw new Error("OpenAI returned an empty response");

	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error("OpenAI response is too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, size)));
}

export function formatQuota(value, now = Date.now()) {
	const rateLimit = value && typeof value === "object" ? value.rate_limit : undefined;
	const windows = rateLimit && typeof rateLimit === "object"
		? [rateLimit.primary_window, rateLimit.secondary_window]
		: [];
	const quotas = windows.flatMap((window) => {
		if (!window || typeof window !== "object") return [];
		const seconds = Number(window.limit_window_seconds);
		const used = Number(window.used_percent);
		if (!(seconds > 0) || !Number.isFinite(used)) return [];
		const resetAt = Number(window.reset_at);
		const resetAfter = Number(window.reset_after_seconds);
		const reset = new Date(Number.isFinite(resetAt) && resetAt > 0
			? resetAt * 1000
			: window.reset_after_seconds != null && Number.isFinite(resetAfter) && resetAfter >= 0
				? now + resetAfter * 1000
				: NaN);
		const label = seconds >= 86_400 ? `${Math.round(seconds / 86_400)}d` : `${Math.round(seconds / 3_600)}h`;
		const date = seconds >= 86_400
			? `${reset.getFullYear()}-${String(reset.getMonth() + 1).padStart(2, "0")}-${String(reset.getDate()).padStart(2, "0")} `
			: "";
		return [{
			label,
			remaining: Math.round(Math.max(0, Math.min(100, 100 - used))),
			reset: Number.isNaN(reset.getTime()) ? "" : ` ↻ ${date}${reset.toTimeString().slice(0, 5)}`,
		}];
	});
	if (!quotas.length) throw new Error("Unknown OpenAI quota response format");
	return {
		text: `GPT ${quotas.map(({ label, remaining, reset }) => `${label} ${remaining}%${reset}`).join(" · ")}`,
		minimum: Math.min(...quotas.map(({ remaining }) => remaining)),
	};
}

async function fetchJson(token, url) {
	const id = accountId(token);
	const response = await fetch(url, {
		signal: AbortSignal.timeout(8_000),
		redirect: "error",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			...(id ? { "ChatGPT-Account-Id": id } : {}),
		},
	});
	if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
	return readJson(response);
}

async function fetchQuota(ctx) {
	const [openAIToken, codexToken] = await Promise.all([
		tokenFor(ctx, "openai"),
		tokenFor(ctx, "openai-codex"),
	]);
	if (!openAIToken && !codexToken) throw new Error("OpenAI is not logged in");
	if (!openAIToken) return formatQuota(await fetchJson(codexToken, USAGE_URL));

	const appId = clientId(openAIToken);
	if (!appId) throw new Error("OpenAI Sign in with ChatGPT token not found");
	if (!codexToken) {
		throw new Error("Run /login openai-codex once with the same ChatGPT account; keep OpenAI active");
	}
	const [usage, apps] = await Promise.all([
		fetchJson(codexToken, USAGE_URL),
		fetchJson(codexToken, `${USAGE_URL}/chatpass/apps`),
	]);
	const matches = Array.isArray(apps?.items) ? apps.items.filter((app) => app?.id === appId) : [];
	if (matches.length !== 1) {
		throw new Error("OpenAI and OpenAI Codex must use the same ChatGPT account/workspace");
	}
	return formatQuota(usage);
}

export default function piOpenAIQuota(pi) {
	let lastFetch = 0;
	let refreshTimer;

	const update = async (ctx, force = false) => {
		if (!ctx.hasUI || (!force && Date.now() - lastFetch < CACHE_MS)) return;
		lastFetch = Date.now();
		try {
			const quota = await fetchQuota(ctx);
			const color = quota.minimum <= 10 ? "error" : quota.minimum <= 25 ? "warning" : "success";
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, quota.text));
			if (force) ctx.ui.notify(quota.text, "info");
		} catch (error) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "GPT quota ?"));
			if (force) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		await update(ctx);
		refreshTimer = setInterval(() => void update(ctx), CACHE_MS);
		refreshTimer.unref?.();
	});
	pi.on("turn_end", async (_event, ctx) => update(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		clearInterval(refreshTimer);
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
	pi.registerCommand("openai-quota", {
		description: "Refresh the OpenAI/ChatGPT quota shown in the footer",
		handler: async (_args, ctx) => update(ctx, true),
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const now = new Date(2030, 0, 2, 10).getTime();
	const sample = formatQuota({ rate_limit: {
		primary_window: {
			limit_window_seconds: 18_000,
			used_percent: 23,
			reset_at: new Date(2030, 0, 2, 15, 30).getTime() / 1000,
		},
		secondary_window: { limit_window_seconds: 604_800, used_percent: 61, reset_after_seconds: 3_600 },
	} }, now);
	const handlers = new Map();
	let command;
	piOpenAIQuota({ on: (event, handler) => handlers.set(event, handler), registerCommand: (name) => { command = name; } });
	await handlers.get("session_start")({}, { hasUI: false });
	await handlers.get("session_shutdown")({}, { ui: { setStatus() {} } });
	if (sample.text !== "GPT 5h 77% ↻ 15:30 · 7d 39% ↻ 2030-01-02 11:00" || sample.minimum !== 39 || command !== "openai-quota" || handlers.size !== 3) {
		throw new Error("self-check failed");
	}
	console.log("pi-openai-quota: ok");
}
