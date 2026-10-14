require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "anemart.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 location TEXT NOT NULL DEFAULT 'Near Ten Miles Campus', walk_minutes INTEGER NOT NULL DEFAULT 15,
 room_type TEXT NOT NULL DEFAULT 'shared', price_kwacha INTEGER NOT NULL CHECK(price_kwacha >= 0),
 capacity INTEGER NOT NULL DEFAULT 1, amenities TEXT NOT NULL DEFAULT '[]',
 image_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'available'
 CHECK(status IN ('available','few','full')), landlord_name TEXT NOT NULL DEFAULT '',
 landlord_phone TEXT NOT NULL DEFAULT '', featured INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE,
 listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
 full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
 preferred_area TEXT NOT NULL DEFAULT '', room_type TEXT NOT NULL DEFAULT 'any',
 message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new'
 CHECK(status IN ('new','contacted','matched','closed')),
 payment_status TEXT NOT NULL DEFAULT 'unpaid'
 CHECK(payment_status IN ('unpaid','pending','verified','rejected')),
 payment_method TEXT NOT NULL DEFAULT '', payment_reference TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, admin_username TEXT NOT NULL,
 action TEXT NOT NULL, record_type TEXT NOT NULL, record_id INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const adminCount = db.prepare("SELECT COUNT(*) AS n FROM admins").get().n;
if (!adminCount && process.env.ADMIN_PASSWORD) {
  const username = (process.env.ADMIN_USERNAME || "admin").trim();
  const password = process.env.ADMIN_PASSWORD;
  if (password.length < 12) {
    console.error("ADMIN_PASSWORD must be at least 12 characters. Admin was not created.");
  } else {
    db.prepare("INSERT INTO admins (username,password_hash) VALUES (?,?)")
      .run(username, bcrypt.hashSync(password, 12));
    console.log(`Created initial admin account "${username}". Change its password before public launch.`);
  }
}

const count = db.prepare("SELECT COUNT(*) AS n FROM listings").get().n;
if (!count) {
  const demo = [
    ["Twist Apartment","Student bedspaces in a shared boarding house.","Ten Miles Campus",15,"shared",900,4,["Shared kitchen","Water","Electricity details on request"],"assets/room-twin-beds.jpg","available",1],
    ["ZeeWorld Apartment","Shared room option near campus.","Ten Miles Campus",10,"shared",700,6,["Shared kitchen","Secure entrance"],"assets/bunk-room-1.jpg","available",1],
    ["Diana Boarding House","Shared student accommodation.","Ten Miles Campus",20,"shared",750,4,["Shared kitchen","Study-friendly"],"assets/shared-room.jpg","available",1]
  ];
  const insert = db.prepare(`INSERT INTO listings
    (name,description,location,walk_minutes,room_type,price_kwacha,capacity,amenities,image_url,status,featured)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(rows => rows.forEach(r => insert.run(...r.slice(0,7), JSON.stringify(r[7]), r[8], r[9], r[10])));
  tx(demo);
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  name: "anemart.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret-before-launch",
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  cookie: { httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use("/api/applications", rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));

function cleanText(v, max=500) { return String(v ?? "").trim().slice(0, max); }
function publicListing(row) {
  return {
    id: row.id, name: row.name, description: row.description, location: row.location,
    walk_minutes: row.walk_minutes, room_type: row.room_type, price_kwacha: row.price_kwacha,
    capacity: row.capacity, amenities: JSON.parse(row.amenities || "[]"),
    image_url: row.image_url, status: row.status, featured: !!row.featured
  };
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: "Admin login required." });
}
function audit(req, action, type, id) {
  db.prepare("INSERT INTO audit_log (admin_username,action,record_type,record_id) VALUES (?,?,?,?)")
    .run(req.session.admin.username, action, type, id || null);
}
app.get("/api/config", (_req, res) => res.json({
  fee_kwacha: Number(process.env.AGENT_FEE_KWACHA || 100),
  airtel_name: process.env.AIRTEL_MONEY_NAME || "ANEMART",
  airtel_number: process.env.AIRTEL_MONEY_NUMBER || "Contact ANEMART to confirm",
  mtn_name: process.env.MTN_MOMO_NAME || "ANEMART",
  mtn_number: process.env.MTN_MOMO_NUMBER || "Contact ANEMART to confirm",
  whatsapp_Anenyasha: process.env.WHATSAPP_ANENYASHA || "",
  whatsapp_Martin: process.env.WHATSAPP_MARTIN || ""
}));
app.get("/api/listings", (req, res) => {
  const q = cleanText(req.query.q, 100).toLowerCase();
  const type = cleanText(req.query.type, 30);
  const min = Number.isFinite(Number(req.query.min)) && req.query.min !== "" ? Number(req.query.min) : null;
  const max = Number.isFinite(Number(req.query.max)) && req.query.max !== "" ? Number(req.query.max) : null;
  let rows = db.prepare("SELECT * FROM listings WHERE active=1 ORDER BY featured DESC, id DESC").all();
  rows = rows.filter(r => (!q || [r.name,r.description,r.location].join(" ").toLowerCase().includes(q))
    && (!type || type === "all" || r.room_type === type)
    && (min === null || r.price_kwacha >= min)
    && (max === null || r.price_kwacha <= max));
  res.json(rows.map(publicListing));
});
app.get("/api/listings/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM listings WHERE id=? AND active=1").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Listing not found." });
  res.json(publicListing(row));
});
app.post("/api/applications", (req, res) => {
  const full_name = cleanText(req.body.full_name, 120);
  const phone = cleanText(req.body.phone, 40);
  const email = cleanText(req.body.email, 180);
  const preferred_area = cleanText(req.body.preferred_area, 180);
  const room_type = ["any","single","shared","ensuite"].includes(req.body.room_type) ? req.body.room_type : "any";
  const message = cleanText(req.body.message, 1000);
  const listing_id = req.body.listing_id ? Number(req.body.listing_id) : null;
  if (full_name.length < 2 || phone.replace(/\D/g, "").length < 9) {
    return res.status(400).json({ error: "Enter your name and a valid phone number." });
  }
  if (listing_id && !db.prepare("SELECT id FROM listings WHERE id=? AND active=1").get(listing_id)) {
    return res.status(400).json({ error: "That listing is no longer available." });
  }
  const reference = "ANE-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  db.prepare(`INSERT INTO applications (reference,listing_id,full_name,phone,email,preferred_area,room_type,message)
    VALUES (?,?,?,?,?,?,?,?)`).run(reference, listing_id, full_name, phone, email, preferred_area, room_type, message);
  res.status(201).json({ ok: true, reference, message: "Application received. Keep your reference number." });
});
app.post("/api/payment-submissions", (req, res) => {
  const reference = cleanText(req.body.application_reference, 30).toUpperCase();
  const method = ["Airtel Money","MTN MoMo"].includes(req.body.payment_method) ? req.body.payment_method : "";
  const txn = cleanText(req.body.payment_reference, 100);
  if (!reference || !method || txn.length < 3) return res.status(400).json({ error: "Enter your application reference, payment method and transaction reference." });
  const result = db.prepare(`UPDATE applications SET payment_status='pending',payment_method=?,payment_reference=?
    WHERE reference=?`).run(method, txn, reference);
  if (!result.changes) return res.status(404).json({ error: "Application reference not found. Check it and try again." });
  res.json({ ok: true, message: "Payment details submitted for manual verification. Contacts remain locked until an administrator verifies payment." });
});
app.get("/api/contact/:applicationReference/:listingId", (req, res) => {
  const appRef = cleanText(req.params.applicationReference, 30).toUpperCase();
  const appRow = db.prepare("SELECT * FROM applications WHERE reference=?").get(appRef);
  if (!appRow || appRow.payment_status !== "verified") return res.status(403).json({ error: "Payment must be verified before landlord contacts can be released." });
  if (Number(appRow.listing_id) !== Number(req.params.listingId)) return res.status(403).json({ error: "This application is not linked to that listing." });
  const listing = db.prepare("SELECT landlord_name,landlord_phone FROM listings WHERE id=? AND active=1").get(Number(req.params.listingId));
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  if (!listing.landlord_phone) return res.status(404).json({ error: "Landlord contact has not been added yet. Please contact ANEMART support." });
  res.set("Cache-Control", "no-store");
  res.json({ landlord_name: listing.landlord_name, landlord_phone: listing.landlord_phone });
});

app.post("/api/admin/login", rateLimit({ windowMs: 15*60*1000, limit: 8, standardHeaders: true, legacyHeaders: false }), (req,res) => {
  const username = cleanText(req.body.username, 100);
  const password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: "Invalid username or password." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start admin session." });
    req.session.admin = { id: admin.id, username: admin.username };
    res.json({ ok: true, username: admin.username });
  });
});
app.post("/api/admin/logout", requireAdmin, (req,res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/me", (req,res) => res.json({ authenticated: !!req.session.admin, username: req.session.admin?.username || "" }));
app.get("/api/admin/summary", requireAdmin, (_req,res) => res.json({
  listings: db.prepare("SELECT COUNT(*) n FROM listings WHERE active=1").get().n,
  applications: db.prepare("SELECT COUNT(*) n FROM applications").get().n,
  pending_payments: db.prepare("SELECT COUNT(*) n FROM applications WHERE payment_status='pending'").get().n,
  new_applications: db.prepare("SELECT COUNT(*) n FROM applications WHERE status='new'").get().n
}));
app.get("/api/admin/listings", requireAdmin, (_req,res) => res.json(db.prepare("SELECT * FROM listings ORDER BY id DESC").all()));
app.post("/api/admin/listings", requireAdmin, (req,res) => {
  const b=req.body;
  const name=cleanText(b.name,140), price=Number(b.price_kwacha), walk=Number(b.walk_minutes||15), capacity=Number(b.capacity||1);
  if (!name || !Number.isInteger(price) || price<0) return res.status(400).json({error:"Listing name and a valid whole-number price are required."});
  const type=["single","shared","ensuite"].includes(b.room_type)?b.room_type:"shared";
  const status=["available","few","full"].includes(b.status)?b.status:"available";
  const amenities=Array.isArray(b.amenities)?JSON.stringify(b.amenities.slice(0,20).map(x=>cleanText(x,80))):"[]";
  const result=db.prepare(`INSERT INTO listings(name,description,location,walk_minutes,room_type,price_kwacha,capacity,amenities,image_url,status,landlord_name,landlord_phone,featured,active)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(name,cleanText(b.description,1000),cleanText(b.location,180),Math.max(0,Math.min(240,walk)),type,price,Math.max(1,Math.min(100,capacity)),amenities,cleanText(b.image_url,500),status,cleanText(b.landlord_name,120),cleanText(b.landlord_phone,40),b.featured?1:0,b.active===false?0:1);
  audit(req,"create","listing",result.lastInsertRowid); res.status(201).json({id:result.lastInsertRowid});
});
app.put("/api/admin/listings/:id", requireAdmin, (req,res) => {
  const id=Number(req.params.id), b=req.body;
  const old=db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  if(!old) return res.status(404).json({error:"Listing not found."});
  const name=cleanText(b.name ?? old.name,140), price=Number(b.price_kwacha ?? old.price_kwacha);
  if(!name || !Number.isInteger(price) || price<0) return res.status(400).json({error:"Invalid listing name or price."});
  db.prepare(`UPDATE listings SET name=?,description=?,location=?,walk_minutes=?,room_type=?,price_kwacha=?,capacity=?,amenities=?,image_url=?,status=?,landlord_name=?,landlord_phone=?,featured=?,active=? WHERE id=?`)
  .run(name,cleanText(b.description ?? old.description,1000),cleanText(b.location ?? old.location,180),Number(b.walk_minutes ?? old.walk_minutes),["single","shared","ensuite"].includes(b.room_type)?b.room_type:old.room_type,price,Number(b.capacity ?? old.capacity),Array.isArray(b.amenities)?JSON.stringify(b.amenities):old.amenities,cleanText(b.image_url ?? old.image_url,500),["available","few","full"].includes(b.status)?b.status:old.status,cleanText(b.landlord_name ?? old.landlord_name,120),cleanText(b.landlord_phone ?? old.landlord_phone,40),b.featured?1:0,b.active===false?0:1,id);
  audit(req,"update","listing",id); res.json({ok:true});
});
app.delete("/api/admin/listings/:id", requireAdmin, (req,res) => {
  const id=Number(req.params.id);
  const result=db.prepare("UPDATE listings SET active=0 WHERE id=?").run(id);
  if(!result.changes) return res.status(404).json({error:"Listing not found."});
  audit(req,"archive","listing",id); res.json({ok:true});
});
app.get("/api/admin/applications", requireAdmin, (_req,res) => res.json(db.prepare(`SELECT a.*,l.name listing_name FROM applications a LEFT JOIN listings l ON l.id=a.listing_id ORDER BY a.created_at DESC`).all()));
app.patch("/api/admin/applications/:id", requireAdmin, (req,res) => {
  const id=Number(req.params.id), status=req.body.status, payment=req.body.payment_status;
  if(status && !["new","contacted","matched","closed"].includes(status)) return res.status(400).json({error:"Invalid application status."});
  if(payment && !["unpaid","pending","verified","rejected"].includes(payment)) return res.status(400).json({error:"Invalid payment status."});
  const old=db.prepare("SELECT id FROM applications WHERE id=?").get(id);
  if(!old) return res.status(404).json({error:"Application not found."});
  if(status) db.prepare("UPDATE applications SET status=? WHERE id=?").run(status,id);
  if(payment) db.prepare("UPDATE applications SET payment_status=? WHERE id=?").run(payment,id);
  audit(req,"update","application",id); res.json({ok:true});
});
app.get("/api/admin/audit", requireAdmin, (_req,res) => res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100").all()));

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/admin", (_req,res) => res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*", (req,res,next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found."});
  res.sendFile(path.join(__dirname,"public","index.html"), err => err && next(err));
});
app.listen(PORT, () => console.log(`ANEMART running at http://localhost:${PORT}`));
