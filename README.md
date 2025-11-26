# Remote Development for Visual Studio Code

**Optimize your workflow by connecting to remote SFTP/SSH servers directly from VS Code.**

This extension allows you to seamlessly connect to remote servers via **SFTP or SSH**, enabling you to manage files and folders as if they were local. It’s designed to boost your productivity while keeping your development environment clean and efficient.

---

## ✨ Features

- Connect to **SFTP/SSH servers** with ease.
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

Server configurations are stored in a **JSON file**. It is your responsibility to keep this file secure.

### Example Configuration

```json
{
    "servers": [
        {
            "name": "SFTP/SSH Server Example",
            "host": "127.0.0.1",
            "username": "user_sftp",
            "password": "password_sftp",
            "port": 22,
            "path": "/",
            "type": "sftp" // Defaults to SFTP if not specified
        },
        {
            "name": "FTP Server Example",
            "host": "localhost",
            "username": "user_ftp",
            "password": "password_ftp",
            "port": 21,
            "path": "/public_html/",
            "type": "ftp" // Currently, only SFTP/SSH are supported
        }
    ]
}
