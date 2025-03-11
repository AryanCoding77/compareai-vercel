var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import dotenv from "dotenv";
import express2 from "express";
import { WebSocketServer, WebSocket } from "ws";

// server/routes.ts
import { createServer } from "http";

// server/auth.ts
import "dotenv/config";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session2 from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  feedback: () => feedback,
  insertFeedbackSchema: () => insertFeedbackSchema,
  insertMatchSchema: () => insertMatchSchema,
  insertUserSchema: () => insertUserSchema,
  matches: () => matches,
  users: () => users
});
import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  decimal
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  score: integer("score").notNull().default(0)
});
var matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id").notNull(),
  invitedId: integer("invited_id").notNull(),
  creatorPhoto: text("creator_photo").notNull(),
  invitedPhoto: text("invited_photo"),
  creatorScore: decimal("creator_score", { precision: 10, scale: 3 }),
  invitedScore: decimal("invited_score", { precision: 10, scale: 3 }),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  feedback: text("feedback").notNull(),
  name: text("name"),
  email: text("email"),
  message: text("message"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
}).extend({
  acceptPolicy: z.boolean()
}).refine((data) => data.username.length > 0, {
  message: "Username is required",
  path: ["username"]
}).refine((data) => data.password.length > 0, {
  message: "Password is required",
  path: ["password"]
}).refine((data) => data.acceptPolicy === true, {
  message: "You must accept the privacy policy",
  path: ["acceptPolicy"]
});
var insertMatchSchema = createInsertSchema(matches);
var insertFeedbackSchema = createInsertSchema(feedback).pick({
  userId: true,
  feedback: true,
  name: true,
  email: true,
  message: true
}).refine((data) => data.feedback.length > 0, {
  message: "Feedback is required",
  path: ["feedback"]
});

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle({ client: pool, schema: schema_exports });
var initDb = async () => {
  try {
    const queries = [
      // Create users table if not exists
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0
      )`,
      // Create matches table if not exists
      `CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        creator_id INTEGER NOT NULL,
        invited_id INTEGER NOT NULL,
        creator_photo TEXT NOT NULL,
        invited_photo TEXT,
        creator_score DECIMAL(10,3),
        invited_score DECIMAL(10,3),
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
      // Create feedback table if not exists
      `CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        feedback TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`
    ];
    for (const query of queries) {
      await pool.query(query);
    }
    try {
      await migrateDb();
    } catch (err) {
      console.warn("Migration warning (non-critical):", err.message);
    }
    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Error initializing database tables:", error);
    throw error;
  }
};
var migrateDb = async () => {
  try {
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'feedback' AND column_name = 'name'
    `;
    const { rows } = await pool.query(checkColumnQuery);
    if (rows.length === 0) {
      console.log("Running feedback table migration...");
      const migrationQueries = [
        // Add new columns to the feedback table
        `ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "name" text`,
        `ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "email" text`,
        `ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "message" text`,
        // Update existing records to extract structured data if possible
        `UPDATE "feedback"
        SET 
          "name" = CASE 
            WHEN "feedback" ~ 'Name/Username:\\s*(.+?)(?=\\n|$)' 
            THEN regexp_replace("feedback", '.*Name/Username:\\s*(.+?)(?=\\n|$).*', '\\1', 'g')
            ELSE NULL
          END,
          "email" = CASE 
            WHEN "feedback" ~ 'Email:\\s*(.+?)(?=\\n|$)' 
            THEN regexp_replace("feedback", '.*Email:\\s*(.+?)(?=\\n|$).*', '\\1', 'g')
            ELSE NULL
          END,
          "message" = CASE 
            WHEN "feedback" ~ 'Message:\\s*(.+?)(?=\\n|$)' 
            THEN regexp_replace("feedback", '.*Message:\\s*(.+?)(?=\\n|$).*', '\\1', 'g')
            ELSE NULL
          END
        WHERE "feedback" LIKE '%Name/Username:%' OR "feedback" LIKE '%Email:%' OR "feedback" LIKE '%Message:%'`
      ];
      for (const query of migrationQueries) {
        await pool.query(query);
      }
      console.log("Feedback table migration completed successfully");
    } else {
      console.log("Feedback table already has the required columns");
    }
    return true;
  } catch (error) {
    console.error("Error migrating database:", error);
    throw error;
  }
};
initDb().catch(console.error);

// server/storage.ts
import { eq, or, desc } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { sql } from "drizzle-orm";
var PostgresSessionStore = connectPg(session);
var DatabaseStorage = class {
  sessionStore;
  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool,
      createTableIfMissing: true
    });
  }
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByUsername(username) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }
  async createUser(insertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  async updateUserScore(id) {
    await db.update(users).set({ score: sql`${users.score} + 1` }).where(eq(users.id, id));
  }
  async createMatch(match) {
    const [newMatch] = await db.insert(matches).values(match).returning();
    global.app?.broadcast({
      type: "match_created",
      match: newMatch
    });
    return newMatch;
  }
  async getMatch(id) {
    const [match] = await db.select().from(matches).where(eq(matches.id, id));
    return match;
  }
  async updateMatch(id, data) {
    const [updatedMatch] = await db.update(matches).set(data).where(eq(matches.id, id)).returning();
    if (!updatedMatch) throw new Error("Match not found");
    global.app?.broadcast({
      type: "match_updated",
      match: updatedMatch
    });
    return updatedMatch;
  }
  async getUserMatches(userId) {
    return db.select().from(matches).where(or(eq(matches.creatorId, userId), eq(matches.invitedId, userId))).orderBy(desc(matches.createdAt));
  }
  async getLeaderboard(limit = 100) {
    return db.select().from(users).orderBy(desc(users.score)).limit(limit);
  }
  async saveFeedback(userId, feedbackText, name, email, message) {
    try {
      try {
        const [result] = await db.insert(feedback).values({
          userId: userId || null,
          feedback: feedbackText,
          name: name || null,
          email: email || null,
          message: message || null
        }).returning();
        return result;
      } catch (error) {
        if (error.message && error.message.includes("column") && error.message.includes("does not exist")) {
          console.log(
            "Falling back to basic feedback structure (without name, email, message columns)"
          );
          const [result] = await db.insert(feedback).values({
            userId: userId || null,
            feedback: feedbackText
          }).returning();
          return result;
        }
        throw error;
      }
    } catch (error) {
      console.error("Error saving feedback:", error);
      throw error;
    }
  }
  async deleteUserMatches(userId) {
    await db.delete(matches).where(or(eq(matches.creatorId, userId), eq(matches.invitedId, userId)));
  }
};
var storage = new DatabaseStorage();

// server/auth.ts
var scryptAsync = promisify(scrypt);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${buf.toString("hex")}.${salt}`;
}
async function comparePasswords(supplied, stored) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = await scryptAsync(supplied, salt, 64);
  return timingSafeEqual(hashedBuf, suppliedBuf);
}
function setupAuth(app2) {
  const sessionSettings = {
    secret: process.env.SESSION_SECRET || process.env.REPL_ID || "fallback-secret",
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      secure: app2.get("env") === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1e3
      // 30 days
    }
  };
  if (app2.get("env") === "production") {
    app2.set("trust proxy", 1);
  }
  app2.use(session2(sessionSettings));
  app2.use(passport.initialize());
  app2.use(passport.session());
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !await comparePasswords(password, user.password)) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    })
  );
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
  app2.post("/api/register", async (req, res, next) => {
    try {
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const user = await storage.createUser({
        ...req.body,
        password: await hashPassword(req.body.password)
      });
      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Authentication failed" });
      }
      req.login(user, (err2) => {
        if (err2) return next(err2);
        res.status(200).json(user);
      });
    })(req, res, next);
  });
  app2.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });
  app2.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json(req.user);
  });
}

// server/routes.ts
import multer from "multer";
import path from "path";

// server/services/facepp.ts
import { Blob } from "buffer";
import { promisify as promisify2 } from "util";
var sleep = promisify2(setTimeout);
var FACEPP_API_URL = "https://api-us.faceplusplus.com/facepp/v3";
var MAX_RETRIES = 3;
var RETRY_DELAY = 1e3;
async function makeRequest(formData, retryCount = 0) {
  try {
    const response = await fetch(`${FACEPP_API_URL}/detect`, {
      method: "POST",
      body: formData,
      headers: {
        "Accept": "application/json",
        "Max-Image-Pixels": "1166400"
        // Allows for 1080x1080 images
      }
    });
    if (!response.ok) {
      const error = await response.text();
      if (error.includes("CONCURRENCY_LIMIT_EXCEEDED") && retryCount < MAX_RETRIES) {
        await sleep(RETRY_DELAY * (retryCount + 1));
        return makeRequest(formData, retryCount + 1);
      }
      throw new Error(`Face++ API error: ${error}`);
    }
    const data = await response.json();
    if (!data.faces?.[0]?.attributes?.beauty) {
      throw new Error("No face detected in the image");
    }
    const beauty = data.faces[0].attributes.beauty;
    return (beauty.male_score + beauty.female_score) / 2;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      await sleep(RETRY_DELAY * (retryCount + 1));
      return makeRequest(formData, retryCount + 1);
    }
    throw error;
  }
}
async function analyzeFace(photoBase64) {
  const formData = new FormData();
  const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const blob = new Blob([buffer]);
  formData.append("api_key", process.env.FACEPP_API_KEY);
  formData.append("api_secret", process.env.FACEPP_API_SECRET);
  formData.append("image_file", blob);
  formData.append("return_attributes", "beauty");
  return makeRequest(formData);
}

// server/routes.ts
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  // 50MB limit to accommodate larger images
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Only jpeg, jpg and png files are allowed"));
    }
  }
}).single("photo");
var uploadMiddleware = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File is too large. Maximum size is 25MB" });
      }
      return res.status(400).json({ message: err.message });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};
function registerRoutes(app2) {
  setupAuth(app2);
  app2.post("/api/matches", uploadMiddleware, async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!req.file) return res.status(400).send("No photo uploaded");
    const invitedUser = await storage.getUserByUsername(
      req.body.invitedUsername
    );
    if (!invitedUser) return res.status(404).send("Invited user not found");
    const match = await storage.createMatch({
      creatorId: req.user.id,
      invitedId: invitedUser.id,
      creatorPhoto: req.file.buffer.toString("base64"),
      status: "pending",
      createdAt: /* @__PURE__ */ new Date()
    });
    res.json(match);
  });
  app2.post("/api/matches/:id/respond", uploadMiddleware, async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const match = await storage.getMatch(parseInt(req.params.id));
    if (!match) return res.status(404).send("Match not found");
    if (match.invitedId !== req.user.id)
      return res.status(403).send("Not authorized");
    const accept = req.body.accept === "true";
    if (!accept) {
      await storage.updateMatch(match.id, { status: "declined" });
      return res.sendStatus(200);
    }
    if (!req.file) return res.status(400).send("No photo uploaded");
    await storage.updateMatch(match.id, {
      invitedPhoto: req.file.buffer.toString("base64"),
      status: "ready"
    });
    res.sendStatus(200);
  });
  app2.post("/api/matches/:id/compare", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const match = await storage.getMatch(parseInt(req.params.id));
      if (!match) return res.status(404).send("Match not found");
      if (match.creatorId !== req.user.id)
        return res.status(403).send("Not authorized");
      if (match.status !== "ready")
        return res.status(400).send("Match not ready for comparison");
      try {
        console.log("Analyzing creator photo...");
        const creatorScore = await analyzeFace(match.creatorPhoto);
        console.log("Creator photo analysis complete:", creatorScore);
        await new Promise((resolve) => setTimeout(resolve, 500));
        console.log("Analyzing invited photo...");
        const invitedScore = await analyzeFace(match.invitedPhoto);
        console.log("Invited photo analysis complete:", invitedScore);
        const winner = creatorScore > invitedScore ? match.creatorId : match.invitedId;
        await storage.updateUserScore(winner);
        await storage.updateMatch(match.id, {
          creatorScore,
          invitedScore,
          status: "completed"
        });
        res.json({ creatorScore, invitedScore });
      } catch (error) {
        console.error("Face++ API Error:", error);
        if (error instanceof Error) {
          res.status(400).json({ message: error.message });
        } else {
          res.status(500).json({
            message: "An unexpected error occurred during face analysis"
          });
        }
      }
    } catch (error) {
      console.error("Server Error:", error);
      res.status(500).json({ message: "An unexpected error occurred" });
    }
  });
  app2.get("/api/matches", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const matches2 = await storage.getUserMatches(req.user.id);
    res.json(matches2);
  });
  app2.delete("/api/matches", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    await storage.deleteUserMatches(req.user.id);
    res.sendStatus(200);
  });
  app2.get("/api/matches/:id", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const match = await storage.getMatch(parseInt(req.params.id));
    if (!match) return res.status(404).send("Match not found");
    if (match.creatorId !== req.user.id && match.invitedId !== req.user.id) {
      return res.status(403).send("Not authorized");
    }
    res.json(match);
  });
  app2.get("/api/leaderboard", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const leaderboard = await storage.getLeaderboard(limit);
    res.json(leaderboard);
  });
  app2.post("/api/feedback", async (req, res) => {
    try {
      if (!req.body.feedback) {
        return res.status(400).json({
          success: false,
          message: "Feedback is required"
        });
      }
      const userId = req.user ? req.user.id : null;
      let name = null;
      let email = null;
      let message = null;
      const feedbackText = req.body.feedback;
      const nameMatch = feedbackText.match(/Name\/Username:\s*(.+?)(?=\n|$)/);
      if (nameMatch && nameMatch[1]) {
        name = nameMatch[1].trim();
      }
      const emailMatch = feedbackText.match(/Email:\s*(.+?)(?=\n|$)/);
      if (emailMatch && emailMatch[1]) {
        email = emailMatch[1].trim();
      }
      const messageMatch = feedbackText.match(/Message:\s*(.+?)(?=\n|$)/);
      if (messageMatch && messageMatch[1]) {
        message = messageMatch[1].trim();
      }
      console.log("Received feedback:", feedbackText);
      console.log("Parsed fields:", { name, email, message });
      let result;
      let savedToDatabase = true;
      try {
        result = await storage.saveFeedback(
          userId,
          feedbackText,
          name,
          email,
          message
        );
      } catch (dbError) {
        console.error("Database error:", dbError);
        savedToDatabase = false;
      }
      res.status(201).json({
        success: true,
        message: savedToDatabase ? "Feedback submitted successfully" : "Feedback received (will be saved when database is available)",
        data: result || {
          feedback: feedbackText,
          name,
          email,
          message
        }
      });
    } catch (error) {
      console.error("Error submitting feedback:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to submit feedback"
      });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path3, { dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path2, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var vite_config_default = defineConfig({
  plugins: [react(), runtimeErrorOverlay(), themePlugin()],
  resolve: {
    alias: {
      "@": path2.resolve(__dirname, "client", "src"),
      "@shared": path2.resolve(__dirname, "shared")
    }
  },
  root: path2.resolve(__dirname, "client"),
  build: {
    outDir: path2.resolve(__dirname, "dist/public"),
    emptyOutDir: true
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname2(__filename2);
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        __dirname2,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path3.resolve(__dirname2, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}

// server/index.ts
import cors from "cors";
dotenv.config();
var app = express2();
global.app = app;
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
var clients = /* @__PURE__ */ new Set();
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = registerRoutes(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws2) => {
    log("New WebSocket client connected");
    clients.add(ws2);
    ws2.on("error", (error) => {
      log(`WebSocket error: ${error.message}`);
    });
    ws2.on("close", () => {
      log("WebSocket client disconnected");
      clients.delete(ws2);
    });
    ws2.send(JSON.stringify({ type: "connected" }));
  });
  app.broadcast = (message) => {
    const messageStr = JSON.stringify(message);
    const deadClients = /* @__PURE__ */ new Set();
    clients.forEach((client) => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        } else if (client.readyState === WebSocket.CLOSED) {
          deadClients.add(client);
        }
      } catch (error) {
        log(`Broadcast error: ${error}`);
        deadClients.add(client);
      }
    });
    deadClients.forEach((client) => {
      clients.delete(client);
    });
  };
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    log(`Error: ${status} - ${message}`);
    res.status(status).json({ message });
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const PORT = process.env.PORT || 5e3;
  server.listen(PORT, () => {
    log(`Server running on port ${PORT}`);
    log("WebSocket server initialized");
  });
})();
