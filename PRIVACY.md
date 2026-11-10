# Privacy Policy for Squirrel

**Last updated:** October 2026

Squirrel ("we", "our", or "the application") is an open-source, local-first desktop application designed to synchronize folders and files across multiple cloud storage providers (such as Google Drive, OneDrive, Dropbox, and MEGA).

Your privacy is our utmost priority. This Privacy Policy describes how Squirrel handles your information.

---

## 1. Local-First Architecture

- **No Remote Servers:** Squirrel does not maintain, host, or communicate with any centralized proprietary servers, databases, or analytics services. All sync operations, file comparisons, and transfers occur directly between your personal computer and the respective cloud storage APIs you connect to.
- **No Telemetry or Tracking:** Squirrel does not collect, log, track, or share your usage data, file metadata, IP addresses, or personal identity with any third parties.

---

## 2. Google API Data & Scopes

Squirrel integrates with Google APIs using OAuth 2.0.

- **Limited Scope Access:** Squirrel requests only the following restricted scope:
  `https://www.googleapis.com/auth/drive.file`
- **What this means:** Squirrel **only** has access to files and folders that were directly created or opened by Squirrel itself (typically inside the designated `Squirrel` folder on your Google Drive). 
- **What Squirrel CANNOT access:** Squirrel **cannot** view, read, modify, or delete any of your other personal Google Drive documents, photos, spreadsheets, emails, or personal data.
- **Limited Use Compliance:** Squirrel's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

---

## 3. Storage of Credentials & Tokens

- **Local Storage:** All authentication tokens, OAuth refresh tokens, and session credentials are stored solely on your local hard drive inside the application's local configuration directory (`config/`).
- **Token Security:** Tokens are never transmitted to any third-party server or shared with other services. They are only exchanged directly over secure HTTPS connections with official provider endpoints (e.g., `oauth2.googleapis.com`).
- **Disconnection & Data Erasure:** You can disconnect your account at any time via the application interface (Clicking "Disconnect" under Cloud Accounts) or by manually removing the files in the local `config/` directory. Disconnecting immediately revokes session access and deletes all saved tokens from your computer.

---

## 4. Third-Party Cloud Services

When you connect cloud services (Google Drive, Microsoft OneDrive, Dropbox, MEGA), your use of those services is governed by their respective privacy policies and terms of service:
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Microsoft Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement)
- [Dropbox Privacy Policy](https://www.dropbox.com/privacy)
- [MEGA Privacy Policy](https://mega.io/privacy)

---

## 5. Open Source Transparency

Squirrel is free and open-source software. You are encouraged to inspect, review, and audit the complete source code on GitHub to verify how your data and credentials are handled.

---

## 6. Contact & Support

If you have questions or concerns about this Privacy Policy or Squirrel's data handling practices, please open an issue on the official GitHub repository:
- **GitHub Repository:** [https://github.com/ardagulbay/Squirrel](https://github.com/ardagulbay/Squirrel) (or your fork's issues page)
