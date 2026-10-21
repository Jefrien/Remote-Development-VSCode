# Security Policy

## Supported versions

Security fixes target the latest version on the `main` branch and the latest
published extension release.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
**Report a vulnerability** private advisory flow for this repository, or
contact the maintainer privately through the address listed on the GitHub
profile.

Include:

- a clear description and severity assessment;
- affected version or commit;
- reproduction steps or a minimal proof of concept;
- impact and suggested mitigation, if known.

Please allow time for investigation before public disclosure. Do not include
real credentials, private keys, customer data, or private server addresses in
the report.

## Security design notes

- Passwords are stored in VS Code SecretStorage, not persisted in the JSON configuration.
- Plain FTP is disabled; FTP connections require TLS.
- SFTP host keys require explicit trust and fingerprints are persisted only when requested.
- Remote operations are constrained to the configured base directory.
- Downloaded files are constrained to the extension's temporary directory.
