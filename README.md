# ANEMART — complete starter platform

This project rebuilds the truncated single-page HTML as a Node.js + Express + SQLite application. It includes public listings and filters, application intake, manual payment-reference submissions, an admin dashboard, WhatsApp links, and a service worker for offline shell caching.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Copy `.env.example` to `.env`.
2. Set a strong `SESSION_SECRET` and a unique `ADMIN_PASSWORD` of at least 12 characters. Do not use the example password in production.
3. Fill in the verified Airtel Money and MTN MoMo recipient names/numbers, and WhatsApp contact numbers. WhatsApp values must be digits only including country code, for example `26097XXXXXXX` (replace with the real number).
4. Install dependencies and start:
   ```sh
   npm install
   npm start
   ```
5. Open `http://localhost:3000` for the public site and `http://localhost:3000/admin` for the admin dashboard.

On first start, an initial admin account is created only if no admin exists and `ADMIN_PASSWORD` is set to at least 12 characters. The database is stored in `data/anemart.sqlite`. Keep backups of that directory.

## Admin tasks
- Create listings and set prices, status, images, and private landlord contact details.
- Review applications.
- Check mobile-money transaction details in the relevant account before setting payment status to **verified**.
- Landlord contacts are served only by `/api/contact/:applicationReference/:listingId` after the referenced application has `payment_status = verified`.

## Important production work before launch
This is a usable starter, not a payment processor or a fully audited production deployment.
- Deploy behind HTTPS; set `NODE_ENV=production`, a long random `SESSION_SECRET`, and secure hosting/backups.
- Replace all placeholder payment details with verified official details. Never request a mobile-money PIN or password.
- Configure the two real WhatsApp numbers.
- Add a proper CSRF defense/origin validation for all cookie-authenticated state-changing routes before public deployment, and test rate limits against your expected traffic.
- Set up database backups, monitoring, dependency updates, and a process manager or managed Node hosting.
- For higher assurance, add per-student authentication/ownership checks to the contact-release flow. In this starter, possession of a valid application reference plus a verified payment status gates the contact endpoint; treat application references as confidential.
- No automatic mobile-money API integration is included. Admin verification is manual, and entering a transaction reference does not prove that money was received.
- The starter has a single initial administrator. Add admin account management and password reset procedures before multiple staff use it.
- Only upload photos you have permission to use. Image paths can be local files under `public/` or HTTPS URLs.

## Demo listings
The three listings from the supplied snippet are inserted as demo records on first run. Their photos were not supplied in the pasted code, so image placeholders will appear until you add the files under `public/assets/` or update the image URLs in Admin. Demo availability and pricing must be checked before the website is published.
