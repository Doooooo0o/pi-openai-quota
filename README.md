# pi-openai-quota

A dependency-free [pi](https://pi.dev) extension that keeps your remaining ChatGPT/Codex quota visible in the footer.

```text
GPT 5h 77% · 7d 39%
```

## Install

```bash
pi install git:github.com/Doooooo0o/pi-openai-quota
```

Run `/reload` if pi is already open. Authenticate with OpenAI Codex through pi's `/login` command if needed.

## Usage

The footer updates at startup and once per minute, including while the session is idle. Turns also trigger a refresh when the cached value is stale.

Run `/openai-quota` to force an immediate refresh. `GPT quota ?` means the request failed; the command displays the reason.

To uninstall:

```bash
pi remove git:github.com/Doooooo0o/pi-openai-quota
```

## Security and privacy

- No runtime dependencies, telemetry, subprocesses, or disk writes.
- Reads the OpenAI Codex OAuth token through pi's public authentication API.
- Sends that token only to `https://chatgpt.com/backend-api/wham/usage`.
- Refuses redirects, times out after 8 seconds, and limits responses to 1 MB.
- Never logs, displays, or persists the token.

The quota endpoint is undocumented and may change without notice. This project is not affiliated with or endorsed by OpenAI.

## Development

```bash
npm test
```

## License

[MIT](LICENSE)
