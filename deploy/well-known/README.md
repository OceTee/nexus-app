# Universal link files

Served from `https://app.nexus.example/.well-known/` (the portfolio host) so
`https://app.nexus.example/...` links open the app (TDD Section G, Deep linking).

- `assetlinks.json` (Android App Links): replace
  `REPLACE_WITH_RELEASE_SIGNING_CERT_SHA256` with the release key's SHA-256
  fingerprint (`keytool -list -v -keystore <release.keystore>` or the Play
  Console's App signing page). Debug builds are not verified, so links open a
  chooser instead.
- `apple-app-site-association` (iOS): replace `REPLACE_WITH_TEAM_ID` with the
  Apple Developer Team ID. Serve it as `application/json` with no extension and
  no redirects.

The app side is already configured in `apps/mobile/app.config.ts`
(`associatedDomains` and the Android `intentFilters` with `autoVerify`).
