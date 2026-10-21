# Remote Development for Visual Studio Code

**Optimize your workflow by connecting to remote FTP, SFTP/SSH servers directly from VS Code.**

This extension allows you to seamlessly connect to remote servers via **FTP, SFTP or SSH**, enabling you to manage files and folders as if they were local. It’s designed to boost your productivity while keeping your development environment clean and efficient.

---

## ✨ Features

- Connect to **FTP and SFTP/SSH servers** with ease.
- Upload and download files directly from the editor.
- Manage remote folders (create, rename, move, delete).
- Edit remote files without downloading the entire project.
- Copy file/folder paths for quick access.
- View file and folder contents in real-time.
- Temporary local caching of selected files for smooth integration with other VS Code extensions.

---

## 💙 Support the Project

If you find this extension useful, consider supporting its development:

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-blue.png)](https://www.buymeacoffee.com/jefrienalvn)
[![QR Code](https://github.com/user-attachments/assets/670c21ae-fccd-416d-b14b-34fe9d9c96bb)](https://www.buymeacoffee.com/jefrienalvn)

---

## 🔒 Configuration & Security

Server metadata is stored in a **JSON file** and passwords are stored in VS Code's encrypted
`SecretStorage`. Use the **Open configuration** command to edit the JSON. Passwords are shown
as plain text while the editor is open, but are removed from the persisted JSON when it is saved.
Legacy configurations containing plaintext passwords are migrated automatically when loaded.

### Example Configuration

```json
{
    "servers": [
        {
            "name": "SFTP/SSH Server Example",
            "host": "127.0.0.1",
            "username": "user_sftp",
            "port": 22,
            "path": "/",
            "type": "sftp",
            "hostFingerprint": "64-character SHA-256 hex fingerprint"
        },
        {
            "name": "FTP Server Example",
            "host": "localhost",
            "username": "user_ftp",
            "port": 21,
            "path": "/public_html/",
            "type": "ftp",
            "ftpSecure": true
        }
    ]
}
```

For SFTP, if `hostFingerprint` is empty or the server key changes, the extension shows
the received fingerprint and asks whether to trust it once or always. “Trust always”
stores the fingerprint in the configuration; a changed fingerprint is never accepted
silently. FTPS certificate validation remains enabled and plain FTP is rejected.
