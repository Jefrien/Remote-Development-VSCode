# Changelog

All notable changes to Remote Development are documented here.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Added contributor documentation, issue templates, and CI validation.
- Added manually selectable English and Spanish extension language.
- Improved security, path validation, reconnect behavior, and FTPS/SFTP handling.

## [1.2.8]

- Fixed SFTP host-key trust flow to pause the handshake while the user decides.
- Fixed `Trust once` and `Trust always` failures caused by a second connection attempt.
- Prevented stale SFTP clients from being reused after host-key rejection.

## [1.2.4]

- Added host-key trust prompts for SFTP.
- Stored passwords in VS Code SecretStorage.
- Added remote base-directory and local temporary-directory safeguards.
- Added reconnect handling for interrupted FTP/SFTP sessions.
