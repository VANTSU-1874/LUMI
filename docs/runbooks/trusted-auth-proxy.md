# Trusted authentication proxy contract

Production authentication routes must be reachable only through a trusted reverse proxy. Direct access to the application port must be blocked by the network or host firewall.

For every authentication request, the proxy must:

1. Remove any client-supplied `x-tonggan-source-*` and forwarding headers with the same names.
2. Derive a stable source identifier from the proxy's trusted connection metadata. It may contain only letters, digits, `.`, `_`, `:`, or `-`, up to 128 characters.
3. Set `x-tonggan-source-id` and the current Unix timestamp in `x-tonggan-source-timestamp`.
4. Set `x-tonggan-source-signature` to the lowercase hex HMAC-SHA256 of `sourceId + "\0" + timestamp`, keyed by `AUTH_PROXY_SECRET`.
5. Reject `Sec-Fetch-Site: cross-site` and any browser `Origin` that does not exactly match the externally requested HTTPS origin. After that check, rewrite `Host` and `Origin` to the loopback upstream origin while rebuilding `X-Forwarded-Host` and `X-Forwarded-Proto`; this lets the application repeat a same-origin check without trusting client forwarding headers.

The proxy and application must receive the same independently generated secret of at least 32 characters. Rotate it as a coordinated deployment. Signed timestamps are accepted for at most 60 seconds, so proxy and application clocks must be synchronized.

The application deliberately ignores `X-Forwarded-For`. Missing, expired, partial, or invalid signed-source headers are rejected in production. Development and test environments may omit the headers and use the explicit `local-development` fallback bucket.
