# pi-openai-quota

A dependency-free [pi](https://pi.dev) extension that keeps your remaining ChatGPT/Codex quota visible in the footer.

```text
GPT 5h 77% ↻ 15:30 · 7d 39% ↻ 2030-01-02 09:00
```

## Install

```bash
pi install git:github.com/Doooooo0o/pi-openai-quota
```

Run `/reload` if pi is already open. With Pi's current **Sign in with ChatGPT** login, run `/login openai-codex` once with the same ChatGPT account/workspace; this companion login is used only to read quota, so keep `openai` as the active model provider.

## Usage

The footer updates at startup and once per minute, including while the session is idle. Turns also trigger a refresh when the cached value is stale. Renewal dates and times use your machine's local timezone.

Run `/openai-quota` to force an immediate refresh. `GPT quota ?` means the request failed; the command displays the reason.

To uninstall:

```bash
pi remove git:github.com/Doooooo0o/pi-openai-quota
```

## Security and privacy

- No runtime dependencies, telemetry, subprocesses, or disk writes.
- Reads OpenAI OAuth tokens through pi's public authentication API.
- Uses the active `openai` token only to identify its application locally; it is never sent to ChatGPT by this extension.
- Sends only the companion `openai-codex` token to `https://chatgpt.com/backend-api/wham/usage` and its `/chatpass/apps` subpath.
- Refuses redirects, times out after 8 seconds, and limits responses to 1 MB.
- Never logs, displays, or persists the token.

The quota endpoint is undocumented and may change without notice. This project is not affiliated with or endorsed by OpenAI.

## Development

```bash
npm test
```

## License

[MIT](LICENSE)
