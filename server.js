// server.js — CampusPulse Backend
require('dotenv').config();
console.log("REDIS URL:", process.env.UPSTASH_REDIS_REST_URL);
console.log("REDIS TOKEN:", process.env.UPSTASH_REDIS_REST_TOKEN ? "FOUND" : "MISSING");
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Redis } = require('@upstash/redis');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary-v2');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ===============================
// UPSTASH REDIS
// ===============================
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ===============================
// CLOUDINARY
// ===============================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'campuspulse',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp', 'mp4', 'webm'],
  },
});

const upload = multer({ storage });

// ===============================
// EMAIL (SMTP via nodemailer)
// ===============================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, text }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      'Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.'
    );
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

// ===============================
// EXPRESS
// ===============================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// ===============================
// IN-MEMORY STATE
// ===============================
const clients = new Map();

let messages = [];
let whispers = [];

let poll = {
  question: "What's your go-to late-night study fuel?",
  options: [
    "Coffee ☕",
    "Energy Drink ⚡",
    "Instant Noodles 🍜",
    "Water & Regret 💧"
  ],
  votes: [0, 0, 0, 0]
};

// ===============================
// HELPERS
// ===============================
function broadcast(data, excludeWs = null) {
  const payload = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (
      client.readyState === 1 &&
      client !== excludeWs
    ) {
      client.send(payload);
    }
  });
}

function getUsersList() {
  const list = [];

  clients.forEach((c) => {
    list.push({
      id: c.id,
      name: c.name,
      role: c.role,
      avatar: c.avatar
    });
  });

  return list;
}

// ===============================
// MEDIA UPLOAD
// ===============================
app.post('/api/upload', upload.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    res.json({
      fileUrl: req.file.path,
      fileType: req.file.mimetype
    });

  } catch (err) {
    console.error('Upload error:', err);

    res.status(500).json({
      error: 'Upload failed'
    });
  }
});

// ===============================
// FORGOT PASSWORD
// ===============================
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      error: 'Email is required'
    });
  }

  try {
    const userKey = `user_email:${email}`;

    const username = await redis.get(userKey);

    if (!username) {
      return res.status(404).json({
        error: 'Email not found in database'
      });
    }

    const resetToken = crypto
      .randomBytes(32)
      .toString('hex');

    await redis.setex(
      `reset_token:${resetToken}`,
      900,
      username
    );

    const resetLink =
      `https://${req.headers.host}/reset-password.html?token=${resetToken}`;

    await sendEmail({
      to: email,
      subject: 'CampusPulse Password Recovery',
      text: `Click the link to reset your password: ${resetLink}`,
    });

    res.json({
      message: 'Password recovery email sent successfully!'
    });

  } catch (err) {
    console.error('Password recovery error:', err);

    res.status(500).json({
      error: 'Failed to send recovery email'
    });
  }
});

// ===============================
// WEBSOCKET
// ===============================
wss.on('connection', (ws) => {
  let clientSession = null;

  ws.on('message', async (rawMessage) => {
    let data;

    try {
      data = JSON.parse(rawMessage);
    } catch (e) {
      return;
    }

    // ===========================
    // SIGNUP
    // ===========================
    if (data.type === 'signup') {
      const { name, password, email } = data;

      if (!name || !password) {
        return ws.send(
          JSON.stringify({
            type: 'auth_error',
            message: 'Missing credentials'
          })
        );
      }

      try {
        const existingUser =
          await redis.hget('users', name);

        if (existingUser) {
          return ws.send(
            JSON.stringify({
              type: 'auth_error',
              message: 'Username is already taken'
            })
          );
        }

        const hashedPassword =
          await bcrypt.hash(password, 10);

        const userId =
          'usr_' +
          Math.random().toString(36).slice(2, 9);

        const newUser = {
          id: userId,
          name,
          password: hashedPassword,
          email: email || '',
          role: 'user',
          avatar: ''
        };

        await redis.hset('users', {
          [name]: JSON.stringify(newUser)
        });

        if (email) {
          await redis.set(
            `user_email:${email}`,
            name
          );
        }

        clientSession = {
          id: userId,
          name,
          role: 'user',
          avatar: ''
        };

        clients.set(ws, clientSession);

        ws.send(
          JSON.stringify({
            type: 'me',
            me: clientSession
          })
        );

        broadcast({
          type: 'users',
          users: getUsersList()
        });

        ws.send(
          JSON.stringify({
            type: 'state',
            users: getUsersList(),
            messages,
            whispers,
            poll
          })
        );

      } catch (err) {
        console.error('Signup error:', err);

        ws.send(
          JSON.stringify({
            type: 'auth_error',
            message: 'Signup failed'
          })
        );
      }
    }

    // ===========================
    // LOGIN
    // ===========================
    if (data.type === 'login') {
      const { name, password } = data;

      // Guest login
      if (!password) {
        const guestName = name
          ? name.slice(0, 20)
          : 'Guest-' +
            Math.random().toString(36).slice(2, 6);

        const userId =
          'guest_' +
          Math.random().toString(36).slice(2, 9);

        clientSession = {
          id: userId,
          name: guestName,
          role: 'user',
          avatar: ''
        };

        clients.set(ws, clientSession);

        ws.send(
          JSON.stringify({
            type: 'hello',
            id: userId
          })
        );

        ws.send(
          JSON.stringify({
            type: 'me',
            me: clientSession
          })
        );

        broadcast({
          type: 'users',
          users: getUsersList()
        });

        ws.send(
          JSON.stringify({
            type: 'state',
            users: getUsersList(),
            messages,
            whispers,
            poll
          })
        );

        return;
      }

      try {
        const userDataStr =
          await redis.hget('users', name);

        if (!userDataStr) {
          return ws.send(
            JSON.stringify({
              type: 'auth_error',
              message: 'User not found'
            })
          );
        }

        const user =
          typeof userDataStr === 'string'
            ? JSON.parse(userDataStr)
            : userDataStr;

        const isValid =
          await bcrypt.compare(
            password,
            user.password
          );

        if (!isValid) {
          return ws.send(
            JSON.stringify({
              type: 'auth_error',
              message: 'Incorrect password'
            })
          );
        }

        const isBanned =
          await redis.sismember(
            'banned_users',
            user.id
          );

        if (isBanned) {
          return ws.send(
            JSON.stringify({
              type: 'auth_error',
              message:
                'You have been banned from this campus server.'
            })
          );
        }

        clientSession = {
          id: user.id,
          name: user.name,
          role: user.role || 'user',
          avatar: user.avatar || ''
        };

        clients.set(ws, clientSession);

        ws.send(
          JSON.stringify({
            type: 'me',
            me: clientSession
          })
        );

        broadcast({
          type: 'users',
          users: getUsersList()
        });

        ws.send(
          JSON.stringify({
            type: 'state',
            users: getUsersList(),
            messages,
            whispers,
            poll
          })
        );

      } catch (err) {
        console.error('Login error:', err);

        ws.send(
          JSON.stringify({
            type: 'auth_error',
            message: 'Login failed'
          })
        );
      }
    }

    // ===========================
    // CHAT MESSAGE
    // ===========================
    if (data.type === 'chat' && clientSession) {
      const chatMsg = {
        id:
          'msg_' +
          Math.random().toString(36).slice(2, 9),

        from: clientSession.id,

        name: clientSession.name,

        avatar: clientSession.avatar,

        text: data.text
          ? data.text.slice(0, 500)
          : '',

        mediaUrl: data.mediaUrl || null,

        mediaType: data.mediaType || null,

        time: new Date().toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        )
      };

      messages.push(chatMsg);

      if (messages.length > 100) {
        messages.shift();
      }

      broadcast({
        type: 'chat',
        message: chatMsg
      });
    }

    // ===========================
    // TYPING
    // ===========================
    if (data.type === 'typing' && clientSession) {
      broadcast(
        {
          type: 'typing',
          name: clientSession.name,
          isTyping: data.isTyping
        },
        ws
      );
    }

    // ===========================
    // DELETE MESSAGE
    // ===========================
    if (
      data.type === 'delete_message' &&
      clientSession
    ) {
      const targetMsg =
        messages.find(
          (m) => m.id === data.messageId
        );

      if (
        targetMsg &&
        (
          clientSession.role === 'owner' ||
          clientSession.role === 'admin' ||
          targetMsg.from === clientSession.id
        )
      ) {
        messages =
          messages.filter(
            (m) => m.id !== data.messageId
          );

        broadcast({
          type: 'message_deleted',
          messageId: data.messageId
        });
      }
    }

    // ===========================
    // KICK / BAN
    // ===========================
    if (
      data.type === 'kick_user' &&
      clientSession &&
      (
        clientSession.role === 'owner' ||
        clientSession.role === 'admin'
      )
    ) {
      await redis.sadd(
        'banned_users',
        data.userId
      );

      clients.forEach((c, socket) => {
        if (c.id === data.userId) {
          socket.send(
            JSON.stringify({
              type: 'auth_error',
              message:
                'You have been kicked and banned by the administration.'
            })
          );

          socket.close();
        }
      });
    }

    // ===========================
    // WHISPERS
    // ===========================
    if (
      data.type === 'whisper' &&
      clientSession
    ) {
      const whisperObj = {
        id:
          'whs_' +
          Math.random().toString(36).slice(2, 9),

        text: data.text
          ? data.text.slice(0, 240)
          : '',

        author: 'Anonymous Student'
      };

      whispers.unshift(whisperObj);

      if (whispers.length > 50) {
        whispers.pop();
      }

      broadcast({
        type: 'whisper',
        whisper: whisperObj
      });
    }

    // ===========================
    // PRIVATE MESSAGES
    // ===========================
    if (
      data.type === 'private' &&
      clientSession
    ) {
      const pMsg = {
        id:
          'priv_' +
          Math.random().toString(36).slice(2, 9),

        from: clientSession.id,

        fromName: clientSession.name,

        to: data.to,

        text: data.text
          ? data.text.slice(0, 500)
          : '',

        time: new Date().toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        )
      };

      clients.forEach((c, socket) => {
        if (
          c.id === data.to ||
          c.id === clientSession.id
        ) {
          socket.send(
            JSON.stringify({
              type: 'private',
              message: pMsg
            })
          );
        }
      });
    }

    // ===========================
    // POLL VOTING
    // ===========================
    if (
      data.type === 'vote' &&
      typeof data.index === 'number' &&
      poll.options[data.index]
    ) {
      poll.votes[data.index]++;

      broadcast({
        type: 'poll',
        poll
      });
    }
  });

  // ===========================
  // DISCONNECT
  // ===========================
  ws.on('close', () => {
    if (clientSession) {
      clients.delete(ws);

      broadcast({
        type: 'users',
        users: getUsersList()
      });
    }
  });
});

// ===============================
// RENDER PORT
// ===============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `CampusPulse server running on port ${PORT}`
  );
});