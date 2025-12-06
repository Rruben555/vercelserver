const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();



const pool = require("./db"); // ← ini sudah bekerja sekarang
const app = express();
app.use(cors());
app.use(express.json());

function generateToken(user) {
  // pastikan ada process.env.JWT_SECRET di .env
  const payload = { user_id: user.user_id, username: user.username };
  return jwt.sign(payload, process.env.JWT_SECRET || "secret_dev", { expiresIn: "7d" });
}

// function getUserIdFromAuthHeader(req) {
//   try {
//     const auth = req.headers.authorization || "";
//     if (!auth.startsWith("Bearer ")) return null;
//     const token = auth.split(" ")[1];
//     const secret = process.env.JWT_SECRET || "dev_secret";
//     const decoded = jwt.verify(token, secret);
//     return decoded.user_id || decoded.id || null;
//   } catch {
//     return null;
//   }
// }

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = header.split(" ")[1];
  const secret = process.env.JWT_SECRET || "secret_dev";

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ======================
// ROOT ENDPOINT
// ======================
app.get("/", (req, res) => {
  res.send("Backend API is running...");
});



// ======================
// AUTH REGISTER
// ======================
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  try {
    const exists = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING user_id, username",
      [username, hashed]
    );

    const user = result.rows[0];
    const token = generateToken(user);

    return res.status(201).json({
      id: user.user_id,
      username: user.username,
      token
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// LOGIN
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  try {
    const result = await pool.query(
      "SELECT user_id, username, password FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user);

    return res.json({
      id: user.user_id,
      username: user.username,
      token
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// ======================
// CHARACTERS
// ======================
app.get("/characters", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM character_list");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: true });
  }
});

// GET single character
app.get("/characters/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM character_list WHERE char_id=$1",
      [req.params.id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Character not found" });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: true });
  }
});

// ======================
// WEAPONS
// ======================
app.get("/weapons", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM weapon_list");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: true });
  }
});

app.get("/weapons/:id", async (req, res) => {
  try {
    const w = await pool.query(
      "SELECT * FROM weapon_list WHERE weapon_id = $1",
      [req.params.id]
    );

    if (w.rows.length === 0) {
      return res.status(404).json({ error: "Weapon not found" });
    }

    res.json(w.rows[0]);
  } catch (err) {
    res.status(500).json({ error: true });
  }
});


// ======================
// POSTS
// ======================
app.get("/posts", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.post_id,
        p.title,
        p.content,
        p.user_id,
        u.username,
        COALESCE(c.comment_count, 0) AS comment_count
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.user_id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS comment_count
        FROM comments
        GROUP BY post_id
      ) c ON p.post_id = c.post_id
      ORDER BY p.post_id DESC;
    `);

    const formatted = result.rows.map(p => ({
      post_id: p.post_id,
      title: p.title,
      content: p.content,
      user_id: p.user_id,

      User: { username: p.username },

      Comments: new Array(Number(p.comment_count)).fill({}) // hanya jumlah
    }));

    res.json(formatted);

  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});



app.get("/posts/:id", async (req, res) => {
  try {
    const postResult = await pool.query(
      `SELECT p.*, u.username
       FROM posts p
       LEFT JOIN users u ON p.user_id = u.user_id
       WHERE p.post_id = $1`,
      [req.params.id]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    const p = postResult.rows[0];

    const commentsResult = await pool.query(
      `SELECT c.*, u.username 
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.user_id
       WHERE c.post_id = $1
       ORDER BY c.comment_id ASC`,
      [req.params.id]
    );

    const formatted = {
      post_id: p.post_id,
      title: p.title,
      content: p.content,
      user_id: p.user_id,

      User: { username: p.username },

      Comments: commentsResult.rows.map(c => ({
        comment_id: c.comment_id,
        content: c.content,
        user_id: c.user_id,
        User: { username: c.username }
      }))
    };

    res.json(formatted);

  } catch (err) {
    res.status(500).json({ error: true });
  }
});



// CREATE POST
app.post("/posts", auth, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { title, content } = req.body;

    const now = new Date();

    const result = await pool.query(
      `INSERT INTO posts (user_id, title, content, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $4)
       RETURNING *`,
      [user_id, title, content, now]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /posts ERROR:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});






// DELETE POST
app.delete("/posts/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM posts WHERE post_id=$1", [req.params.id]);
    res.json({ message: "Post deleted" });
  } catch (err) {
    res.status(500).json({ error: true });
  }
});

// ======================
// COMMENTS
// ======================
app.post("/posts/:id", auth, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const post_id = req.params.id;
    const { content } = req.body;

    const now = new Date();

    const result = await pool.query(
      `INSERT INTO comments (user_id, post_id, content, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $4)
       RETURNING *`,
      [user_id, post_id, content, now]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST COMMENT ERROR:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.delete("/comments/:id", auth, async (req, res) => {
  try {
    const comment_id = req.params.id;

    await pool.query(`DELETE FROM comments WHERE comment_id = $1`, [comment_id]);

    res.json({ message: "Comment deleted" });
  } catch (err) {
    console.error("DELETE COMMENT ERROR:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ======================
// OPTIONAL: Initialize server (tidak merusak listen)
// ======================

module.exports = app;

// ======================
// RUN SERVER
// ======================
// app.listen(process.env.PORT || 4000, () =>
//   console.log("Server running...")
// );


